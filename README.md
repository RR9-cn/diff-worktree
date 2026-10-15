# diff-worktree

[中文文档](README.zh-CN.md)

`diff-worktree` is a read-only web UI for comparing two remote Codeup branches. Select a repository, a base branch, and a target branch to inspect changed files and a side-by-side diff. Each comparison uses the selected branches' commit SHAs, so the displayed result stays consistent if a branch advances later.

## Configuration

| Variable | Purpose |
| --- | --- |
| `CODEUP_BASE_URL` | OpenAPI HTTPS origin; defaults to `https://openapi-rdc.aliyuncs.com` for Central edition, required for Region edition |
| `CODEUP_TOKEN` | Personal access token with read-only repository permissions |
| `CODEUP_ORGANIZATION_ID` | Organization ID for Central edition; omit for Region edition |
| `CODEUP_APP_USER`, `CODEUP_APP_PASSWORD` | HTTP Basic credentials, required when listening on a non-loopback address |

The Codeup token stays on the server. Non-loopback deployments use HTTP Basic authentication and require HTTPS termination at a reverse proxy.

## Run from source

```sh
pnpm install --frozen-lockfile
pnpm run build
CODEUP_TOKEN=your-token CODEUP_ORGANIZATION_ID=your-org node dist/main.js --no-open
```

The server listens on `127.0.0.1` and an available port by default. Use `--port` and `--host` to set them explicitly. For Region edition, omit `CODEUP_ORGANIZATION_ID` and set `CODEUP_BASE_URL`.

The comparison uses Codeup `GetCompare` with `straight=true` and retrieves file contents only when a file is selected. Binary files and files over 256 KiB are not rendered inline.

GitLab support and end-to-end validation against a private Codeup instance remain future work.
