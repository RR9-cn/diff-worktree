// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CodeupApp } from "./CodeupApp";

const api = vi.hoisted(() => ({
  getCodeupStatus: vi.fn(),
  listCodeupRepositories: vi.fn(),
  listCodeupBranches: vi.fn(),
  compareCodeupBranches: vi.fn(),
  getCodeupFileDiff: vi.fn(),
}));

vi.mock("./api/codeupClient", () => api);
vi.mock("./components/DiffViewerPane", () => ({
  DiffViewerPane: ({ diffFile, readOnly, renderSideBySide }: { diffFile: { left: string; right: string } | null; readOnly: boolean; renderSideBySide: boolean }) =>
    <div data-testid="diff-viewer" data-read-only={String(readOnly)} data-side-by-side={String(renderSideBySide)}>{diffFile ? `${diffFile.left} => ${diffFile.right}` : ""}</div>,
}));

const baseSha = "a".repeat(40);
const targetSha = "b".repeat(40);

beforeEach(() => {
  vi.resetAllMocks();
  api.getCodeupStatus.mockResolvedValue({ configured: true });
  api.listCodeupRepositories.mockResolvedValue([{ id: "42", name: "demo", fullPath: "team/demo" }]);
  api.listCodeupBranches.mockResolvedValue([
    { name: "master", sha: baseSha, isDefault: true },
    { name: "feature", sha: targetSha, isDefault: false },
  ]);
  api.compareCodeupBranches.mockResolvedValue({
    baseSha, targetSha,
    files: [{ path: "src/a.ts", oldPath: "src/a.ts", changeType: "modified", isBinary: false }],
  });
  api.getCodeupFileDiff.mockResolvedValue({
    path: "src/a.ts", changeType: "modified", language: "ts",
    left: "before", right: "after", isBinary: false, tooLarge: false,
  });
});

afterEach(() => cleanup());

describe("CodeupApp", () => {
  it("compares pinned branch commits and renders a read-only diff", async () => {
    render(<CodeupApp />);
    await screen.findByRole("option", { name: "team/demo" });
    fireEvent.change(screen.getByLabelText("仓库"), { target: { value: "42" } });
    await waitFor(() => expect(screen.getByLabelText("基准分支")).toHaveValue("master"));
    expect(screen.getByLabelText("目标分支")).toHaveValue("");
    expect(screen.getByText("已加载 2 条分支")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看分支列表" }));
    expect(screen.getByRole("region", { name: "分支列表" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设 feature 为目标分支" }));
    expect(screen.getByLabelText("目标分支")).toHaveValue("feature");
    fireEvent.click(screen.getByRole("button", { name: "比较分支" }));

    await waitFor(() => expect(api.compareCodeupBranches).toHaveBeenCalledWith("42", baseSha, targetSha));
    await waitFor(() => expect(api.getCodeupFileDiff).toHaveBeenCalled());
    expect(await screen.findByText("before => after")).toBeInTheDocument();
    expect(screen.getByTestId("diff-viewer")).toHaveAttribute("data-read-only", "true");
  });

  it("shows server configuration guidance without credentials", async () => {
    api.getCodeupStatus.mockResolvedValue({ configured: false });
    render(<CodeupApp />);
    expect(await screen.findByRole("alert")).toHaveTextContent("CODEUP_TOKEN");
    expect(api.listCodeupRepositories).not.toHaveBeenCalled();
  });

  it("filters the change tree and uses a single diff column on narrow screens", async () => {
    api.compareCodeupBranches.mockResolvedValue({
      baseSha, targetSha,
      files: [
        { path: "src/a.ts", oldPath: "src/a.ts", changeType: "modified", isBinary: false },
        { path: "src/new.ts", oldPath: "src/new.ts", changeType: "added", isBinary: false },
      ],
    });
    render(<CodeupApp />);
    await screen.findByRole("option", { name: "team/demo" });
    fireEvent.change(screen.getByLabelText("仓库"), { target: { value: "42" } });
    await waitFor(() => expect(screen.getByLabelText("基准分支")).toHaveValue("master"));
    fireEvent.change(screen.getByLabelText("目标分支"), { target: { value: "feature" } });
    fireEvent.click(screen.getByRole("button", { name: "比较分支" }));
    await screen.findByRole("button", { name: "new.ts" });

    fireEvent.click(screen.getByRole("button", { name: "新增 1" }));
    expect(screen.queryByRole("button", { name: "a.ts" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "new.ts" })).toBeInTheDocument();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    fireEvent(window, new Event("resize"));
    expect(screen.getByTestId("diff-viewer")).toHaveAttribute("data-side-by-side", "false");
  });
});
