# diff-worktree

`diff-worktree` 提供 Codeup 远端分支的只读比较页面。选择代码库、基准分支和目标分支后，可以查看变更文件树与并排差异。比较使用两个分支当时的提交 SHA，页面打开期间分支更新不会改变已显示的版本。

## 配置

服务端需要以下环境变量：

| 变量 | 用途 |
| --- | --- |
| `CODEUP_BASE_URL` | OpenAPI 的 HTTPS 接入地址；中心版默认使用 `https://openapi-rdc.aliyuncs.com`，Region 版必填 |
| `CODEUP_TOKEN` | 具有代码库只读权限的个人访问令牌 |
| `CODEUP_ORGANIZATION_ID` | 中心版组织 ID；Region 版留空 |
| `CODEUP_APP_USER`、`CODEUP_APP_PASSWORD` | 页面访问凭据；监听非本机地址时必填 |

Codeup 访问令牌仅由服务端向 Codeup 发送，浏览器页面不会收到令牌。监听非本机地址时，服务启用 HTTP Basic 身份认证；正式部署需要在前置代理终止 HTTPS，并通过 `--host` 指定监听地址。

## 从源码运行

```powershell
pnpm install --frozen-lockfile
pnpm run build
$env:CODEUP_TOKEN = "<read-only-token>"
$env:CODEUP_ORGANIZATION_ID = "<organization-id>"
node dist/main.js --no-open
```

Region 版省略 `CODEUP_ORGANIZATION_ID`，并设置 `CODEUP_BASE_URL`。服务默认监听 `127.0.0.1` 的可用端口；可用 `--port` 和 `--host` 指定端口及地址。

## 比较方式

服务从 Codeup 查询仓库和分支，以基准分支、目标分支的提交 SHA 调用 `GetCompare`，并设置 `straight=true`。选择文件时，按各自的提交 SHA 读取两侧文件内容。新增、删除、重命名文件分别处理；二进制文件及超过 256 KiB 的文件显示提示。

当前版本仅实现 Codeup；GitLab 接入和真实 Codeup 实例联调尚未完成。
