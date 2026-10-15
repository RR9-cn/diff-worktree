import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCodeupServer } from "../src/server/codeup/createCodeupServer";

let server: Server | undefined;

async function listen(app: ReturnType<typeof createCodeupServer>) {
  server = await new Promise<Server>((resolve) => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address.");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe("Codeup HTTP server", () => {
  it("serves setup status without repository credentials", async () => {
    const base = await listen(createCodeupServer(null));
    expect(await (await fetch(`${base}/api/codeup/status`)).json()).toEqual({ configured: false });
    expect((await fetch(`${base}/api/codeup/repositories`)).status).toBe(503);
  });

  it("protects token-backed repository responses with app credentials", async () => {
    const upstream = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-yunxiao-token")).toBe("codeup-secret");
      return Response.json([{ id: 42, name: "demo", pathWithNamespace: "team/demo" }]);
    }) as unknown as typeof fetch;
    const base = await listen(createCodeupServer(
      { baseUrl: "https://codeup.example.com", token: "codeup-secret" },
      upstream,
      { user: "reviewer", password: "app-secret" },
    ));
    expect((await fetch(`${base}/api/codeup/repositories`)).status).toBe(401);
    const response = await fetch(`${base}/api/codeup/repositories`, {
      headers: { authorization: `Basic ${Buffer.from("reviewer:app-secret").toString("base64")}` },
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("team/demo");
    expect(body).not.toContain("codeup-secret");
  });
});
