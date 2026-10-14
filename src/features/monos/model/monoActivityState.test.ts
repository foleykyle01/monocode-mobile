import { describe, expect, it } from "vitest";
import {
  newSession,
  type Block,
  type Session,
} from "../../sessions/model/session";
import type { Mono } from "./mono";
import {
  monoActivityChildren,
  monoActivitySessions,
  monoActivityStates,
} from "./monoActivityState";

const mono: Mono = {
  id: "mono",
  sessionId: "parent",
  projects: ["/repo"],
  mascot: "crab",
  color: "blue",
};
const otherMono = { ...mono, id: "other", sessionId: "other-parent" };
const child = {
  ...newSession("codex", "/repo", "gpt-6"),
  id: "child",
  title: "Child task",
  busy: true,
};
const launch = {
  sessionId: child.id,
  cwd: child.cwd,
  title: child.title,
  harness: child.harness,
  model: child.model,
};
const parent: Session = {
  ...newSession("codex", "/repo"),
  id: "parent",
  blocks: [
    {
      id: "turn",
      role: "user",
      text: "Work",
      monoSpawnedSessions: [launch, launch],
    },
  ],
};
function project(sessions: Session[], saved = new Map<string, Block[]>()) {
  const live = monoActivitySessions(sessions);
  return monoActivityStates(
    [mono, otherMono],
    [
      {
        sessions: live,
        children: monoActivityChildren(
          [mono, otherMono],
          sessions,
          saved,
          live,
        ),
      },
    ],
  );
}

it("shows a busy child under its idle parent, deduplicates links, and excludes unrelated/sibling work", () => {
  const live = monoActivitySessions([parent, child]);
  const children = monoActivityChildren(
    [mono],
    [parent, child],
    new Map(),
    live,
  );
  expect(children.parent).toEqual(["child"]);
  expect(project([parent, child]).get("mono")).toEqual({
    status: "working",
    activity: "Child task",
  });
  expect(project([parent, child]).get("other")).toEqual({ status: "idle" });
  expect(project([parent, { ...child, id: "unrelated" }]).get("mono")).toEqual({
    status: "idle",
  });
  expect(parent.busy).toBeUndefined();
});

it("prioritizes actionable child input over parent/child work, preserving the parent's own attention", () => {
  const waiting = {
    ...child,
    busy: false,
    pendingQuestion: { requestId: 1, title: "Choose", questions: [] },
  };
  const workingParent = { ...parent, busy: true };
  expect(project([workingParent, waiting]).get("mono")).toEqual({
    status: "needs-you",
    activity: "Child task",
  });
  expect(
    project([{ ...workingParent, usageLimit: {} }, waiting]).get("mono"),
  ).toEqual({ status: "needs-you", activity: "Usage limit reached" });
  expect(
    project([workingParent, { ...child, busy: false }]).get("mono")?.status,
  ).toBe("working");
});

it("handles several children with input taking priority regardless of launch order", () => {
  const second = {
    ...child,
    id: "second",
    busy: false,
    blocks: [
      {
        id: "approval",
        role: "tool" as const,
        text: "Approve",
        approval: { requestId: 3 },
      },
    ],
  };
  const linked = {
    ...parent,
    blocks: [
      {
        ...parent.blocks[0],
        monoSpawnedSessions: [launch, { ...launch, sessionId: second.id }],
      },
    ],
  };
  expect(project([linked, child, second]).get("mono")?.status).toBe(
    "needs-you",
  );
  expect(project([linked, child]).get("mono")?.status).toBe("working");
  expect(project([linked]).get("mono")?.status).toBe("idle");
});

describe("settled and unavailable children", () => {
  it.each([
    { busy: false },
    {
      busy: false,
      blocks: [{ id: "end", role: "system", text: "Failed", notice: "error" }],
    },
    {
      busy: false,
      blocks: [
        { id: "end", role: "system", text: "Stopped", notice: "interrupt" },
      ],
    },
    {
      busy: false,
      blocks: [{ id: "draft", role: "user", text: "Later", draft: true }],
    },
    { worktreeRemoved: true, pendingQuestion: { requestId: 1, questions: [] } },
    { ephemeral: true },
    { orchestrationLeadId: "lead" },
  ] satisfies Partial<Session>[])(
    "does not leave activity behind: %j",
    (change) => {
      expect(
        project([parent, { ...child, ...change }]).get("mono")?.status,
      ).toBe("idle");
    },
  );
  it("excludes archived children even if a transient live copy remains", () => {
    expect(monoActivitySessions([child], new Set([child.id]))).toEqual([]);
  });
});

it("recovers historical and legacy follow-up links while using only live child status", () => {
  const send: Block = {
    id: "send",
    role: "tool",
    text: "monocode app sessions.send",
    tool: {
      status: "completed",
      detail: JSON.stringify({
        ok: true,
        result: { sessionId: "child", submitted: true },
      }),
    },
  };
  const saved = new Map([[parent.id, [send]]]);
  expect(project([child], saved).get("mono")?.status).toBe("working");
  expect(project([], saved).get("mono")?.status).toBe("idle");
  expect(
    project(
      [child],
      new Map([[parent.id, [{ ...send, text: "monocode app sessions.read" }]]]),
    ).get("mono")?.status,
  ).toBe("idle");
  expect(
    project([child], new Map([[parent.id, parent.blocks]])).get("mono")?.status,
  ).toBe("working");
});

it("combines current window owners without letting an idle duplicate hide live activity", () => {
  const links = { parent: ["child", "other-parent"] };
  const local = {
    sessions: monoActivitySessions([parent, { ...child, busy: false }]),
    children: links,
  };
  const remote = { sessions: monoActivitySessions([child]), children: {} };
  expect(
    monoActivityStates([mono, otherMono], [remote, local]).get("mono")?.status,
  ).toBe("working");
  expect(
    monoActivityStates([mono, otherMono], [local]).get("mono")?.status,
  ).toBe("idle");
  expect(
    monoActivityStates(
      [mono, otherMono],
      [
        local,
        {
          sessions: monoActivitySessions([{ ...child, id: "other-parent" }]),
          children: {},
        },
      ],
    ).get("mono")?.status,
  ).toBe("idle");
});
