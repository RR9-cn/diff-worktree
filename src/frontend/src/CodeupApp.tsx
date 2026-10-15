import { useEffect, useRef, useState } from "react";
import { GitBranch, Search } from "lucide-react";

import {
  compareCodeupBranches,
  getCodeupFileDiff,
  getCodeupStatus,
  listCodeupBranches,
  listCodeupRepositories,
} from "./api/codeupClient";
import type { CodeupBranch, CodeupChangedFile, CodeupComparison, CodeupRepository } from "./api/codeupClient";
import { DiffTreePane } from "./components/DiffTreePane";
import { DiffViewerPane } from "./components/DiffViewerPane";
import type { DiffFilePayload, DiffTreeNode } from "./types";

function buildTree(files: CodeupChangedFile[]): DiffTreeNode[] {
  const roots: DiffTreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split("/");
    let level = roots;
    let currentPath = "";
    for (const [index, name] of parts.entries()) {
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      let node = level.find((item) => item.name === name);
      if (!node) {
        node = index === parts.length - 1
          ? { type: "file", name, path: file.path, oldPath: file.oldPath, changeType: file.changeType }
          : { type: "directory", name, path: currentPath, children: [] };
        level.push(node);
      }
      level = node.children ?? [];
    }
  }
  const sort = (nodes: DiffTreeNode[]) => {
    nodes.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1);
    nodes.forEach((node) => node.children && sort(node.children));
  };
  sort(roots);
  return roots;
}

export function CodeupApp() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [repositories, setRepositories] = useState<CodeupRepository[]>([]);
  const [repositorySearch, setRepositorySearch] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [branches, setBranches] = useState<CodeupBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");
  const [branchSearchOpen, setBranchSearchOpen] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [comparison, setComparison] = useState<CodeupComparison | null>(null);
  const [comparisonLabel, setComparisonLabel] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [diffFile, setDiffFile] = useState<DiffFilePayload | null>(null);
  const [showWholeFile, setShowWholeFile] = useState(false);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState("");
  const [wideViewport, setWideViewport] = useState(() => typeof window === "undefined" || window.innerWidth >= 1150);
  const comparisonRequest = useRef(0);

  useEffect(() => {
    const update = () => setWideViewport(window.innerWidth >= 1150);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getCodeupStatus().then(async (status) => {
      if (cancelled) return;
      setConfigured(status.configured);
      if (status.configured) setRepositories(await listCodeupRepositories());
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    comparisonRequest.current += 1;
    setLoading(false);
    setBranches([]);
    setBranchesLoading(Boolean(repositoryId));
    setBranchSearch("");
    setBranchSearchOpen(false);
    setBaseBranch("");
    setTargetBranch("");
    setComparison(null);
    setSelectedPath("");
    setDiffFile(null);
    if (!repositoryId) return;
    let cancelled = false;
    void listCodeupBranches(repositoryId).then((items) => {
      if (cancelled) return;
      setBranches(items);
      const base = items.find((item) => item.isDefault) ?? items.find((item) => item.name === "master") ?? items[0];
      setBaseBranch(base?.name ?? "");
      setTargetBranch("");
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (!cancelled) setBranchesLoading(false); });
    return () => { cancelled = true; };
  }, [repositoryId]);

  useEffect(() => {
    setDiffFile(null);
    if (!comparison || !repositoryId || !selectedPath) return;
    const file = comparison.files.find((item) => item.path === selectedPath);
    if (!file) return;
    let cancelled = false;
    setDiffLoading(true);
    void getCodeupFileDiff(repositoryId, comparison, file).then((payload) => {
      if (!cancelled) setDiffFile(payload);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (!cancelled) setDiffLoading(false); });
    return () => { cancelled = true; };
  }, [comparison, repositoryId, selectedPath]);

  async function searchRepositories() {
    try {
      setError("");
      setRepositories(await listCodeupRepositories(repositorySearch));
      setRepositoryId("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function searchBranches() {
    if (!repositoryId) return;
    try {
      setError("");
      const found = await listCodeupBranches(repositoryId, branchSearch);
      setBranches((current) => {
        const byName = new Map(current.map((branch) => [branch.name, branch]));
        for (const branch of found) byName.set(branch.name, branch);
        return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  function chooseBranch(kind: "base" | "target", name: string) {
    comparisonRequest.current += 1;
    setLoading(false);
    if (kind === "base") setBaseBranch(name);
    else setTargetBranch(name);
    setComparison(null);
    setSelectedPath("");
    setDiffFile(null);
  }

  async function compare() {
    const base = branches.find((item) => item.name === baseBranch);
    const target = branches.find((item) => item.name === targetBranch);
    if (!repositoryId || !base || !target || base.name === target.name) return;
    const requestId = ++comparisonRequest.current;
    setLoading(true);
    setError("");
    setComparison(null);
    setDiffFile(null);
    try {
      const result = await compareCodeupBranches(repositoryId, base.sha, target.sha);
      if (requestId !== comparisonRequest.current) return;
      setComparison(result);
      setComparisonLabel(`${base.name} → ${target.name}`);
      setSelectedPath(result.files[0]?.path ?? "");
    } catch (reason) {
      if (requestId === comparisonRequest.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (requestId === comparisonRequest.current) setLoading(false);
    }
  }

  const tree = comparison ? buildTree(comparison.files) : [];
  const addedCount = comparison?.files.filter((file) => file.changeType === "added").length ?? 0;
  const modifiedCount = comparison?.files.filter((file) => file.changeType === "modified").length ?? 0;
  const otherCount = (comparison?.files.length ?? 0) - addedCount - modifiedCount;
  const matchingBranches = branches.filter((branch) => branch.name.toLocaleLowerCase().includes(branchSearch.trim().toLocaleLowerCase()));

  return (
    <main className="codeup-page">
      <header className="cloud-topbar">
        <div className="cloud-brand"><span className="cloud-brand-mark" aria-hidden="true"><GitBranch size={17} strokeWidth={2} /></span><span><strong>diff-worktree</strong><small>Codeup 分支比较</small></span></div>
        <div className="cloud-topbar-status"><span className="cloud-readonly">只读查看</span><span className="cloud-provider">Codeup</span></div>
      </header>
      <section className="cloud-toolbar" aria-label="比较条件">
        <div className="cloud-toolbar-row">
          <div className="cloud-field cloud-repository-field">
            <label htmlFor="repository">仓库</label>
            <div className="cloud-repository-picker">
              <input aria-label="查找仓库" id="repository-search" onChange={(event) => setRepositorySearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchRepositories(); }} placeholder="查找仓库" value={repositorySearch} />
              <button aria-label="搜索仓库" onClick={() => void searchRepositories()} type="button" disabled={!configured}><Search size={15} strokeWidth={2} /></button>
              <select id="repository" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)} disabled={!configured}>
                <option value="">选择仓库</option>
                {repositories.map((item) => <option key={item.id} value={item.id}>{item.fullPath}</option>)}
              </select>
            </div>
          </div>
          <div className="cloud-field">
            <label htmlFor="base-branch">基准分支</label>
            <select id="base-branch" value={baseBranch} onChange={(event) => chooseBranch("base", event.target.value)} disabled={!repositoryId}>
              <option value="">选择分支</option>
              {branches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </div>
          <span className="cloud-direction" aria-hidden="true">→</span>
          <div className="cloud-field">
            <label htmlFor="target-branch">目标分支</label>
            <select id="target-branch" value={targetBranch} onChange={(event) => chooseBranch("target", event.target.value)} disabled={!repositoryId}>
              <option value="">选择分支</option>
              {branches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </div>
          <button className="cloud-compare-button" onClick={() => void compare()} disabled={!baseBranch || !targetBranch || baseBranch === targetBranch || loading} type="button">
            {loading ? "比较中…" : "比较分支"}
          </button>
        </div>
        <div className="cloud-toolbar-meta">
          {comparison ? (
            <>
              <strong>{comparisonLabel}</strong><span>固定提交版本</span><code>{comparison.baseSha.slice(0, 8)}</code><span>→</span><code>{comparison.targetSha.slice(0, 8)}</code>
              <span className="cloud-summary"><strong>{comparison.files.length} 个变更文件</strong><span>+ {addedCount} 新增</span><span>● {modifiedCount} 修改</span>{otherCount > 0 ? <span>{otherCount} 其他</span> : null}</span>
            </>
          ) : <span>选择仓库和两个分支后查看远端已提交内容</span>}
          {repositoryId ? <span className="cloud-branch-count">{branchesLoading ? "正在读取分支…" : `已加载 ${branches.length} 条分支`}</span> : null}
          {repositoryId ? <button aria-controls="cloud-branch-panel" aria-expanded={branchSearchOpen} className="cloud-branch-search-toggle" onClick={() => setBranchSearchOpen((open) => !open)} type="button">{branchSearchOpen ? "收起分支列表" : "查看分支列表"}</button> : null}
        </div>
        {branchSearchOpen ? (
          <div aria-label="分支列表" className="cloud-branch-panel" id="cloud-branch-panel" onKeyDown={(event) => { if (event.key === "Escape") setBranchSearchOpen(false); }} role="region">
            <div className="cloud-branch-panel-head"><strong>已加载的分支</strong><span>{branches.length} 条</span></div>
            <div className="cloud-branch-search"><label htmlFor="branch-search">查找分支</label><input id="branch-search" value={branchSearch} onChange={(event) => setBranchSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchBranches(); }} placeholder="输入分支名称" /><button onClick={() => void searchBranches()} type="button">搜索远端</button></div>
            <div className="cloud-branch-items">
              {matchingBranches.length === 0 ? <p className="cloud-branch-empty">已加载列表中没有匹配项，可搜索远端分支。</p> : matchingBranches.map((branch) => (
                <div className="cloud-branch-item" key={branch.name}>
                  <div className="cloud-branch-details"><strong title={branch.name}>{branch.name}</strong><small>{branch.sha.slice(0, 8)}{branch.isDefault ? " · 默认分支" : ""}</small></div>
                  <button aria-label={`设 ${branch.name} 为基准分支`} disabled={branch.name === baseBranch} onClick={() => { chooseBranch("base", branch.name); setBranchSearchOpen(false); }} type="button">设为基准</button>
                  <button aria-label={`设 ${branch.name} 为目标分支`} disabled={branch.name === targetBranch} onClick={() => { chooseBranch("target", branch.name); setBranchSearchOpen(false); }} type="button">设为目标</button>
                </div>
              ))}
              {branches.length >= 100 ? <p className="cloud-branch-empty">当前显示前 100 条分支，可通过上方输入框搜索其他远端分支。</p> : null}
            </div>
          </div>
        ) : null}
        {configured === false ? <div className="cloud-error" role="alert">请在服务端配置 CODEUP_TOKEN；中心版还需 CODEUP_ORGANIZATION_ID，Region 版还需 CODEUP_BASE_URL。</div> : null}
        {error ? <div className="cloud-error" role="alert">{error}</div> : null}
      </section>
      <div className="cloud-main">
        <DiffTreePane nodes={tree} loading={loading} selectedFilePath={selectedPath} title="变更文件" showFilters emptyTitle={comparison ? "没有变更文件" : "尚未比较"} emptyMessage={comparison ? "两个提交版本的文件内容相同。" : "选择仓库和两个分支后执行比较。"} onSelectFile={setSelectedPath} />
        <DiffViewerPane diffFile={diffFile} draftContent={diffFile?.right ?? ""} loading={diffLoading} onDraftChange={() => {}} onToggleShowWholeFile={() => setShowWholeFile((value) => !value)} showWholeFile={showWholeFile} leftLabel={baseBranch || "基准分支"} rightLabel={targetBranch || "目标分支"} emptyTitle="选择文件查看差异" emptyMessage="从左侧选择变更文件，查看两个提交版本的内容。" renderSideBySide={wideViewport} readOnly />
      </div>
    </main>
  );
}
