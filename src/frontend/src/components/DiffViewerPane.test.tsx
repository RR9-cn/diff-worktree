// @vitest-environment jsdom

import { useEffect, useState } from "react";
import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiffViewerPane } from "./DiffViewerPane";

const diffEditorSpy = vi.fn();
const disposeSpy = vi.fn();

let scrollListener: (() => void) | undefined;
let diffUpdateListener: (() => void) | undefined;

// These shared spies carry the call history the assertions read, while every mount below also gets its own
// editor pair: that way a call landing on an editor the pane no longer holds stays visible, which the
// previous single shared instance could not show.
const fakeModifiedEditor = {
  getScrollTop: vi.fn(() => 0),
  getTopForLineNumber: vi.fn(() => 0),
  getValue: vi.fn(() => ""),
  getVisibleRanges: vi.fn((): { startLineNumber: number }[] => []),
  onDidChangeModelContent: vi.fn(() => ({
    dispose: disposeSpy,
  })),
  onDidScrollChange: vi.fn((listener: () => void) => {
    scrollListener = listener;
    return { dispose: disposeSpy };
  }),
  setScrollTop: vi.fn(),
};

const fakeDiffEditor = {
  getLineChanges: vi.fn(
    (): { modifiedStartLineNumber: number; modifiedEndLineNumber: number }[] | null => [],
  ),
  getModifiedEditor: vi.fn(() => fakeModifiedEditor),
  goToDiff: vi.fn(),
  onDidUpdateDiff: vi.fn((listener: () => void) => {
    diffUpdateListener = listener;
    return { dispose: disposeSpy };
  }),
};

interface FakeMount {
  editor: typeof fakeDiffEditor;
  modified: typeof fakeModifiedEditor;
}

const mounts: FakeMount[] = [];

function createFakeMount(): FakeMount {
  const modified: typeof fakeModifiedEditor = {
    getScrollTop: vi.fn(fakeModifiedEditor.getScrollTop),
    getTopForLineNumber: vi.fn(fakeModifiedEditor.getTopForLineNumber),
    getValue: vi.fn(fakeModifiedEditor.getValue),
    getVisibleRanges: vi.fn(fakeModifiedEditor.getVisibleRanges),
    onDidChangeModelContent: vi.fn(fakeModifiedEditor.onDidChangeModelContent),
    onDidScrollChange: vi.fn(fakeModifiedEditor.onDidScrollChange),
    setScrollTop: vi.fn(fakeModifiedEditor.setScrollTop),
  };

  const editor: typeof fakeDiffEditor = {
    getLineChanges: vi.fn(fakeDiffEditor.getLineChanges),
    getModifiedEditor: vi.fn(() => {
      // Still recorded on the shared spy so the "editor mounted" barriers keep working.
      fakeDiffEditor.getModifiedEditor();
      return modified;
    }),
    goToDiff: vi.fn(fakeDiffEditor.goToDiff),
    onDidUpdateDiff: vi.fn(fakeDiffEditor.onDidUpdateDiff),
  };

  return { editor, modified };
}

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: (props: { language?: string; theme?: string; onMount?: (editor: typeof fakeDiffEditor) => void }) => {
    diffEditorSpy(props);
    // One mount per instance, like the real wrapper, but reported from a queued microtask: the real one
    // reports after creating the editor, i.e. later than the parent's effects in the same commit.
    useEffect(() => {
      queueMicrotask(() => {
        const mount = createFakeMount();
        mounts.push(mount);
        props.onMount?.(mount.editor);
      });
    }, []);
    return <div>mock diff editor</div>;
  },
}));

describe("DiffViewerPane", () => {
  const modifiedFile = {
    path: "src/example.ts",
    changeType: "modified" as const,
    language: "ts",
    left: "before",
    right: "after",
    isBinary: false,
    tooLarge: false,
  };

  const deletedFile = {
    path: "src/deleted.ts",
    changeType: "deleted" as const,
    language: "ts",
    left: "before",
    right: "",
    isBinary: false,
    tooLarge: false,
  };

  afterEach(() => {
    cleanup();
    mounts.length = 0;
    scrollListener = undefined;
    diffUpdateListener = undefined;
    // A full reset, not mockClear: a mockReturnValueOnce a test did not consume would otherwise shift the
    // whole sequence of stub values for the next test.
    vi.resetAllMocks();
  });

  function renderPane(diffFile: typeof modifiedFile | null) {
    return (
      <DiffViewerPane
        diffFile={diffFile}
        draftContent="draft after"
        loading={false}
        onDraftChange={vi.fn()}
        onToggleShowWholeFile={vi.fn()}
        selectedBranch="main"
        showWholeFile={false}
      />
    );
  }

  // The mocked editor reports its mount from a queued microtask, so a render is not enough to know the
  // subscriptions exist yet.
  async function flushEditorMount() {
    await act(async () => {});
  }

  // Folding is driven by a prop, so a real click needs a harness that owns the state.
  function FoldHarness() {
    const [showWholeFile, setShowWholeFile] = useState(false);

    return (
      <DiffViewerPane
        diffFile={modifiedFile}
        draftContent="draft after"
        loading={false}
        onDraftChange={vi.fn()}
        onToggleShowWholeFile={() => setShowWholeFile((current) => !current)}
        selectedBranch="main"
        showWholeFile={showWholeFile}
      />
    );
  }

  it("normalizes Monaco language ids and uses the light editor theme", () => {
    render(
      <DiffViewerPane
        diffFile={modifiedFile}
        draftContent="draft after"
        loading={false}
        onDraftChange={vi.fn()}
        onToggleShowWholeFile={vi.fn()}
        selectedBranch="main"
        showWholeFile={false}
      />,
    );

    expect(diffEditorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "typescript",
        modified: "draft after",
        options: expect.objectContaining({
          hideUnchangedRegions: expect.objectContaining({ enabled: true }),
          readOnly: false,
        }),
        theme: "vs",
      }),
    );
  });

  it("renders a dedicated stretch container for the diff editor", () => {
    render(
      <DiffViewerPane
        diffFile={modifiedFile}
        draftContent="draft after"
        loading={false}
        onDraftChange={vi.fn()}
        onToggleShowWholeFile={vi.fn()}
        selectedBranch="main"
        showWholeFile={false}
      />,
    );

    expect(screen.getByTestId("diff-editor-shell")).toBeInTheDocument();
  });

  it("renders a side label header for the selected branch and local workspace", () => {
    render(
      <DiffViewerPane
        diffFile={modifiedFile}
        draftContent="draft after"
        loading={false}
        onDraftChange={vi.fn()}
        onToggleShowWholeFile={vi.fn()}
        selectedBranch="main"
        showWholeFile={false}
      />,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("Local")).toBeInTheDocument();
  });

  it("renders the richer empty state when no file is selected", () => {
    render(
      <DiffViewerPane
        diffFile={null}
        draftContent=""
        loading={false}
        onDraftChange={vi.fn()}
        onToggleShowWholeFile={vi.fn()}
        selectedBranch="main"
        showWholeFile={false}
      />,
    );

    expect(screen.getByText("Diff preview is waiting for a selection")).toBeInTheDocument();
    expect(
      screen.getByText("Select any changed file from the left panel and the side-by-side diff will appear here."),
    ).toBeInTheDocument();
  });

  it("keeps deleted files read-only on the local side", () => {
    render(
      <DiffViewerPane
        diffFile={deletedFile}
        draftContent=""
        loading={false}
        onDraftChange={vi.fn()}
        onToggleShowWholeFile={vi.fn()}
        selectedBranch="main"
        showWholeFile={false}
      />,
    );

    expect(diffEditorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modified: "",
        options: expect.objectContaining({
          readOnly: true,
        }),
      }),
    );
  });

  it("moves to the previous or next change through the diff navigation buttons", async () => {
    render(
      <DiffViewerPane
        diffFile={modifiedFile}
        draftContent="draft after"
        loading={false}
        onDraftChange={vi.fn()}
        onToggleShowWholeFile={vi.fn()}
        selectedBranch="main"
        showWholeFile={false}
      />,
    );

    await waitFor(() => {
      expect(fakeDiffEditor.getModifiedEditor).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous change" }));

    expect(fakeDiffEditor.goToDiff.mock.calls).toEqual([["next"], ["previous"]]);
  });

  it("stops folding unchanged regions while whole-file mode is on", () => {
    render(
      <DiffViewerPane
        diffFile={modifiedFile}
        draftContent="draft after"
        loading={false}
        onDraftChange={vi.fn()}
        onToggleShowWholeFile={vi.fn()}
        selectedBranch="main"
        showWholeFile
      />,
    );

    expect(diffEditorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          hideUnchangedRegions: expect.objectContaining({ enabled: false }),
        }),
      }),
    );
  });

  it("asks the app to toggle whole-file mode when the toolbar button is used", () => {
    const onToggleShowWholeFile = vi.fn();

    render(
      <DiffViewerPane
        diffFile={modifiedFile}
        draftContent="draft after"
        loading={false}
        onDraftChange={vi.fn()}
        onToggleShowWholeFile={onToggleShowWholeFile}
        selectedBranch="main"
        showWholeFile={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show all unchanged regions" }));

    expect(onToggleShowWholeFile).toHaveBeenCalledTimes(1);
  });

  it("swaps the fold icon and keeps the change the reviewer sits on inside the viewport", async () => {
    fakeDiffEditor.getLineChanges.mockReturnValueOnce([{ modifiedStartLineNumber: 40, modifiedEndLineNumber: 45 }]);
    fakeModifiedEditor.getVisibleRanges.mockReturnValueOnce([{ startLineNumber: 30 }]);
    fakeModifiedEditor.getScrollTop.mockReturnValueOnce(350);
    fakeModifiedEditor.getTopForLineNumber.mockReturnValueOnce(400).mockReturnValueOnce(200);
    const { container } = render(<FoldHarness />);

    expect(container.querySelector(".lucide-chevrons-up-down")).toBeInTheDocument();

    await waitFor(() => {
      expect(fakeDiffEditor.getModifiedEditor).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Show all unchanged regions" }));

    expect(container.querySelector(".lucide-chevrons-down-up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse unchanged regions" })).toBeInTheDocument();
    expect(fakeModifiedEditor.getTopForLineNumber).toHaveBeenCalledWith(40, true);
    expect(mounts[mounts.length - 1].modified.setScrollTop).toHaveBeenCalledWith(150);
  });

  it("anchors on a pure deletion when that is the change sitting at the viewport top", async () => {
    // Monaco reports a deletion as modifiedStartLineNumber 9 / modifiedEndLineNumber 0, so the lines it
    // occupies are 10..10; the later change at 200 must not win the anchor.
    fakeDiffEditor.getLineChanges.mockReturnValueOnce([
      { modifiedStartLineNumber: 9, modifiedEndLineNumber: 0 },
      { modifiedStartLineNumber: 200, modifiedEndLineNumber: 205 },
    ]);
    fakeModifiedEditor.getVisibleRanges.mockReturnValueOnce([{ startLineNumber: 5 }]);
    fakeModifiedEditor.getScrollTop.mockReturnValueOnce(350);
    fakeModifiedEditor.getTopForLineNumber.mockReturnValueOnce(400).mockReturnValueOnce(200);

    render(<FoldHarness />);

    await flushEditorMount();

    fireEvent.click(screen.getByRole("button", { name: "Show all unchanged regions" }));

    expect(fakeModifiedEditor.getTopForLineNumber).toHaveBeenCalledWith(10, true);
    expect(mounts[mounts.length - 1].modified.setScrollTop).toHaveBeenCalledWith(150);
  });

  it("returns to the place it was left at when the file comes back unchanged", async () => {
    const otherFile = { ...modifiedFile, path: "src/other.ts" };
    // A modified file resolves its diff through the worker, so the diff is still missing when the editor
    // reports its mount.
    fakeDiffEditor.getLineChanges.mockReturnValueOnce(null).mockReturnValueOnce([
      { modifiedStartLineNumber: 30, modifiedEndLineNumber: 30 },
    ]);
    fakeModifiedEditor.getVisibleRanges.mockReturnValueOnce([{ startLineNumber: 30 }]);
    fakeModifiedEditor.getTopForLineNumber.mockReturnValueOnce(400).mockReturnValueOnce(200);
    fakeModifiedEditor.getScrollTop.mockReturnValueOnce(350);

    const { rerender } = render(renderPane(modifiedFile));

    await flushEditorMount();

    scrollListener?.();

    rerender(renderPane(null));
    rerender(renderPane(otherFile));

    await flushEditorMount();

    diffUpdateListener?.();

    rerender(renderPane(null));
    rerender(renderPane(modifiedFile));

    await flushEditorMount();

    diffUpdateListener?.();

    expect(fakeModifiedEditor.getTopForLineNumber).toHaveBeenCalledWith(30, true);
    // The restore has to land on the editor the pane holds now, not on the one it held before the switch.
    expect(mounts[mounts.length - 1].modified.setScrollTop).toHaveBeenCalledWith(150);
  });

  it("returns to the place it was left at even when the diff was ready before the editor mounted", async () => {
    const otherFile = { ...modifiedFile, path: "src/other.ts" };
    fakeModifiedEditor.getVisibleRanges.mockReturnValueOnce([{ startLineNumber: 30 }]);
    fakeModifiedEditor.getTopForLineNumber.mockReturnValueOnce(400).mockReturnValueOnce(200);
    fakeModifiedEditor.getScrollTop.mockReturnValueOnce(350);

    const { rerender } = render(renderPane(modifiedFile));

    await flushEditorMount();

    scrollListener?.();

    rerender(renderPane(null));
    rerender(renderPane(otherFile));

    await flushEditorMount();

    rerender(renderPane(null));
    rerender(renderPane(modifiedFile));

    // An added file resolves its diff without a worker round trip, so onDidUpdateDiff has already fired
    // before the pane could subscribe. No diff update is delivered here on purpose.
    await flushEditorMount();

    expect(mounts[mounts.length - 1].modified.setScrollTop).toHaveBeenCalledWith(150);
  });

  it("leaves the view at the top when the file changed since the last visit", async () => {
    const editedFile = { ...modifiedFile, right: "after an edit" };
    fakeModifiedEditor.getVisibleRanges.mockReturnValueOnce([{ startLineNumber: 30 }]);
    fakeModifiedEditor.getTopForLineNumber.mockReturnValueOnce(400);
    fakeModifiedEditor.getScrollTop.mockReturnValueOnce(350);

    const { rerender } = render(renderPane(modifiedFile));

    await flushEditorMount();

    scrollListener?.();

    rerender(renderPane(null));
    rerender(renderPane(editedFile));

    await flushEditorMount();

    diffUpdateListener?.();

    expect(fakeModifiedEditor.setScrollTop).not.toHaveBeenCalled();
  });
});
