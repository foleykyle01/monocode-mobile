import type {
  Block,
  MonoSpawnedSession,
  Session,
} from "../../sessions/model/session";
import { isLiveAgentSession } from "../../sessions/model/liveAgents";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { pathKey } from "../../../shared/lib/paths";
import { monoState, type Mono, type MonoState, type MonoStatus } from "./mono";
import { monoSpawnedSessions } from "./monoSpawnedSessions";

export type MonoActivitySession = MonoSpawnedSession & { state: MonoState };
export type MonoActivitySnapshot = {
  sessions: MonoActivitySession[];
  children: Record<string, string[]>;
};

/** A linked project's current state, or its last observed state once idle. */
export type MonoProjectScope = {
  path: string;
  status: MonoStatus;
};

type MonoLastProjectScopes = ReadonlyMap<string, readonly string[]>;

const LAST_PROJECT_SCOPES_KEY = "monocode:mono-last-project-scopes";
const MAX_PROJECT_SCOPES = 20;

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
  const { sessions, children } = mergedActivitySnapshots(snapshots);
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

/**
 * Projects are evidence-based: only a currently live child linked by the
 * Mono is included. A child keeps its project `cwd` even when it runs in a
 * different worktree, so this remains an exact canonical-project lookup.
 */
export function monoActivityProjectScopes(
  monos: readonly Mono[],
  snapshots: readonly MonoActivitySnapshot[],
): ReadonlyMap<string, readonly MonoProjectScope[]> {
  const { sessions, children } = mergedActivitySnapshots(snapshots);
  return new Map(
    monos.map((mono) => {
      const projects = new Map(
        mono.projects.map((path) => [pathKey(path), path] as const),
      );
      const active = new Map<string, MonoStatus>();
      for (const id of children.get(mono.sessionId ?? "") ?? []) {
        const session = sessions.get(id);
        if (!session || session.state.status === "idle") continue;
        const path = projects.get(pathKey(session.cwd));
        if (!path) continue;
        const previous = active.get(pathKey(path));
        if (
          !previous ||
          priority(session.state) > priority({ status: previous })
        )
          active.set(pathKey(path), session.state.status);
      }
      return [
        mono.id,
        mono.projects
          .flatMap((path) => {
            const status = active.get(pathKey(path));
            return status ? [{ path, status }] : [];
          })
          .slice(0, MAX_PROJECT_SCOPES),
      ];
    }),
  );
}

/** Read only bounded canonical paths, pruning deleted Monos and assignments. */
export function loadMonoLastProjectScopes(
  monos: readonly Mono[],
): MonoLastProjectScopes {
  try {
    const raw = localStorage.getItem(LAST_PROJECT_SCOPES_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return new Map();
    const paths = new Map<string, readonly string[]>();
    for (const [monoId, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      paths.set(
        monoId,
        value.filter((path): path is string => typeof path === "string"),
      );
    }
    return pruneMonoLastProjectScopes(monos, paths);
  } catch {
    return new Map();
  }
}

/**
 * A new active set replaces a Mono's remembered scope. Idle Monos retain their
 * last observed paths, while removed Monos and assignments disappear safely.
 */
export function updateMonoLastProjectScopes(
  monos: readonly Mono[],
  previous: MonoLastProjectScopes,
  active: ReadonlyMap<string, readonly MonoProjectScope[]>,
): MonoLastProjectScopes {
  const next = new Map(pruneMonoLastProjectScopes(monos, previous));
  for (const mono of monos) {
    const paths = active.get(mono.id);
    if (!paths?.length) continue;
    next.set(
      mono.id,
      paths.map((scope) => scope.path),
    );
  }
  return next;
}

/** Active linked work wins; otherwise display the retained, quiet scope. */
export function monoProjectScopes(
  monos: readonly Mono[],
  active: ReadonlyMap<string, readonly MonoProjectScope[]>,
  previous: MonoLastProjectScopes,
): ReadonlyMap<string, readonly MonoProjectScope[]> {
  const retained = pruneMonoLastProjectScopes(monos, previous);
  return new Map(
    monos.map((mono) => {
      const current = active.get(mono.id);
      return [
        mono.id,
        current?.length
          ? current
          : (retained.get(mono.id) ?? []).map((path) => ({
              path,
              status: "idle" as const,
            })),
      ];
    }),
  );
}

/** Persist paths only; session titles, IDs and transcript content never leave memory. */
export function saveMonoLastProjectScopes(
  monos: readonly Mono[],
  scopes: MonoLastProjectScopes,
) {
  const pruned = pruneMonoLastProjectScopes(monos, scopes);
  const saved = Object.fromEntries(
    [...pruned].filter(([, paths]) => paths.length > 0),
  );
  try {
    localStorage.setItem(LAST_PROJECT_SCOPES_KEY, JSON.stringify(saved));
  } catch {
    // Private mode / quota: this window still keeps the in-memory projection.
  }
}

function pruneMonoLastProjectScopes(
  monos: readonly Mono[],
  scopes: MonoLastProjectScopes,
): MonoLastProjectScopes {
  return new Map(
    monos.flatMap((mono) => {
      const remembered = scopes.get(mono.id);
      if (!remembered?.length) return [];
      const wanted = new Set(remembered.map(pathKey));
      const paths = mono.projects
        .filter((path) => wanted.has(pathKey(path)))
        .slice(0, MAX_PROJECT_SCOPES);
      return paths.length ? [[mono.id, paths] as const] : [];
    }),
  );
}

function mergedActivitySnapshots(snapshots: readonly MonoActivitySnapshot[]) {
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
  return { sessions, children };
}

function priority(state: MonoState): number {
  return state.status === "needs-you" ? 2 : state.status === "working" ? 1 : 0;
}
