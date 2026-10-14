import type {
  Block,
  MonoSpawnedSession,
  Session,
} from "../../sessions/model/session";
import { isLiveAgentSession } from "../../sessions/model/liveAgents";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { monoState, type Mono, type MonoState } from "./mono";
import { monoSpawnedSessions } from "./monoSpawnedSessions";

export type MonoActivitySession = MonoSpawnedSession & { state: MonoState };
export type MonoActivitySnapshot = {
  sessions: MonoActivitySession[];
  children: Record<string, string[]>;
};

const savedLaunches = new WeakMap<
  readonly Block[],
  {
    known: readonly MonoSpawnedSession[];
    launches: MonoSpawnedSession[];
  }
>();

/** Only current owners supply activity. Saved transcripts supply links, never busy state. */
export function monoActivitySessions(
  sessions: readonly Session[],
  excluded: ReadonlySet<string> = new Set(),
): MonoActivitySession[] {
  return sessions.flatMap((session) =>
    session.ephemeral ||
    session.worktreeRemoved ||
    isRemoteProjectPath(session.cwd) ||
    !isLiveAgentSession(session) ||
    excluded.has(session.id)
      ? []
      : [
          {
            sessionId: session.id,
            cwd: session.cwd,
            title: session.title,
            harness: session.harness,
            model: session.model,
            state: monoState(session),
          },
        ],
  );
}

export function monoActivityChildren(
  monos: readonly Mono[],
  sessions: readonly Session[],
  saved: ReadonlyMap<string, readonly Block[]>,
  known: readonly MonoSpawnedSession[],
): Record<string, string[]> {
  const children: Record<string, string[]> = {};
  for (const mono of monos) {
    if (!mono.sessionId) continue;
    const live = sessions.find((session) => session.id === mono.sessionId);
    const tail = live?.blocks ?? [];
    const older = saved.get(mono.sessionId);
    let cached = older && savedLaunches.get(older);
    if (older && cached?.known !== known) {
      cached = { known, launches: monoSpawnedSessions(older, known) };
      savedLaunches.set(older, cached);
    }
    children[mono.sessionId] = [
      ...new Set(
        [...(cached?.launches ?? []), ...monoSpawnedSessions(tail, known)].map(
          (launch) => launch.sessionId,
        ),
      ),
    ];
  }
  return children;
}

/** A presentation projection only; never feed this back into session controls. */
export function monoActivityStates(
  monos: readonly Mono[],
  snapshots: readonly MonoActivitySnapshot[],
): ReadonlyMap<string, MonoState> {
  const sessions = new Map<string, MonoActivitySession>();
  const children = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    for (const session of snapshot.sessions) {
      const previous = sessions.get(session.sessionId);
      // An idle copy in another window must not hide the current runtime.
      if (!previous || priority(session.state) > priority(previous.state))
        sessions.set(session.sessionId, session);
    }
    for (const [id, linked] of Object.entries(snapshot.children)) {
      const ids = children.get(id) ?? new Set<string>();
      linked.forEach((child) => ids.add(child));
      children.set(id, ids);
    }
  }
  const monoIds = new Set(
    monos.flatMap((mono) => (mono.sessionId ? [mono.sessionId] : [])),
  );
  return new Map(
    monos.map((mono) => {
      let state: MonoState = sessions.get(mono.sessionId ?? "")?.state ?? {
        status: "idle",
      };
      for (const id of children.get(mono.sessionId ?? "") ?? []) {
        if (monoIds.has(id)) continue;
        const child = sessions.get(id);
        if (child && priority(child.state) > priority(state))
          state = { status: child.state.status, activity: child.title };
      }
      return [mono.id, state];
    }),
  );
}

function priority(state: MonoState): number {
  return state.status === "needs-you" ? 2 : state.status === "working" ? 1 : 0;
}
