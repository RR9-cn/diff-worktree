import { describe, expect, it, vi } from "vitest";

import { CodeupService, codeupConfigFromEnv } from "../src/server/codeup/codeupService";

const baseSha = "a".repeat(40);
const targetSha = "b".repeat(40);

function mockService(responses: unknown[], organizationId?: string) {
  const calls: URL[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(new URL(String(input)));
    expect(new Headers(init?.headers).get("x-yunxiao-token")).toBe("test-token");
    return Response.json(responses.shift());
  }) as unknown as typeof fetch;
  const service = new CodeupService({ baseUrl: "https://codeup.example.com", token: "test-token", organizationId }, fetcher);
  return { calls, service };
}

describe("CodeupService", () => {
  it("uses the Central edition endpoint and maps repository and branch lists", async () => {
    const { service, calls } = mockService([
      [{ id: 42, name: "demo", pathWithNamespace: "team/demo" }],
      [{ name: "master", defaultBranch: true, commit: { id: baseSha } }],
    ], "org-1");
    expect(await service.listRepositories("demo")).toEqual([{ id: "42", name: "demo", fullPath: "team/demo", defaultBranch: undefined }]);
    expect(await service.listBranches("42")).toEqual([{ name: "master", sha: baseSha, isDefault: true }]);
    expect(calls[0].pathname).toBe("/oapi/v1/codeup/organizations/org-1/repositories");
    expect(calls[0].searchParams.get("search")).toBe("demo");
    expect(calls[1].pathname).toBe("/oapi/v1/codeup/organizations/org-1/repositories/42/branches");
  });

  it("uses direct SHA comparison and preserves renamed paths", async () => {
    const { service, calls } = mockService([{ diffs: [
      { oldPath: "src/old.ts", newPath: "src/new.ts", renamedFile: true },
      { oldPath: "added.ts", newPath: "added.ts", newFile: true },
      { oldPath: "deleted.ts", newPath: "deleted.ts", deletedFile: true },
    ] }]);
    expect(await service.compare("42", baseSha, targetSha)).toEqual({
      baseSha, targetSha, files: [
        { path: "src/new.ts", oldPath: "src/old.ts", changeType: "renamed", isBinary: false },
        { path: "added.ts", oldPath: "added.ts", changeType: "added", isBinary: false },
        { path: "deleted.ts", oldPath: "deleted.ts", changeType: "deleted", isBinary: false },
      ],
    });
    expect(calls[0].pathname).toBe("/oapi/v1/codeup/repositories/42/compares");
    expect(calls[0].searchParams.get("from")).toBe(baseSha);
    expect(calls[0].searchParams.get("to")).toBe(targetSha);
    expect(calls[0].searchParams.get("straight")).toBe("true");
  });

  it("loads both sides of a renamed file from pinned commits", async () => {
    const { service, calls } = mockService([
      { content: Buffer.from("old\n").toString("base64"), encoding: "base64", size: 4 },
      { content: Buffer.from("new\n").toString("base64"), encoding: "base64", size: 4 },
    ]);
    const file = await service.getFileDiff("42", baseSha, targetSha, {
      path: "src/new.ts", oldPath: "src/old.ts", changeType: "renamed", isBinary: false,
    });
    expect(file).toMatchObject({ left: "old\n", right: "new\n", tooLarge: false, language: "ts" });
    expect(calls[0].pathname).toBe("/oapi/v1/codeup/repositories/42/files/src%2Fold.ts");
    expect(calls[0].searchParams.get("ref")).toBe(baseSha);
    expect(calls[1].pathname).toBe("/oapi/v1/codeup/repositories/42/files/src%2Fnew.ts");
    expect(calls[1].searchParams.get("ref")).toBe(targetSha);
  });

  it("requires an HTTPS origin and keeps credentials on the server", () => {
    expect(() => codeupConfigFromEnv({ CODEUP_BASE_URL: "http://example.com", CODEUP_TOKEN: "token" })).toThrow(/HTTPS/);
    expect(codeupConfigFromEnv({ CODEUP_BASE_URL: "https://codeup.example.com", CODEUP_TOKEN: "token" })).toEqual({
      baseUrl: "https://codeup.example.com", token: "token", organizationId: undefined,
    });
    expect(codeupConfigFromEnv({ CODEUP_ORGANIZATION_ID: "org-1", CODEUP_TOKEN: "token" })).toEqual({
      baseUrl: "https://openapi-rdc.aliyuncs.com", token: "token", organizationId: "org-1",
    });
  });
});
