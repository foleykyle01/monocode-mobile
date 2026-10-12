// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { Mono } from "../../monos/model/mono";
import type { Session } from "../../sessions/model/session";
import {
  buildCompanionNavigation,
  companionProjectId,
} from "./companionNavigation";

const session = (id: string, cwd: string, busy = false): Session => ({
  id,
  cwd,
  busy,
  harness: "codex",
  model: "test",
  modelSettings: {},
  runtimeMode: "supervised",
  title: "Test",
  blocks: [],
});

const mono = (projects: string[], sessionId?: string): Mono => ({
  id: "mono-1",
  mascot: "ghost",
  color: "#ffffff",
  projects,
  ...(sessionId ? { sessionId } : {}),
});

beforeEach(() => localStorage.clear());

describe("companion navigation", () => {
  it("keeps the native rail and group order while using exact local project identities", () => {
    localStorage.setItem(
      "monocode:tab-group:labels",
      JSON.stringify({ "/work/client": "Client app" }),
    );
    const navigation = buildCompanionNavigation({
      projectPaths: [
        "/work/pinned",
        "/work/client",
        "/work/site",
        "remote://other/work/client",
      ],
      groups: [
        { id: "client-work", name: "Client work", collapsed: false },
        { id: "side", name: "Side", collapsed: false },
      ],
      assignments: { "/work/client": "client-work", "/work/site": "side" },
      monos: [mono(["/work/site", "remote://other/work/client"])],
      sessions: [
        {
          ...session("worktree", "/work/client"),
          worktreeCwd: "/work/client-worktree",
        },
        session("other", "/work/client-worktree"),
      ],
    });

    expect(navigation.projects).toMatchObject([
      { id: "/work/pinned", name: "pinned", path: "/work/pinned" },
      {
        id: "/work/client",
        name: "Client app",
        path: "/work/client",
        groupId: "client-work",
      },
      { id: "/work/site", name: "site", path: "/work/site", groupId: "side" },
    ]);
    expect(navigation.groups).toMatchObject([
      { id: "client-work", name: "Client work", projectIds: ["/work/client"] },
      { id: "side", name: "Side", projectIds: ["/work/site"] },
    ]);
    expect(navigation.monos[0]).toMatchObject({
      projectIds: ["/work/site"],
      canChat: false,
      status: "idle",
      statusLabel: "Idle",
      busy: false,
      needsApproval: false,
    });
    expect(companionProjectId("/work/client", navigation)).toBe("/work/client");
    expect(
      companionProjectId("/work/client-worktree", navigation),
    ).toBeUndefined();
  });

  it("links only initialized Mono conversations without exposing controls", () => {
    const waiting = session("mono-session", "/work/client", true);
    waiting.blocks.push({
      id: "approval",
      role: "approval",
      text: "Approve",
      approval: { requestId: 1 },
    });
    const navigation = buildCompanionNavigation({
      projectPaths: ["/work/client"],
      groups: [],
      assignments: {},
      monos: [mono(["/work/client"], waiting.id)],
      sessions: [waiting],
    });

    expect(navigation.monos).toEqual([
      expect.objectContaining({
        id: "mono-1",
        projectIds: ["/work/client"],
        sessionId: waiting.id,
        canChat: true,
        status: "needs-you",
        statusLabel: "Needs you",
        busy: false,
        needsApproval: true,
      }),
    ]);
    expect(navigation.monos[0]).not.toHaveProperty("configure");
  });
});
