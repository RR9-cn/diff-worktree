import { useEffect, useRef } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { MonacoDiffEditor } from "@monaco-editor/react";
import { ArrowDown, ArrowUp, ChevronsDownUp, ChevronsUpDown, FileX2, LoaderCircle, PackageX } from "lucide-react";

import type { DiffFilePayload } from "../types";
import { normalizeMonacoLanguage } from "./monacoLanguage";

// One remembered position per file opened would grow for the whole session, so only the newest are kept.
const MAX_REMEMBERED_FILES = 100;

interface DiffViewerPaneProps {
  leftLabel?: string;
  rightLabel?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  renderSideBySide?: boolean;
  readOnly?: boolean;
  diffFile: DiffFilePayload | null;
  draftContent: string;
  loading: boolean;
  onDraftChange: (next: string) => void;
  onToggleShowWholeFile: () => void;
  selectedBranch?: string;
  showWholeFile: boolean;
}

function EmptyState({
  icon,
  title,
  message,
  tone = "default",
}: {
  icon?: React.ReactNode;
  title: string;
  message: string;
  tone?: "default" | "gentle";
}) {
  return (
    <div className="empty-state-shell empty-state-shell-centered">
      <div className={`empty-state-card${tone === "gentle" ? " empty-state-card-gentle" : ""}`}>
        {icon ? (
          <div className="empty-state-badge" aria-hidden="true">
            {icon}
          </div>
        ) : null}
        <h3 className="empty-state-title">{title}</h3>
        <p className="empty-state-description">{message}</p>
      </div>
    </div>
  );
}

interface ViewAnchor {
  lineNumber: number;
  offset: number;
}

interface FileViewState extends ViewAnchor {
  contentHash: number;
}

interface DiffLineChange {
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

function topVisibleLine(diffEditor: MonacoDiffEditor) {
  return diffEditor.getModifiedEditor().getVisibleRanges()[0]?.startLineNumber ?? 1;
}

// A pure deletion is reported with modifiedEndLineNumber = 0 and a start one line above where it sits
// (see toLineChanges in monaco's diffEditorWidget), so its modified lines have to be normalised first:
// without this the change never matches the viewport test and the fallback anchors the wrong change.
function changeModifiedRange(change: DiffLineChange) {
  if (change.modifiedEndLineNumber === 0) {
    const lineNumber = change.modifiedStartLineNumber + 1;
    return { start: lineNumber, end: lineNumber };
  }

  return { start: change.modifiedStartLineNumber, end: change.modifiedEndLineNumber };
}

// Folding and unfolding move every line below an unchanged region, so the view has to be re-anchored.
// Pick the first change at or below the viewport top: that is the change the reviewer is sitting on.
function resolveAnchorLine(diffEditor: MonacoDiffEditor) {
  const changes = diffEditor.getLineChanges();

  if (!changes || changes.length === 0) {
    return undefined;
  }

  const topLine = topVisibleLine(diffEditor);
  const anchor =
    changes.find((change) => changeModifiedRange(change).end >= topLine) ?? changes[changes.length - 1];

  return changeModifiedRange(anchor).start;
}

// Where the line sits inside the viewport. Storing this offset rather than a raw scroll position keeps
// a remembered place usable when the folding mode changed between two visits, because both numbers are
// measured against whichever layout is current when the anchor is applied. The second argument counts
// view zones: the "N lines hidden" bars are view zones, so ignoring them would shift the anchor by
// their total height whenever the folding mode changes between the two measurements.
function captureAnchor(diffEditor: MonacoDiffEditor, lineNumber: number): ViewAnchor {
  const modified = diffEditor.getModifiedEditor();

  return { lineNumber, offset: modified.getTopForLineNumber(lineNumber, true) - modified.getScrollTop() };
}

function applyAnchor(diffEditor: MonacoDiffEditor, anchor: ViewAnchor) {
  const modified = diffEditor.getModifiedEditor();
  modified.setScrollTop(modified.getTopForLineNumber(anchor.lineNumber, true) - anchor.offset);
}

// Cheap fingerprint of the text being reviewed, only ever compared against another fingerprint, so a
// collision costs a stale scroll position and never a wrong render.
function hashContent(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return hash;
}

export function DiffViewerPane({
  leftLabel,
  rightLabel,
  emptyTitle,
  emptyMessage,
  renderSideBySide = true,
  readOnly = false,
  diffFile,
  draftContent,
  loading,
  onDraftChange,
  onToggleShowWholeFile,
  selectedBranch,
  showWholeFile,
}: DiffViewerPaneProps) {
  const editorLanguage = normalizeMonacoLanguage(diffFile?.language);
  const diffEditorRef = useRef<MonacoDiffEditor | null>(null);
  const disposablesRef = useRef<{ dispose: () => void }[]>([]);
  const isReadOnly = readOnly || diffFile?.changeType === "deleted";
  const pendingFoldAnchorRef = useRef<ViewAnchor | null>(null);
  const pendingRestoreRef = useRef<ViewAnchor | null>(null);
  const fileViewStatesRef = useRef(new Map<string, FileViewState>());
  const activeFileRef = useRef<{ path: string; contentHash: number } | null>(null);

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [];
    };
  }, []);

  // Decide what to restore as soon as the next file's text is known. A file whose text changed since
  // the last visit has no place worth returning to, so its remembered position is dropped.
  useEffect(() => {
    if (!diffFile || diffFile.isBinary || diffFile.tooLarge) {
      return;
    }

    const contentHash = hashContent(`${diffFile.left}\n${diffFile.right}`);
    const stored = fileViewStatesRef.current.get(diffFile.path);

    if (stored && stored.contentHash !== contentHash) {
      fileViewStatesRef.current.delete(diffFile.path);
    }

    activeFileRef.current = { path: diffFile.path, contentHash };
    pendingRestoreRef.current = fileViewStatesRef.current.get(diffFile.path) ?? null;
  }, [diffFile]);

  // Runs after the child DiffEditor has pushed the new options, so the anchor can be measured again
  // against the folded/unfolded layout.
  useEffect(() => {
    const pending = pendingFoldAnchorRef.current;
    const diffEditor = diffEditorRef.current;

    if (!pending || !diffEditor) {
      return;
    }

    pendingFoldAnchorRef.current = null;
    applyAnchor(diffEditor, pending);
  }, [showWholeFile]);

  function applyPendingRestore(diffEditor: MonacoDiffEditor) {
    const pending = pendingRestoreRef.current;

    // The diff must be in place before the anchor can be measured: until it lands the editor reports the
    // unfolded layout, and when the baseline side is empty the diff resolves without a worker round trip,
    // so onDidUpdateDiff has already fired before the pane could subscribe to it.
    if (!pending || !diffEditor.getLineChanges()) {
      return;
    }

    pendingRestoreRef.current = null;
    applyAnchor(diffEditor, pending);
  }

  function goToPreviousChange() {
    diffEditorRef.current?.goToDiff("previous");
  }

  function goToNextChange() {
    diffEditorRef.current?.goToDiff("next");
  }

  function handleToggleShowWholeFile() {
    const diffEditor = diffEditorRef.current;
    const anchorLine = diffEditor ? resolveAnchorLine(diffEditor) : undefined;

    if (diffEditor && anchorLine !== undefined) {
      pendingFoldAnchorRef.current = captureAnchor(diffEditor, anchorLine);
    }

    onToggleShowWholeFile();
  }

  return (
    <section className="pane pane-wide">
      <header className="pane-header">
        <span>{leftLabel ?? selectedBranch ?? "Compare branch"}</span>
        <span>{rightLabel ?? "Local"}</span>
      </header>
      <div className="pane-body pane-body-diff">
        {loading ? (
          <EmptyState
            icon={<LoaderCircle size={16} />}
            message="Loading the selected file diff and editor state."
            title="Building diff preview"
          />
        ) : null}
        {!loading && !diffFile ? (
          <EmptyState
            message={emptyMessage ?? "Select any changed file from the left panel and the side-by-side diff will appear here."}
            title={emptyTitle ?? "Diff preview is waiting for a selection"}
            tone="gentle"
          />
        ) : null}
        {!loading && diffFile?.isBinary ? (
          <EmptyState
            icon={<PackageX size={16} />}
            message="Binary files are detected correctly, but inline preview is not supported in this version."
            title="Binary diff cannot be rendered"
          />
        ) : null}
        {!loading && diffFile?.tooLarge ? (
          <EmptyState
            icon={<FileX2 size={16} />}
            message="This file exceeds the current rendering limit, so the editor preview has been intentionally disabled."
            title="File is too large to display"
          />
        ) : null}
        {!loading && diffFile && !diffFile.isBinary && !diffFile.tooLarge ? (
          <>
            <div className="diff-meta">
              <div className="diff-path">{diffFile.path}</div>
              <div className="diff-meta-actions">
                <div className={`pill pill-${diffFile.changeType}`}>{diffFile.changeType}</div>
                <button
                  aria-label={showWholeFile ? "Collapse unchanged regions" : "Show all unchanged regions"}
                  className="ghost-button ghost-button-icon ghost-button-plain"
                  onClick={handleToggleShowWholeFile}
                  title={showWholeFile ? "Collapse unchanged regions" : "Show all unchanged regions"}
                  type="button"
                >
                  {showWholeFile ? (
                    <ChevronsDownUp aria-hidden="true" size={14} strokeWidth={1.8} />
                  ) : (
                    <ChevronsUpDown aria-hidden="true" size={14} strokeWidth={1.8} />
                  )}
                </button>
                <button
                  aria-label="Previous change"
                  className="ghost-button ghost-button-icon ghost-button-plain"
                  onClick={goToPreviousChange}
                  title="Previous change"
                  type="button"
                >
                  <ArrowUp aria-hidden="true" size={14} strokeWidth={1.8} />
                </button>
                <button
                  aria-label="Next change"
                  className="ghost-button ghost-button-icon ghost-button-plain"
                  onClick={goToNextChange}
                  title="Next change"
                  type="button"
                >
                  <ArrowDown aria-hidden="true" size={14} strokeWidth={1.8} />
                </button>
              </div>
            </div>
            <div className="diff-editor-shell" data-testid="diff-editor-shell">
              <DiffEditor
                beforeMount={(monaco) => {
                  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
                    noSemanticValidation: true,
                    noSyntaxValidation: true,
                  });
                  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
                    noSemanticValidation: true,
                    noSyntaxValidation: true,
                  });
                }}
                height="100%"
                language={editorLanguage}
                modified={draftContent}
                options={{
                  automaticLayout: true,
                  fontFamily: 'Menlo, Consolas, "Courier New", monospace',
                  fontSize: 12,
                  minimap: { enabled: false },
                  readOnly: isReadOnly,
                  renderSideBySide,
                  hideUnchangedRegions: {
                    enabled: !showWholeFile,
                    contextLineCount: 3,
                    minimumLineCount: 3,
                    revealLineCount: 20,
                  },
                  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                }}
                onMount={(editor) => {
                  const modified = editor.getModifiedEditor();
                  diffEditorRef.current = editor;
                  disposablesRef.current.forEach((disposable) => disposable.dispose());
                  disposablesRef.current = [
                    modified.onDidChangeModelContent(() => {
                      if (isReadOnly) {
                        return;
                      }

                      onDraftChange(modified.getValue());
                    }),
                    // The diff is computed asynchronously, so a restore has to wait for it: measuring
                    // straight after mount would read the layout before the unchanged regions fold.
                    editor.onDidUpdateDiff(() => applyPendingRestore(editor)),
                    modified.onDidScrollChange(() => {
                      const activeFile = activeFileRef.current;

                      if (!activeFile) {
                        return;
                      }

                      // Re-inserting moves the path to the end of the map's insertion order, so the
                      // eviction below drops whichever file was scrolled longest ago.
                      const viewStates = fileViewStatesRef.current;
                      viewStates.delete(activeFile.path);
                      viewStates.set(activeFile.path, {
                        ...captureAnchor(editor, topVisibleLine(editor)),
                        contentHash: activeFile.contentHash,
                      });

                      if (viewStates.size > MAX_REMEMBERED_FILES) {
                        viewStates.delete(viewStates.keys().next().value!);
                      }
                    }),
                  ];
                  // onMount runs after the models were set, so a diff that needed no worker round trip is
                  // already available and its update event is gone.
                  applyPendingRestore(editor);
                }}
                original={diffFile.left}
                theme="vs"
              />
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
