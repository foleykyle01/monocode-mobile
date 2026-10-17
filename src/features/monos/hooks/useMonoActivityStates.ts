import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { emit, listen, TauriEvent } from "@tauri-apps/api/event";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import {
  plainEqual,
  useStableValue,
} from "../../../shared/hooks/useStableValue";
import {
  getMonoTranscriptPage,
  type SessionSummary,
} from "../../sessions/data/sessionStore";
import type { Block, Session } from "../../sessions/model/session";
import { listMonos, type MonoState } from "../model/mono";
import {
  monoActivityChildren,
  loadMonoLastProjectScopes,
  monoActivityProjectScopes,
  monoActivitySessions,
  monoProjectScopes,
  monoActivityStates,
  saveMonoLastProjectScopes,
  updateMonoLastProjectScopes,
  type MonoActivitySnapshot,
} from "../model/monoActivityState";

const CHANGED = "mono_activity_changed";
const REQUEST = "mono_activity_request";
type OwnerSnapshot = { owner: string; snapshot: MonoActivitySnapshot };

export type MonoActivityProjection = {
  states: ReadonlyMap<string, MonoState>;
  projectScopes: ReturnType<typeof monoProjectScopes>;
};

/** All roster entries follow their live owners, independently of the selected view. */
export function useMonoActivity(
  sessions: readonly Session[],
  rosterKey: string,
  history: readonly SessionSummary[] = [],
  enabled = true,
) {
  const monos = useMemo(
    () => (enabled ? listMonos() : []),
    [rosterKey, enabled],
  );
  const [owners, setOwners] = useState<
    ReadonlyMap<string, MonoActivitySnapshot>
  >(new Map());
  const [saved, setSaved] = useState<ReadonlyMap<string, readonly Block[]>>(
    new Map(),
  );
  const [lastProjectScopes, setLastProjectScopes] = useState(() =>
    loadMonoLastProjectScopes(monos),
  );
  const pages = useRef(new Map<string, Promise<Block[]>>());
  const localSessions = useStableValue(
    monoActivitySessions(
      enabled ? sessions : [],
      new Set(
        history
          .filter((session) => session.archived)
          .map((session) => session.id),
      ),
    ),
  );
  const known = useStableValue(
    [
      ...[...owners.values()].flatMap((owner) => owner.sessions),
      ...localSessions,
    ].map(({ state: _state, ...session }) => session),
  );

  // Read old links once per transcript window, never saved busy flags. Opening
  // details is not necessary, and streamed tokens do not repeat these reads.
  const historyKey = JSON.stringify(
    monos.flatMap((mono) => {
      if (!mono.sessionId) return [];
      const live = sessions.find((session) => session.id === mono.sessionId);
      if (live && live.monoTranscript?.before == null) return [];
      return [[mono.sessionId, live?.monoTranscript?.before ?? null]];
    }),
  );
  useEffect(() => {
    let current = true;
    const requests: [string, number | null][] = JSON.parse(historyKey);
    const keys = new Set(requests.map((request) => JSON.stringify(request)));
    for (const key of pages.current.keys())
      if (!keys.has(key)) pages.current.delete(key);
    void Promise.all(
      requests.map(async ([id, before]) => {
        const key = JSON.stringify([id, before]);
        let pending = pages.current.get(key);
        if (!pending) {
          pending = (async () => {
            const blocks: Block[] = [];
            let cursor = before ?? undefined;
            do {
              const page = await getMonoTranscriptPage(id, { before: cursor });
              blocks.unshift(
                ...page.blocks.filter(
                  (block) => block.tool || block.monoSpawnedSessions,
                ),
              );
              const next = page.before ?? undefined;
              if (next === cursor) break;
              cursor = next;
            } while (cursor != null);
            return blocks;
          })();
          pages.current.set(key, pending);
        }
        try {
          return [id, await pending] as const;
        } catch {
          pages.current.delete(key);
          return [id, []] as const;
        }
      }),
    ).then((entries) => {
      if (current) setSaved(new Map<string, readonly Block[]>(entries));
    });
    return () => {
      current = false;
    };
  }, [historyKey]);

  const local = useStableValue<MonoActivitySnapshot>({
    sessions: localSessions,
    children: monoActivityChildren(monos, sessions, saved, known),
  });
  const latest = useRef(local);
  latest.current = local;
  const publish = useRef<() => void>(() => {});
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const owner = getCurrentWindow().label;
    const send = () => {
      void emit(CHANGED, { owner, snapshot: latest.current }).catch(
        console.error,
      );
    };
    const prune = () => {
      void getAllWindows()
        .then((windows) => {
          if (disposed) return;
          const live = new Set(windows.map((window) => window.label));
          setOwners(
            (previous) => new Map([...previous].filter(([id]) => live.has(id))),
          );
        })
        .catch(console.error);
    };
    const subscriptions = [
      listen<OwnerSnapshot>(CHANGED, ({ payload }) => {
        if (disposed || payload.owner === owner) return;
        setOwners((previous) =>
          new Map(previous).set(payload.owner, payload.snapshot),
        );
      }),
      listen(REQUEST, send),
      listen(TauriEvent.WINDOW_DESTROYED, prune),
    ];
    void Promise.all(subscriptions)
      .then(() => {
        if (disposed) return;
        publish.current = send;
        send();
        void emit(REQUEST).catch(console.error);
      })
      .catch(console.error);
    window.addEventListener("focus", prune);
    return () => {
      disposed = true;
      publish.current = () => {};
      window.removeEventListener("focus", prune);
      void emit(CHANGED, {
        owner,
        snapshot: { sessions: [], children: {} },
      }).catch(console.error);
      for (const subscription of subscriptions)
        void subscription.then((stop) => stop());
    };
  }, []);
  useEffect(() => {
    publish.current();
  }, [local]);

  const snapshots = [...owners.values(), local];
  const states = useStableValue(monoActivityStates(monos, snapshots));
  const activeProjectScopes = useStableValue(
    monoActivityProjectScopes(monos, snapshots),
  );
  useEffect(() => {
    setLastProjectScopes((previous) => {
      const next = updateMonoLastProjectScopes(
        monos,
        previous,
        activeProjectScopes,
      );
      if (plainEqual(previous, next)) return previous;
      saveMonoLastProjectScopes(monos, next);
      return next;
    });
  }, [activeProjectScopes, monos]);
  const projectScopes = useStableValue(
    monoProjectScopes(monos, activeProjectScopes, lastProjectScopes),
  );
  return useStableValue({ states, projectScopes });
}

/** Compatibility view for consumers that only render the Mono's aggregate state. */
export function useMonoActivityStates(
  sessions: readonly Session[],
  rosterKey: string,
  history: readonly SessionSummary[] = [],
  enabled = true,
) {
  return useMonoActivity(sessions, rosterKey, history, enabled).states;
}
