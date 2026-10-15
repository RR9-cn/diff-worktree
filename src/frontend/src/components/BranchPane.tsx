import { useEffect, useState } from "react";
import type { BranchStatus } from "./../types";
import { RefreshCw, Settings2, Trash2, X } from "lucide-react";

import { formatDisplayPath } from "../utils/displayPath";
import { formatPatternText, parsePatternText } from "../utils/highlightPatterns";

interface BranchPaneProps {
  defaultHighlightFilePatterns: string[];
  highlightFilePatterns: string[];
  highlightFilesEnabled: boolean;
  localBranches: BranchStatus[];
  homeDir?: string;
  loading: boolean;
  refreshing: boolean;
  repoRoot?: string;
  selectedBranch?: string;
  onHighlightFilePatternsChange: (patterns: string[]) => void;
  onHighlightFilesEnabledChange: (highlight: boolean) => void;
  onSelectBranch: (branchName: string) => void;
  onRefresh: () => void;
  onUpdateLocalBranch: (branchName: string) => void;
  onDeleteLocalBranch: (branchName: string) => void;
}

function sortBranchesByDate(branches: BranchStatus[]): BranchStatus[] {
  return [...branches].sort((a, b) => {
    if (a.lastCommitAuthorDate > b.lastCommitAuthorDate) return -1;
    if (a.lastCommitAuthorDate < b.lastCommitAuthorDate) return 1;
    return 0;
  });
}

function renderSyncStatus(branch: BranchStatus) {
  switch (branch.syncStatus) {
    case "upToDate":
      return "up to date";
    case "ahead":
      return `ahead ${branch.ahead}`;
    case "behind":
      return `behind ${branch.behind}`;
    case "diverged":
      return `ahead ${branch.ahead} / behind ${branch.behind}`;
    case "noUpstream":
      return "no upstream";
  }
}

function shouldShowLocalUpdateAction(branch: BranchStatus) {
  if (branch.syncStatus === "upToDate" || branch.syncStatus === "noUpstream") {
    return false;
  }

  return Boolean(branch.canUpdate || branch.disabledReason);
}

function LocalBranchItem({
  branch,
  selected,
  displayName,
  onSelect,
  onUpdate,
  onDelete,
}: {
  branch: BranchStatus;
  selected: boolean;
  displayName: string;
  onSelect: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`branch-row${selected ? " branch-row-selected" : ""}`}>
      <button
        className={`branch-item${selected ? " branch-item-selected" : ""}`}
        onClick={onSelect}
        title={branch.name}
        type="button"
      >
        <div className="branch-item-title">
          <span className="branch-item-name">{displayName}</span>
          {branch.isCurrent ? <span className="pill pill-current">current</span> : null}
        </div>
        <div className="branch-item-meta">{renderSyncStatus(branch)}</div>
      </button>
      <div className="branch-item-actions">
        {shouldShowLocalUpdateAction(branch) ? (
          <button
            aria-label={`Update ${branch.name}`}
            className="ghost-button ghost-button-icon ghost-button-plain branch-action-button"
            disabled={!branch.canUpdate}
            onClick={onUpdate}
            title={branch.canUpdate ? "Update branch" : branch.disabledReason}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
          </button>
        ) : null}
        <button
          aria-label={`Delete ${branch.name}`}
          className="ghost-button ghost-button-icon ghost-button-plain branch-action-button"
          disabled={!branch.canDelete}
          onClick={onDelete}
          title={branch.canDelete ? "Delete branch" : branch.disabledReason ?? "Branch cannot be deleted."}
          type="button"
        >
          <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

export function BranchPane({
  defaultHighlightFilePatterns,
  highlightFilePatterns,
  highlightFilesEnabled,
  localBranches,
  homeDir,
  loading,
  refreshing,
  repoRoot,
  selectedBranch,
  onHighlightFilePatternsChange,
  onHighlightFilesEnabledChange,
  onSelectBranch,
  onRefresh,
  onUpdateLocalBranch,
  onDeleteLocalBranch,
}: BranchPaneProps) {
  const [highlightSettingsOpen, setHighlightSettingsOpen] = useState(false);
  const [patternText, setPatternText] = useState(() => formatPatternText(highlightFilePatterns));
  const sortedBranches = sortBranchesByDate(localBranches);

  useEffect(() => {
    // Only resync from props on external changes (e.g. reset). Avoid reformatting
    // the textarea while the user is mid-edit, which would strip a just-typed
    // trailing comma before they can type the next pattern.
    setPatternText((current) => {
      const currentPatterns = parsePatternText(current);
      const sameAsProps =
        currentPatterns.length === highlightFilePatterns.length &&
        currentPatterns.every((pattern, index) => pattern === highlightFilePatterns[index]);
      return sameAsProps ? current : formatPatternText(highlightFilePatterns);
    });
  }, [highlightFilePatterns]);

  return (
    <section className="pane">
      <header className="pane-header">
        <span>Target</span>
        <div className="pane-actions">
          <button
            aria-label={refreshing ? "Refreshing" : "Refresh"}
            className={`ghost-button ghost-button-icon ghost-button-plain${refreshing ? " ghost-button-spinning" : ""}`}
            disabled={loading || refreshing}
            onClick={onRefresh}
            title={refreshing ? "Refreshing" : "Refresh"}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
          </button>
        </div>
      </header>
      <div className="pane-body branch-pane-body">
        <div className="branch-pane-scroll">
          <div className="repo-root">{repoRoot ? formatDisplayPath(repoRoot, homeDir) : "Loading repository..."}</div>
          {loading ? <div className="empty-state">Loading branches...</div> : null}
          <section className="branch-section">
            <div className="branch-list">
              {/* 分支名里的 / 不建树：按前缀折叠会让 codex/xxx 这类分支多出一级，一律整行平铺 */}
              {sortedBranches.map((branch) => (
                <LocalBranchItem
                  key={branch.name}
                  branch={branch}
                  displayName={branch.name}
                  selected={selectedBranch === branch.name}
                  onDelete={() => onDeleteLocalBranch(branch.name)}
                  onSelect={() => onSelectBranch(branch.name)}
                  onUpdate={() => onUpdateLocalBranch(branch.name)}
                />
              ))}
            </div>
          </section>
        </div>
        <div className="pane-footer-toggle">
          <label className="pane-footer-toggle-main">
            <input
              checked={highlightFilesEnabled}
              onChange={(event) => onHighlightFilesEnabledChange(event.target.checked)}
              type="checkbox"
            />
            <span>高亮文件</span>
          </label>
          <button
            aria-expanded={highlightSettingsOpen}
            aria-label="配置高亮规则"
            className="ghost-button ghost-button-icon ghost-button-plain pane-footer-settings-button"
            onClick={(event) => {
              event.preventDefault();
              setHighlightSettingsOpen((current) => !current);
            }}
            title="配置高亮规则"
            type="button"
          >
            <Settings2 aria-hidden="true" size={14} strokeWidth={1.8} />
          </button>
        </div>
        {highlightSettingsOpen ? (
          <div
            className="highlight-settings-overlay"
            onClick={() => setHighlightSettingsOpen(false)}
            role="presentation"
          >
            <div
              aria-label="高亮规则设置"
              className="highlight-settings-modal"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="highlight-settings-titlebar">
                <span className="highlight-settings-title">
                  <Settings2 aria-hidden="true" size={14} strokeWidth={1.8} />
                  高亮规则
                </span>
                <button
                  aria-label="关闭"
                  className="ghost-button ghost-button-icon ghost-button-plain highlight-settings-close"
                  onClick={() => setHighlightSettingsOpen(false)}
                  title="关闭"
                  type="button"
                >
                  <X aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
              </div>
              <div className="highlight-settings-body">
                <textarea
                  aria-label="高亮规则"
                  className="highlight-settings-input"
                  onBlur={() => setPatternText(formatPatternText(highlightFilePatterns))}
                  onChange={(event) => {
                    const nextText = event.target.value;
                    setPatternText(nextText);
                    onHighlightFilePatternsChange(parsePatternText(nextText));
                  }}
                  placeholder="*.test.ts, *.spec.ts"
                  value={patternText}
                />
                <div className="highlight-settings-footer">
                  <span className="highlight-settings-hint">逗号分隔多个 glob 规则</span>
                  <button
                    className="ghost-button highlight-settings-reset"
                    onClick={() => onHighlightFilePatternsChange(defaultHighlightFilePatterns)}
                    type="button"
                  >
                    恢复默认
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
