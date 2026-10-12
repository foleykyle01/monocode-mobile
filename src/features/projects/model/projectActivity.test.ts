import { expect, it } from "vitest";
import { newSession } from "../../sessions/model/session";
import { nextUnseenFinishedSessions } from "../../sessions/model/sessionDone";
import { projectActivityFromSessions } from "./projectActivity";
import { pathKey } from "../../../shared/lib/paths";

const counts = (sessions: ReturnType<typeof newSession>[], unseen = new Set<string>(), excluded = new Set<string>()) => projectActivityFromSessions(sessions, unseen, excluded);

it("counts running, input, and unread completions independently in the same project", () => {
  const running = { ...newSession("claude", "/repo"), busy: true, worktreeCwd: "/separate-worktree" };
  const waiting = { ...newSession("claude", "/repo/"), busy: true, blocks: [{ id: "approval", role: "approval" as const, text: "Allow?", approval: { requestId: 1 } }] };
  const done = newSession("claude", "/repo");
  const idle = newSession("claude", "/other");
  expect(counts([running, waiting, done, idle], new Set([done.id]))).toEqual(new Map([[pathKey("/repo"), { running: 1, attention: 1, done: 1 }]]));
});

it("clears only the completed chat that was viewed, then removes an idle project's badge", () => {
  const a = newSession("claude", "/repo");
  const b = newSession("claude", "/repo");
  let unread = nextUnseenFinishedSessions({ previousBusyIds: new Set([a.id, b.id]), busyIds: new Set(), previousUnseenIds: new Set() });
  expect(counts([a, b], unread).get(pathKey("/repo"))?.done).toBe(2);
  unread = nextUnseenFinishedSessions({ previousBusyIds: new Set(), busyIds: new Set(), previousUnseenIds: unread, focusedSessionId: a.id });
  expect(counts([a, b], unread).get(pathKey("/repo"))?.done).toBe(1);
  unread = nextUnseenFinishedSessions({ previousBusyIds: new Set(), busyIds: new Set(), previousUnseenIds: unread, focusedSessionId: b.id });
  expect(counts([a, b], unread).size).toBe(0);
});

it("does not show idle, hidden, removed, or Mono conversations as project activity", () => {
  const base = newSession("claude", "/repo");
  const mono = { ...base, id: "mono", busy: true };
  expect(counts([
    base, mono,
    { ...base, id: "worker", busy: true, orchestrationLeadId: "lead" },
    { ...base, id: "hidden", busy: true, ephemeral: true },
    { ...base, id: "removed", busy: true, worktreeRemoved: true },
  ], new Set(), new Set([mono.id])).size).toBe(0);
});

it("keeps remote machines separate and replaces stale done with running on a new turn", () => {
  const a = { ...newSession("claude", "remote://machine-a/repo"), busy: true };
  const b = newSession("claude", "remote://machine-b/repo");
  const result = counts([a, b], new Set([a.id, b.id]));
  expect(result.get(pathKey(a.cwd))).toEqual({ running: 1, attention: 0, done: 0 });
  expect(result.get(pathKey(b.cwd))).toEqual({ running: 0, attention: 0, done: 1 });
});
