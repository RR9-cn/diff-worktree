import express from "express";
import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";

import { resolveFrontendDistPath } from "../frontendAssets";
import { CodeupService } from "./codeupService";
import type { CodeupChangedFile, CodeupConfig, CodeupChangeType } from "./codeupService";

function queryString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function pageNumber(value: unknown): number {
  const page = value === undefined ? 1 : Number(value);
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error("Invalid page number.");
  return page;
}

function sendError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Codeup request failed.";
  const status = /^(Invalid|Missing)/.test(message) ? 400 : 502;
  res.status(status).json({ error: message });
}

export interface AppCredentials { user: string; password: string }

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createCodeupServer(config: CodeupConfig | null, fetcher: typeof fetch = fetch, credentials?: AppCredentials): Express {
  const app = express();
  const service = config ? new CodeupService(config, fetcher) : null;

  if (credentials) {
    app.use((req, res, next) => {
      const authorization = req.header("authorization");
      const encoded = authorization?.startsWith("Basic ") ? authorization.slice(6) : "";
      const decoded = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
      const separator = decoded.indexOf(":");
      const user = separator < 0 ? "" : decoded.slice(0, separator);
      const password = separator < 0 ? "" : decoded.slice(separator + 1);
      if (sameSecret(user, credentials.user) && sameSecret(password, credentials.password)) return next();
      res.setHeader("WWW-Authenticate", 'Basic realm="diff-worktree"');
      res.status(401).end();
    });
  }

  app.get("/api/codeup/status", (_req, res) => res.json({ configured: Boolean(service) }));
  app.use("/api/codeup", (req, res, next) => {
    if (!service) {
      res.status(503).json({ error: "Configure CODEUP_TOKEN and CODEUP_ORGANIZATION_ID for Central edition, or CODEUP_TOKEN and CODEUP_BASE_URL for Region edition." });
      return;
    }
    next();
  });

  app.get("/api/codeup/repositories", async (req: Request, res: Response) => {
    try {
      res.json(await service!.listRepositories(String(req.query.search ?? ""), pageNumber(req.query.page)));
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/codeup/repositories/:id/branches", async (req: Request, res: Response) => {
    try {
      res.json(await service!.listBranches(String(req.params.id), String(req.query.search ?? ""), pageNumber(req.query.page)));
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/codeup/repositories/:id/compare", async (req: Request, res: Response) => {
    const baseSha = queryString(req.query.baseSha);
    const targetSha = queryString(req.query.targetSha);
    if (!baseSha || !targetSha) {
      res.status(400).json({ error: "Missing comparison commit SHA." });
      return;
    }
    try {
      res.json(await service!.compare(String(req.params.id), baseSha, targetSha));
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/codeup/repositories/:id/file", async (req: Request, res: Response) => {
    const baseSha = queryString(req.query.baseSha);
    const targetSha = queryString(req.query.targetSha);
    const filePath = queryString(req.query.path);
    const oldPath = queryString(req.query.oldPath);
    const changeType = queryString(req.query.changeType);
    const validTypes: CodeupChangeType[] = ["added", "modified", "deleted", "renamed"];
    if (!baseSha || !targetSha || !filePath || !oldPath || !changeType || !validTypes.includes(changeType as CodeupChangeType)) {
      res.status(400).json({ error: "Missing or invalid file comparison parameters." });
      return;
    }
    try {
      const file: CodeupChangedFile = { path: filePath, oldPath, changeType: changeType as CodeupChangeType, isBinary: false };
      res.json(await service!.getFileDiff(String(req.params.id), baseSha, targetSha, file));
    } catch (error) { sendError(res, error); }
  });

  const frontendDistPath = resolveFrontendDistPath(import.meta.url);
  if (frontendDistPath) {
    app.use(express.static(frontendDistPath));
    app.get("/{*path}", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile("index.html", { root: frontendDistPath });
    });
  }
  return app;
}
