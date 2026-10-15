import path from "node:path";

export interface CodeupConfig {
  baseUrl: string;
  token: string;
  organizationId?: string;
}

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

export type CodeupChangeType = "added" | "modified" | "deleted" | "renamed";

export interface CodeupChangedFile {
  path: string;
  oldPath: string;
  changeType: CodeupChangeType;
  isBinary: boolean;
}

export interface CodeupComparison {
  baseSha: string;
  targetSha: string;
  files: CodeupChangedFile[];
}

export interface CodeupFileDiff extends CodeupChangedFile {
  language: string;
  left: string;
  right: string;
  tooLarge: boolean;
}

interface RepositoryResponse {
  id?: string | number;
  name?: string;
  pathWithNamespace?: string;
  defaultBranch?: string;
}

interface BranchResponse {
  name?: string;
  defaultBranch?: boolean;
  commit?: { id?: string };
}

interface CompareResponse {
  diffs?: Array<{
    oldPath?: string;
    newPath?: string;
    newFile?: boolean;
    deletedFile?: boolean;
    renamedFile?: boolean;
    isBinary?: boolean;
  }>;
}

interface FileResponse {
  content?: string;
  encoding?: "base64" | "text";
  size?: number;
}

const MAX_FILE_BYTES = 256 * 1024;

export function codeupConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CodeupConfig | null {
  const organizationId = env.CODEUP_ORGANIZATION_ID?.trim() || undefined;
  const baseUrl = env.CODEUP_BASE_URL?.trim() || (organizationId ? "https://openapi-rdc.aliyuncs.com" : undefined);
  const token = env.CODEUP_TOKEN?.trim();
  if (!baseUrl || !token) return null;

  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("CODEUP_BASE_URL must be an HTTPS origin without a path or credentials.");
  }
  return { baseUrl: url.origin, token, organizationId };
}

function requireSha(value: string): string {
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error("Invalid commit SHA.");
  return value;
}

function requireRepositoryId(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error("Invalid repository ID.");
  return value;
}

function requireFilePath(value: string): string {
  if (!value || value.startsWith("/") || value.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("Invalid file path.");
  }
  return value;
}

export class CodeupService {
  constructor(private readonly config: CodeupConfig, private readonly fetcher: typeof fetch = fetch) {}

  private root(repositoryId?: string): string {
    const organization = this.config.organizationId
      ? `/organizations/${encodeURIComponent(this.config.organizationId)}`
      : "";
    return `/oapi/v1/codeup${organization}/repositories${repositoryId ? `/${requireRepositoryId(repositoryId)}` : ""}`;
  }

  private async get<T>(resource: string, parameters: Record<string, string> = {}): Promise<T> {
    const url = new URL(resource, this.config.baseUrl);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const response = await this.fetcher(url, {
      headers: { "x-yunxiao-token": this.config.token, accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`Codeup request failed (${response.status}).`);
    }
    return response.json() as Promise<T>;
  }

  async listRepositories(search = "", page = 1): Promise<CodeupRepository[]> {
    const rows = await this.get<RepositoryResponse[]>(this.root(), {
      page: String(page), perPage: "50", search,
    });
    if (!Array.isArray(rows)) throw new Error("Unexpected Codeup repositories response.");
    return rows.filter((row) => row.id != null).map((row) => ({
      id: String(row.id),
      name: row.name ?? row.pathWithNamespace ?? String(row.id),
      fullPath: row.pathWithNamespace ?? row.name ?? String(row.id),
      defaultBranch: row.defaultBranch,
    }));
  }

  async listBranches(repositoryId: string, search = "", page = 1): Promise<CodeupBranch[]> {
    const rows = await this.get<BranchResponse[]>(`${this.root(repositoryId)}/branches`, {
      page: String(page), perPage: "100", search,
    });
    if (!Array.isArray(rows)) throw new Error("Unexpected Codeup branches response.");
    return rows.filter((row) => row.name && row.commit?.id).map((row) => ({
      name: row.name!, sha: row.commit!.id!, isDefault: Boolean(row.defaultBranch),
    }));
  }

  async compare(repositoryId: string, baseSha: string, targetSha: string): Promise<CodeupComparison> {
    requireSha(baseSha);
    requireSha(targetSha);
    const payload = await this.get<CompareResponse>(`${this.root(repositoryId)}/compares`, {
      from: baseSha, to: targetSha, straight: "true",
    });
    if (!Array.isArray(payload.diffs)) throw new Error("Unexpected Codeup comparison response.");
    return {
      baseSha, targetSha,
      files: payload.diffs.map((row) => {
        const filePath = requireFilePath(row.newPath ?? row.oldPath ?? "");
        const oldPath = requireFilePath(row.oldPath ?? filePath);
        const changeType: CodeupChangeType = row.newFile ? "added" : row.deletedFile ? "deleted" : row.renamedFile ? "renamed" : "modified";
        return { path: filePath, oldPath, changeType, isBinary: Boolean(row.isBinary) };
      }),
    };
  }

  private async readFile(repositoryId: string, sha: string, filePath: string): Promise<{ content: string; tooLarge: boolean; isBinary: boolean }> {
    const resource = `${this.root(repositoryId)}/files/${encodeURIComponent(requireFilePath(filePath))}`;
    const payload = await this.get<FileResponse>(resource, { ref: requireSha(sha) });
    if (typeof payload.content !== "string" || (payload.encoding !== "base64" && payload.encoding !== "text")) {
      throw new Error("Unexpected Codeup file response.");
    }
    const buffer = payload.encoding === "base64" ? Buffer.from(payload.content, "base64") : Buffer.from(payload.content, "utf8");
    const tooLarge = (payload.size ?? buffer.length) > MAX_FILE_BYTES || buffer.length > MAX_FILE_BYTES;
    const isBinary = buffer.includes(0);
    return { content: tooLarge || isBinary ? "" : buffer.toString("utf8"), tooLarge, isBinary };
  }

  async getFileDiff(repositoryId: string, baseSha: string, targetSha: string, file: CodeupChangedFile): Promise<CodeupFileDiff> {
    const left = file.changeType === "added" ? null : await this.readFile(repositoryId, baseSha, file.oldPath);
    const right = file.changeType === "deleted" ? null : await this.readFile(repositoryId, targetSha, file.path);
    return {
      ...file,
      language: path.extname(file.path).slice(1) || "plaintext",
      left: left?.content ?? "",
      right: right?.content ?? "",
      tooLarge: Boolean(left?.tooLarge || right?.tooLarge),
      isBinary: Boolean(file.isBinary || left?.isBinary || right?.isBinary),
    };
  }
}
