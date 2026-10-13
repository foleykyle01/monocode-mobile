// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Navigation, monoStatusLabel, navigationProjects } from "./Navigation";
import { connectionMessage } from "./ConnectionNotice";
import type { CompanionNavigation, CompanionSession } from "./types";

const sessions: CompanionSession[] = [
  { id: "worktree", projectId: "app", title: "Fix reconnect", cwd: "/worktrees/feature", harness: "claude", model: "opus", busy: true, needsApproval: true, turn: 1 },
  { id: "other", projectId: "other", title: "Notes", cwd: "/notes", harness: "codex", model: "codex", busy: false, needsApproval: false, turn: 0 },
];
const navigation: CompanionNavigation = {
  groups: [{ id: "work", name: "Work", projectIds: ["app"] }],
  projects: [{ id: "app", name: "Companion", path: "/app", groupId: "work" }, { id: "empty", name: "Empty project", path: "/empty" }],
  monos: [{ id: "scout", name: "Scout", mascot: "ghost", color: "#459bf7", projectIds: ["app"], busy: true, needsApproval: false }],
};
afterEach(() => { vi.unstubAllGlobals(); });

describe("companion workspace navigation", () => {
  it("uses the project dots for running, attention and unread sessions, with no dot for idle or read sessions", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const rows = [
      { ...sessions[0], id: "running", title: "Running chat", needsApproval: false },
      { ...sessions[0], id: "attention", title: "Approval chat" },
      { ...sessions[0], id: "done", title: "Finished chat", busy: false, needsApproval: false },
      { ...sessions[0], id: "idle", title: "Idle chat", busy: false, needsApproval: false },
    ];
    const render = (unread: Set<string>) => act(async () => root.render(createElement(Navigation, { sessions: rows, navigation, query: "", filter: "all", unreadSessionIds: unread, onSession: vi.fn(), onMono: vi.fn() })));
    try {
      await render(new Set(["done"]));
      const items = [...container.querySelectorAll(".session-row")];
      for (const [index, state] of ["running", "attention", "done"].entries()) {
        const dot = items[index].querySelector(`.project-activity--${state}`);
        expect(dot).not.toBeNull();
        expect(dot?.textContent).toBe("");
        expect(dot?.getAttribute("aria-label")).toBeTruthy();
      }
      expect(items[3].querySelector(".project-activity")).toBeNull();
      expect(container.querySelector(".session-row__activity")).toBeNull();
      await render(new Set());
      expect(items[2].querySelector(".project-activity")).toBeNull();
      expect(items[0].querySelector(".project-activity--running")).not.toBeNull();
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it("shows a dot on projects while expanded and only on their group when collapsed, without counts", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Navigation, { sessions, navigation, query: "", filter: "all", onSession: vi.fn(), onMono: vi.fn() })));
      const group = container.querySelector<HTMLButtonElement>(".group-toggle")!;
      expect(container.querySelector(".project-toggle .project-activity--attention")).not.toBeNull();
      expect(group.querySelector(".project-activity")).toBeNull();
      expect(container.querySelector(".project-toggle .nav-count, .group-toggle .nav-count")).toBeNull();
      await act(async () => group.click());
      expect(group.querySelector(".project-activity--attention")?.textContent).toBe("");
      expect(container.querySelector(".project-toggle .project-activity--attention")).toBeNull();
      await act(async () => group.click());
      expect(group.querySelector(".project-activity")).toBeNull();
      expect(container.querySelector(".project-toggle .project-activity--attention")).not.toBeNull();
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it("uses explicit project identity for worktrees and preserves only the Mac's projects, including empty ones", () => {
    const groups = navigationProjects(sessions, navigation);
    expect(groups.map(group => group.name)).toEqual(["Work", "Ungrouped"]);
    expect(groups[0].projects[0].sessions.map(session => session.id)).toEqual(["worktree"]);
    expect(groups[1].projects.map(project => project.id)).toEqual(["empty"]);
  });

  it("falls back to session folders only when an older host omits navigation", () => {
    expect(navigationProjects([{ ...sessions[0], projectId: undefined }])[0].projects[0].path).toBe("/worktrees/feature");
  });

  it("does not turn the Mac's blank starter chat into a project when the project list is empty", () => {
    const blank = { ...sessions[0], id: "blank", projectId: undefined, cwd: "~", title: "claude", busy: false, needsApproval: false };
    expect(navigationProjects([blank], { groups: [], projects: [], monos: [] })).toEqual([]);
  });

  it("removes a deleted project on refresh or reconnect even if an old session remains", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const render = (snapshot: CompanionNavigation) => act(async () => root.render(createElement(Navigation, { sessions, navigation: snapshot, query: "", filter: "all", onSession: vi.fn(), onMono: vi.fn() })));
    try {
      await render(navigation);
      expect(container.querySelectorAll(".nav-project")).toHaveLength(2);
      await render({ ...navigation, projects: navigation.projects.filter(project => project.id !== "app") });
      expect(container.querySelectorAll(".nav-project")).toHaveLength(1);
      expect(container.textContent).not.toContain("Fix reconnect");
      await render({ groups: [], projects: [], monos: [] });
      expect(container.querySelector(".project-group")).toBeNull();
      expect(container.querySelector(".nav-project")).toBeNull();
      expect(container.querySelector(".session-row")).toBeNull();
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it("collapses groups, reveals search matches, opens Monos, and keeps Mono details read-only", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onSession = vi.fn(), onMono = vi.fn(), onMonoDetails = vi.fn();
    const render = async (query = "") => act(async () => root.render(createElement(Navigation, { sessions, navigation, query, filter: "all", onSession, onMono, onMonoDetails })));
    try {
      await render();
      await act(async () => container.querySelector<HTMLButtonElement>(".group-toggle")!.click());
      expect(container.textContent).not.toContain("Fix reconnect");
      await render("reconnect");
      expect(container.textContent).toContain("Work");
      expect(container.textContent).toContain("Companion");
      await act(async () => container.querySelector<HTMLButtonElement>(".session-row")!.click());
      expect(onSession).toHaveBeenCalledWith("worktree");
      await render("Scout");
      await act(async () => container.querySelector<HTMLButtonElement>(".mono-row")!.click());
      expect(onMono).toHaveBeenCalledWith("scout");
      await act(async () => container.querySelector<HTMLButtonElement>(".mono-details-button")!.click());
      expect(onMonoDetails).toHaveBeenCalledWith("scout");
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it("does not claim the Mac is offline when only reachability is known", () => {
    expect(connectionMessage(true, false).title).toBe("Can’t reach your Mac");
    expect(connectionMessage(false, false).title).toBe("This device is offline");
    expect(connectionMessage(true, true).title).toBe("Reconnecting to your Mac");
  });

  it("shows the desktop Mono state and falls back to the compatible local status", () => {
    expect(monoStatusLabel(navigation.monos[0])).toBe("Working");
    expect(monoStatusLabel({ ...navigation.monos[0], statusLabel: "" })).toBe("Working");
  });

  it("remembers collapsed groups and projects and collapses to either level at once", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    const container = document.createElement("div"); document.body.append(container);
    let root = createRoot(container);
    const render = () => act(async () => root.render(createElement(Navigation, { sessions, navigation, query: "", filter: "all", onSession: vi.fn(), onMono: vi.fn() })));
    const click = (selector: string, text?: string) => act(async () => { ([...container.querySelectorAll<HTMLButtonElement>(selector)].find(button => !text || button.textContent === text))!.click(); });
    const titles = () => [...container.querySelectorAll(".session-row strong")].map(node => node.textContent);
    try {
      await render();
      expect(titles()).toEqual(["Fix reconnect"]);
      await click(".nav-collapse button", "Projects");
      expect(titles()).toEqual([]);
      expect(container.querySelectorAll(".project-toggle")).toHaveLength(2);
      await click(".nav-collapse button", "Groups");
      expect(container.querySelectorAll(".project-toggle")).toHaveLength(0);
      await click(".group-toggle");
      act(() => root.unmount());
      root = createRoot(container);
      await render();
      expect(container.querySelector(".group-toggle")?.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelectorAll(".project-toggle")).toHaveLength(1);
      expect(titles()).toEqual([]);
    } finally {
      act(() => root.unmount());
      container.remove();
      localStorage.clear();
    }
  });
});
