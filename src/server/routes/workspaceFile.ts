import type { Express, Request, Response } from "express";

import { getReviewHash } from "../services/diffService";
import { writeWorkspaceFile } from "../services/workspaceFileService";

export function registerWorkspaceFileRoute(app: Express, repoRoot: string) {
  app.post("/api/workspace-file", async (req: Request, res: Response) => {
    const baseBranch = req.body?.baseBranch;
    const targetPath = req.body?.path;
    const content = req.body?.content;

    if (typeof baseBranch !== "string" || !baseBranch) {
      res.status(400).json({ error: "Missing or invalid baseBranch." });
      return;
    }

    if (typeof targetPath !== "string" || !targetPath || typeof content !== "string") {
      res.status(400).json({ error: "Missing or invalid path/content." });
      return;
    }

    try {
      const payload = await writeWorkspaceFile(repoRoot, targetPath, content);
      // The tree keys each checkbox on this hash, so the client needs the new one to drop a stale
      // "reviewed" tick without refetching the whole tree.
      res.json({ ...payload, reviewHash: await getReviewHash(repoRoot, baseBranch, targetPath) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save workspace file.";
      const status = /outside the repository/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });
}
