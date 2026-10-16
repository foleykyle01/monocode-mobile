import { describe, expect, it } from "vitest";
import type { Session } from "../../sessions/model/session";
import { leafIds, newFileTab, newTab, openEditorTab, type WorkspaceTab } from "./layout";
import { routeFileOpen } from "./fileOpenRoute";
import { workspaceTabCwd, workspaceTabWorktree } from "./workspaceTabGroups";

const activeProject = "/Users/me/projects/active";
const monoProject = "/Users/me/projects/mono";
const monoWorktree = "/Users/me/worktrees/mono-feature";
const downloadsFile = "/Users/me/Downloads/Workflow Diagram%.html";

function session(id: string, cwd: string, worktreeCwd?: string): Session {
  return {
    id,
    cwd,
    ...(worktreeCwd ? { worktreeCwd } : {}),
    harness: "codex",
    title: id,
    blocks: [],
    busy: false,
    model: "codex:gpt-test",
    runtimeMode: "supervised",
  };
}

function tab(id: string, sessionId: string): WorkspaceTab {
  return { ...newTab(sessionId), id };
}

function route(workspaceMode: boolean) {
  const active = openEditorTab(
    tab("active", "active-session"),
    newFileTab(downloadsFile, activeProject),
    { pin: true },
  );
  const mono = tab("mono", "mono-session");
  const sessions = [
    session("active-session", activeProject),
    session("mono-session", monoProject, monoWorktree),
  ];
  const result = routeFileOpen({
    tabs: [active, mono],
    sessions,
    activeTabId: active.id,
    file: newFileTab(
      downloadsFile,
      monoWorktree,
      false,
      undefined,
      monoProject,
    ),
    navigation: { line: 18, column: 4 },
    sourceSessionId: "mono-session",
    sourceCwd: monoWorktree,
    sourceProjectCwd: monoProject,
    workspaceMode,
    insert: (tabs, created) => [...tabs, created],
  });
  return { active, mono, sessions, result };
}

describe("routeFileOpen", () => {
  it("opens an exact Downloads link in its Mono tab, not the unrelated active project", () => {
    const { active, mono, sessions, result } = route(false);
    expect(result.tabId).toBe(mono.id);
    expect(result.tabs.find((tab) => tab.id === active.id)).toEqual(active);
    const target = result.tabs.find((tab) => tab.id === mono.id)!;
    expect(leafIds(target.layout)).toEqual([target.focusedId, "mono-session"]);
    expect(target.editorPanes[0]?.files).toMatchObject([
      { path: downloadsFile, cwd: monoWorktree, projectCwd: monoProject },
    ]);
    expect(workspaceTabCwd(target, sessions)).toBe(monoProject);
    expect(workspaceTabWorktree(target, sessions)).toBe(monoWorktree);
    expect(result.navigation).toEqual({
      path: downloadsFile,
      line: 18,
      column: 4,
    });
  });

  it("creates and selects a source-owned file workspace in workspace-tab mode", () => {
    const { active, sessions, result } = route(true);
    expect(result.tabId).not.toBe(active.id);
    // An identical path already open in the unrelated project cannot steal it.
    expect(result.tabs.find((tab) => tab.id === active.id)).toEqual(active);
    const target = result.tabs.find((tab) => tab.id === result.tabId)!;
    expect(target.editorPanes[0]?.files).toMatchObject([
      {
        path: downloadsFile,
        cwd: monoWorktree,
        projectCwd: monoProject,
        preview: true,
      },
    ]);
    expect(workspaceTabCwd(target, sessions)).toBe(monoProject);
    expect(workspaceTabWorktree(target, sessions)).toBe(monoWorktree);
    expect(result.navigation).toEqual({
      path: downloadsFile,
      line: 18,
      column: 4,
    });
  });
});
