import type { DiffFilePayload } from "../types";

export interface CodeupRepository {
  id: string;
  name: string;
  fullPath: string;
  defaultBranch?: string;
}

export interface CodeupBranch {
  name: string;
  sha: string;
  isDefault: boolean;
}

export interface CodeupChangedFile {
  path: string;
  oldPath: string;
  changeType: DiffFilePayload["changeType"];
  isBinary: boolean;
}

export interface CodeupComparison {
  baseSha: string;
  targetSha: string;
  files: CodeupChangedFile[];
}

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

const base = "/api/codeup";

export const getCodeupStatus = () => request<{ configured: boolean }>(`${base}/status`);
export const listCodeupRepositories = (search = "", page = 1) =>
  request<CodeupRepository[]>(`${base}/repositories?search=${encodeURIComponent(search)}&page=${page}`);
export const listCodeupBranches = (repositoryId: string, search = "") =>
  request<CodeupBranch[]>(`${base}/repositories/${encodeURIComponent(repositoryId)}/branches?search=${encodeURIComponent(search)}`);
export const compareCodeupBranches = (repositoryId: string, baseSha: string, targetSha: string) =>
  request<CodeupComparison>(`${base}/repositories/${encodeURIComponent(repositoryId)}/compare?baseSha=${encodeURIComponent(baseSha)}&targetSha=${encodeURIComponent(targetSha)}`);
export const getCodeupFileDiff = (repositoryId: string, comparison: CodeupComparison, file: CodeupChangedFile) => {
  const params = new URLSearchParams({
    baseSha: comparison.baseSha,
    targetSha: comparison.targetSha,
    path: file.path,
    oldPath: file.oldPath,
    changeType: file.changeType,
  });
  return request<DiffFilePayload>(`${base}/repositories/${encodeURIComponent(repositoryId)}/file?${params}`);
};
