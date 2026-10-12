import type { Express, Request, Response } from "express";

import { refreshBranches } from "../services/gitService";

export function registerBranchesRoute(app: Express, repoRoot: string) {
  app.get("/api/branches", async (_req: Request, res: Response) => {
    try {
      const branchLists = await refreshBranches(repoRoot);
      res.json(branchLists);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to load branches.",
      });
    }
  });
}
