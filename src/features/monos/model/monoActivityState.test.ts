// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  newSession,
  type Block,
  type Session,
} from "../../sessions/model/session";
import type { Mono } from "./mono";
import {
  monoActivityChildren,
  loadMonoLastProjectScopes,
  monoActivityProjectScopes,
  monoActivitySessions,
  monoProjectScopes,
  monoActivityStates,
  saveMonoLastProjectScopes,
  updateMonoLastProjectScopes,
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

function projectScopes(
  monos: readonly Mono[],
  sessions: Session[],
  children: Record<string, string[]> = monoActivityChildren(
    monos,
    sessions,
    new Map(),
    monoActivitySessions(sessions),
  ),
) {
  return monoActivityProjectScopes(monos, [
    { sessions: monoActivitySessions(sessions), children },
  ]);
}

beforeEach(() => localStorage.clear());

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
    { cwd: "remote://other/repo" },
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

describe("Mono project scope projection", () => {
  it("groups linked children by their canonical project and prioritizes Needs you", () => {
    const sibling = {
      ...child,
      id: "sibling",
      worktreeCwd: "/worktrees/review",
      pendingQuestion: { requestId: 1, questions: [] },
    };
    const linked = {
      ...parent,
      blocks: [
        {
          ...parent.blocks[0],
          monoSpawnedSessions: [launch, { ...launch, sessionId: sibling.id }],
        },
      ],
    };
    expect(projectScopes([mono, otherMono], [linked, child, sibling])).toEqual(
      new Map([
        [mono.id, [{ path: "/repo", status: "needs-you" }]],
        [otherMono.id, []],
      ]),
    );
  });

  it("keeps two Monos isolated and ignores unlinked sessions", () => {
    const secondMono: Mono = { ...otherMono, projects: ["/second"] };
    const second = { ...child, id: "second-child", cwd: "/second" };
    const secondParent = {
      ...parent,
      id: "other-parent",
      blocks: [
        {
          ...parent.blocks[0],
          monoSpawnedSessions: [
            { ...launch, sessionId: second.id, cwd: second.cwd },
          ],
        },
      ],
    };
    expect(
      projectScopes([mono, secondMono], [parent, child, secondParent, second]),
    ).toEqual(
      new Map([
        [mono.id, [{ path: "/repo", status: "working" }]],
        [secondMono.id, [{ path: "/second", status: "working" }]],
      ]),
    );
    expect(
      projectScopes([mono], [parent, child], { parent: ["archived"] }),
    ).toEqual(new Map([[mono.id, []]]));
  });

  it("retains idle scope, replaces it on new linked work, and prunes roster changes", () => {
    const multi: Mono = { ...mono, projects: ["/repo", "/next"] };
    const first = projectScopes([multi], [parent, child]);
    const remembered = updateMonoLastProjectScopes([multi], new Map(), first);
    expect(monoProjectScopes([multi], new Map(), remembered)).toEqual(
      new Map([[multi.id, [{ path: "/repo", status: "idle" }]]]),
    );

    const next = { ...child, id: "next", cwd: "/next" };
    const moved = {
      ...parent,
      blocks: [
        {
          ...parent.blocks[0],
          monoSpawnedSessions: [
            { ...launch, sessionId: next.id, cwd: next.cwd },
          ],
        },
      ],
    };
    const replacement = updateMonoLastProjectScopes(
      [multi],
      remembered,
      projectScopes([multi], [moved, next]),
    );
    saveMonoLastProjectScopes([multi], replacement);
    expect(loadMonoLastProjectScopes([multi])).toEqual(
      new Map([[multi.id, ["/next"]]]),
    );
    expect(monoProjectScopes([multi], new Map(), replacement)).toEqual(
      new Map([[multi.id, [{ path: "/next", status: "idle" }]]]),
    );
    expect(loadMonoLastProjectScopes([])).toEqual(new Map());
    expect(
      loadMonoLastProjectScopes([{ ...multi, projects: ["/repo"] }]),
    ).toEqual(new Map());
  });

  it("keeps another owner’s retained scope when saving only changed Monos", () => {
    const first: Mono = { ...mono, projects: ["/repo", "/next"] };
    const second: Mono = { ...otherMono, projects: ["/second"] };
    saveMonoLastProjectScopes(
      [first, second],
      new Map([
        [first.id, ["/repo"]],
        [second.id, ["/second"]],
      ]),
    );
    saveMonoLastProjectScopes(
      [first, second],
      new Map([
        [first.id, ["/next"]],
        [second.id, ["/second"]],
      ]),
      [first.id],
    );
    saveMonoLastProjectScopes(
      [first, second],
      new Map([
        [first.id, ["/repo"]],
        [second.id, ["/second"]],
      ]),
      [second.id],
    );
    expect(loadMonoLastProjectScopes([first, second])).toEqual(
      new Map([
        [first.id, ["/next"]],
        [second.id, ["/second"]],
      ]),
    );
  });

  it("does not create scope for a busy Mono parent without a linked child", () => {
    expect(projectScopes([mono], [{ ...parent, busy: true }])).toEqual(
      new Map([[mono.id, []]]),
    );
  });
});
