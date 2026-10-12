import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Request, Response } from "express";

import { registerWorkspaceFileRoute } from "../src/server/routes/workspaceFile";

const createdDirs: string[] = [];

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function runGit(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}

function createRepo() {
  const repoRoot = makeTempDir("diff-worktree-workspace-file-");
  runGit(repoRoot, ["init", "--initial-branch=main"]);
  runGit(repoRoot, ["config", "user.name", "Test User"]);
  runGit(repoRoot, ["config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "base\n");
  runGit(repoRoot, ["add", "README.md"]);
  runGit(repoRoot, ["commit", "-m", "chore: base"]);
  return repoRoot;
}

function commitFile(repoRoot: string, relativePath: string, content: string) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
  runGit(repoRoot, ["add", relativePath]);
  runGit(repoRoot, ["commit", "-m", `add ${relativePath}`]);
}

function createHandler(repoRoot: string) {
  let handler:
    | ((req: Request, res: Response) => Promise<void> | void)
    | undefined;

  registerWorkspaceFileRoute(
    {
      post: (_path: string, nextHandler: (req: Request, res: Response) => Promise<void> | void) => {
        handler = nextHandler;
      },
    } as never,
    repoRoot,
  );

  if (!handler) {
    throw new Error("Expected workspace file route handler to register.");
  }

  return handler;
}

function createResponseRecorder() {
  let statusCode = 200;
  let jsonBody: unknown;

  const response = {
    json(body: unknown) {
      jsonBody = body;
      return this;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
  };

  return {
    response: response as unknown as Response,
    get jsonBody() {
      return jsonBody;
    },
    get statusCode() {
      return statusCode;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("POST /api/workspace-file", () => {
  it("writes content to a repo-relative file and creates parent directories", async () => {
    const repoRoot = createRepo();
    const handler = createHandler(repoRoot);
    const recorder = createResponseRecorder();

    await handler(
      {
        body: {
          baseBranch: "main",
          path: "src/generated/new.ts",
          content: "export const value = 1;\n",
        },
      } as Request,
      recorder.response,
    );

    expect(recorder.statusCode).toBe(200);
    expect(recorder.jsonBody).toEqual({
        path: "src/generated/new.ts",
        saved: true,
        reviewHash: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(fs.readFileSync(path.join(repoRoot, "src/generated/new.ts"), "utf8")).toBe(
      "export const value = 1;\n",
    );
  });

  it("rejects writes that escape the repository root", async () => {
    const repoRoot = createRepo();
    const handler = createHandler(repoRoot);
    const recorder = createResponseRecorder();

    await handler(
      {
        body: {
          baseBranch: "main",
          path: "../outside.txt",
          content: "nope\n",
        },
      } as Request,
      recorder.response,
    );

    expect(recorder.statusCode).toBe(400);
    expect(recorder.jsonBody).toEqual({
        error: expect.stringMatching(/outside the repository/i),
    });
  });

  it("rejects malformed bodies with a 400 response", async () => {
    const repoRoot = createRepo();
    const handler = createHandler(repoRoot);
    const recorder = createResponseRecorder();

    await handler(
      {
        body: {
          content: "missing path\n",
        },
      } as Request,
      recorder.response,
    );

    expect(recorder.statusCode).toBe(400);
    expect(recorder.jsonBody).toEqual({
        error: expect.any(String),
    });
  });

  it("writes renamed targets to the new repo-relative path", async () => {
    const repoRoot = createRepo();
    const handler = createHandler(repoRoot);
    const recorder = createResponseRecorder();

    await handler(
      {
        body: {
          baseBranch: "main",
          path: "src/renamed/new-name.ts",
          content: "export const renamed = true;\n",
        },
      } as Request,
      recorder.response,
    );

    expect(recorder.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(repoRoot, "src/renamed/new-name.ts"), "utf8")).toBe(
      "export const renamed = true;\n",
    );
  });

  it("reports a review hash that follows the saved content", async () => {
    const repoRoot = createRepo();
    commitFile(repoRoot, "src/a.ts", "export const a = 1;\n");
    const handler = createHandler(repoRoot);

    const firstRecorder = createResponseRecorder();
    await handler(
      {
        body: { baseBranch: "main", path: "src/a.ts", content: "export const a = 2;\n" },
      } as Request,
      firstRecorder.response,
    );
    const secondRecorder = createResponseRecorder();
    await handler(
      {
        body: { baseBranch: "main", path: "src/a.ts", content: "export const a = 3;\n" },
      } as Request,
      secondRecorder.response,
    );

    const firstHash = (firstRecorder.jsonBody as { reviewHash?: string }).reviewHash;
    const secondHash = (secondRecorder.jsonBody as { reviewHash?: string }).reviewHash;
    expect(firstHash).toMatch(/^[0-9a-f]{32}$/);
    expect(secondHash).not.toBe(firstHash);
  });

  it("omits the review hash once the saved content matches the base branch again", async () => {
    const repoRoot = createRepo();
    commitFile(repoRoot, "src/a.ts", "export const a = 1;\n");
    const handler = createHandler(repoRoot);
    const recorder = createResponseRecorder();

    await handler(
      {
        body: { baseBranch: "main", path: "src/a.ts", content: "export const a = 1;\n" },
      } as Request,
      recorder.response,
    );

    expect(recorder.statusCode).toBe(200);
    expect(recorder.jsonBody).toEqual({
      path: "src/a.ts",
      saved: true,
    });
  });

  it("rejects a save that carries no base branch to compute the review hash against", async () => {
    const repoRoot = createRepo();
    const handler = createHandler(repoRoot);
    const recorder = createResponseRecorder();

    await handler(
      {
        body: {
          path: "src/a.ts",
          content: "export const a = 2;\n",
        },
      } as Request,
      recorder.response,
    );

    expect(recorder.statusCode).toBe(400);
    expect(fs.existsSync(path.join(repoRoot, "src/a.ts"))).toBe(false);
  });
});
