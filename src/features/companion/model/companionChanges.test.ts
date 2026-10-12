import { beforeEach, describe, expect, it, vi } from "vitest";

type State = {
  cwd: string;
  head: string | null;
  branch: string | null;
  staged: boolean;
  unstaged: boolean;
  original: string;
  current: string;
};

let state: State;
const fs = vi.hoisted(() => ({
  gitDiffIndex: vi.fn(),
  gitFileDiff: vi.fn(),
}));

vi.mock("../../../platform/tauri/fs", () => ({ ...fs }));

import { createCompanionChanges } from "./companionChanges";

function configureMocks() {
  fs.gitDiffIndex.mockImplementation(async (cwd: string) => ({
    branch: state.branch,
    head: state.head,
    files: cwd === state.cwd ? [{
      path: `${cwd}/a.ts`, relative: "a.ts", status: "modified",
      additions: 1, deletions: 1, staged: state.staged, unstaged: state.unstaged,
    }] : [],
    additions: 1,
    deletions: 1,
    remote: null,
    upstream: null,
    defaultBranch: null,
    ahead: 0,
    behind: 0,
    aheadOfDefault: 0,
    headPushed: true,
  }));
  fs.gitFileDiff.mockImplementation(async (cwd: string, relative: string, kind: string) => ({
    path: `${cwd}/${relative}`,
    relative,
    status: "modified",
    original: state.original,
    current: kind === "staged" ? state.current : `${state.current} worktree`,
    binary: false,
    tooLarge: false,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    cwd: "/work/project", head: "head", branch: "main", staged: false, unstaged: true,
    original: "before\n", current: "after\n",
  };
  configureMocks();
});

describe("companion changes boundary", () => {
  it("lists the authorized index without loading every file diff", async () => {
    state.staged = true;
    const changes = createCompanionChanges(() => state.cwd);
    const first = await changes.list({ projectId: "project" });
    expect(first.files).toHaveLength(1);
    expect(fs.gitFileDiff).not.toHaveBeenCalled();
  });

  it("keeps list and selected-read revision metadata compatible", async () => {
    const changes = createCompanionChanges(() => state.cwd);
    const list = await changes.list({ projectId: "project" });
    const read = await changes.read({ projectId: "project" }, "a.ts", "unstaged");
    expect(read.revision).toBe(list.revision);
  });

  it("binds a list revision to the resolved cwd and advertised index, not just counts", async () => {
    let cwd = state.cwd;
    const changes = createCompanionChanges(() => cwd);
    const first = await changes.list({ projectId: "project" });
    state.staged = true;
    expect((await changes.list({ projectId: "project" })).revision).not.toBe(first.revision);
    cwd = "/work/other";
    expect((await changes.list({ projectId: "project" })).revision).not.toBe(first.revision);
  });

  it("rejects traversal and files absent from the advertised changes", async () => {
    const changes = createCompanionChanges(() => state.cwd);
    await expect(changes.read({ projectId: "project" }, "../secret", "unstaged"))
      .rejects.toThrow("Invalid changed file path");
    await expect(changes.read({ projectId: "project" }, "missing.ts", "unstaged"))
      .rejects.toThrow("no longer available");
    await changes.list({ projectId: "project" });
    state.unstaged = false;
    await expect(changes.read({ projectId: "project" }, "a.ts", "unstaged"))
      .rejects.toThrow("no longer available");
  });

  it("enforces the file cap and truncates an oversized selected diff", async () => {
    fs.gitDiffIndex.mockResolvedValueOnce({
      branch: "main", head: "head", additions: 0, deletions: 0,
      files: Array.from({ length: 201 }, (_, index) => ({
        path: `/work/project/${index}.ts`, relative: `${index}.ts`, status: "modified",
        additions: 0, deletions: 0, staged: false, unstaged: true,
      })),
    });
    const changes = createCompanionChanges(() => state.cwd);
    await expect(changes.list({ projectId: "project" }))
      .rejects.toThrow("Too many changed files");
    expect(fs.gitFileDiff).not.toHaveBeenCalled();

    state.current = "x".repeat(2.1 * 1024 * 1024);
    await expect(changes.read({ projectId: "project" }, "a.ts", "unstaged"))
      .resolves.toMatchObject({ truncated: true });
  });

  it("reads only the requested file when other advertised files exist", async () => {
    fs.gitDiffIndex.mockImplementation(async (cwd: string) => ({
      branch: state.branch,
      head: state.head,
      files: [
        { path: `${cwd}/a.ts`, relative: "a.ts", status: "modified", additions: 1, deletions: 1, staged: false, unstaged: true },
        { path: `${cwd}/b.ts`, relative: "b.ts", status: "modified", additions: 1, deletions: 1, staged: false, unstaged: true },
      ],
      additions: 2,
      deletions: 2,
    }));
    const changes = createCompanionChanges(() => state.cwd);
    await changes.list({ projectId: "project" });
    state.current = "updated a\n";
    const result = await changes.read({ projectId: "project" }, "a.ts", "unstaged");
    expect(result.current).toBe("updated a\n worktree");
    expect(fs.gitFileDiff).toHaveBeenCalledTimes(1);
    expect(fs.gitFileDiff).toHaveBeenCalledWith(state.cwd, "a.ts", "unstaged");
  });
});
