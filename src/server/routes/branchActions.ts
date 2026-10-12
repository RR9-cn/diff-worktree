import type { Express, Request, Response } from "express";

import { deleteLocalBranch, refreshBranches, updateLocalBranch } from "../services/gitService";

function badRequest(res: Response, message: string) {
  res.status(400).json({ error: message });
}

export function registerBranchActionsRoute(app: Express, repoRoot: string) {
  app.post("/api/branches/local/update", async (req: Request, res: Response) => {
    const branchName = req.body?.branchName;
    if (typeof branchName !== "string" || !branchName) {
      badRequest(res, "Missing or invalid branchName.");
      return;
    }

    try {
      await updateLocalBranch(repoRoot, branchName);
      res.json(await refreshBranches(repoRoot));
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to update local branch.",
      });
    }
  });

  app.post("/api/branches/local/delete", async (req: Request, res: Response) => {
    const branchName = req.body?.branchName;
    if (typeof branchName !== "string" || !branchName) {
      badRequest(res, "Missing or invalid branchName.");
      return;
    }

    try {
      await deleteLocalBranch(repoRoot, branchName);
      res.json(await refreshBranches(repoRoot));
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to delete local branch.",
      });
    }
  });

}
