import type { Express, Request, Response } from "express";

import { refreshBranches } from "../services/gitService";

export function registerRefreshRoute(app: Express, repoRoot: string) {
  app.post("/api/refresh", async (_req: Request, res: Response) => {
    try {
      const branchLists = await refreshBranches(repoRoot, { syncRemotes: true });
      res.json(branchLists);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to refresh repository state.",
      });
    }
  });
}
