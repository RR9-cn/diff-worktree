import type { CAC } from "cac";
import type { Server } from "node:http";
import open from "open";

import { createCodeupServer } from "../../server/codeup/createCodeupServer";
import { codeupConfigFromEnv } from "../../server/codeup/codeupService";

function resolvePort(value?: string): number {
  if (!value) {
    return 0;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

export function registerStartCommand(cli: CAC) {
  cli
    .command("", "Start diff-worktree for Codeup branch comparison")
    .option("--port <port>", "Port for the local web server")
    .option("--host <host>", "Address to listen on (default: 127.0.0.1)")
    .option("--no-open", "Do not open a browser window")
    .action(async (options: { port?: string; host?: string; open?: boolean }) => {
      const port = resolvePort(options.port ?? process.env.PORT);
      const host = options.host ?? process.env.DIFF_WORKTREE_HOST ?? "127.0.0.1";
      const user = process.env.CODEUP_APP_USER?.trim();
      const password = process.env.CODEUP_APP_PASSWORD;
      if (!["127.0.0.1", "localhost", "::1"].includes(host) && (!user || !password)) {
        throw new Error("CODEUP_APP_USER and CODEUP_APP_PASSWORD are required for non-loopback hosts.");
      }
      const app = createCodeupServer(codeupConfigFromEnv(), fetch, user && password ? { user, password } : undefined);

      const server = await new Promise<Server>((resolve, reject) => {
        const nextServer = app.listen(port, host, () => {
          resolve(nextServer);
        });

        nextServer.on("error", reject);
      });

      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      const url = `http://localhost:${actualPort}`;
      if (options.open !== false) {
        await open(url);
      }

      process.stdout.write(`${url}\n`);

      await new Promise<void>((resolve) => {
        const shutdown = () => {
          server.close(() => {
            process.off("SIGINT", shutdown);
            process.off("SIGTERM", shutdown);
            resolve();
          });
        };

        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      });
    });
}
