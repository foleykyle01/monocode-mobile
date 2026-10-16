import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, CircleAlert, CircleDashed, CircleX, Clock, Loader, X } from "../../src/shared/ui/icons";
import type { CompanionClient } from "./client";
import type { CompanionMono, CompanionMonoLinkedSession, CompanionMonoLinkedSessionPage } from "./types";

const UPDATE_MAC_MESSAGE = "Update MonoCode on your Mac to browse linked sessions.";

type Props = {
  client: CompanionClient;
  mono: CompanionMono;
  refreshToken: number;
  onOpen: (session: CompanionMonoLinkedSession) => void;
  onClose: () => void;
};

const SessionIcon = ({ state }: { state: CompanionMonoLinkedSession["state"] }) => {
  const Icon = {
    working: Loader,
    input: Clock,
    draft: CircleDashed,
    failed: CircleAlert,
    stopped: CircleX,
    done: Check,
    unknown: CircleDashed,
  }[state];
  return <Icon className={state === "working" ? "mono-working-spinner" : undefined} size={17} aria-hidden="true" />;
};

function errorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Could not load linked sessions";
  return /Mono details are unavailable|Invalid Mono detail section|Unsupported companion action/i.test(message)
    ? UPDATE_MAC_MESSAGE
    : message;
}

function sessionsPage(result: { sessions?: CompanionMonoLinkedSessionPage }) {
  if (!result.sessions) throw new Error(UPDATE_MAC_MESSAGE);
  return result.sessions;
}

function combinePages(pages: readonly CompanionMonoLinkedSessionPage[]): CompanionMonoLinkedSessionPage {
  const last = pages[pages.length - 1]!;
  const seen = new Set<string>();
  const items = pages.flatMap(page => page.items).filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return { ...last, offset: 0, items };
}

/** A paged, read-only list of sessions explicitly launched from this Mono. */
export function MonoLinkedSessions({ client, mono, refreshToken, onOpen, onClose }: Props) {
  const [page, setPage] = useState<CompanionMonoLinkedSessionPage>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const pageRef = useRef<CompanionMonoLinkedSessionPage | undefined>(undefined);
  const queue = useRef(Promise.resolve());
  const generation = useRef(0);
  const refreshQueued = useRef(false);
  const refreshPending = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);

  const current = useCallback((request: number) => request === generation.current, []);
  const readPage = useCallback(async (offset: number) => sessionsPage(await client.monoRead(mono.id, "sessions", offset)), [client, mono.id]);
  const commit = useCallback((next: CompanionMonoLinkedSessionPage, request: number) => {
    if (!current(request)) return false;
    const scrollTop = body.current?.scrollTop;
    pageRef.current = next;
    setPage(next);
    if (scrollTop !== undefined) requestAnimationFrame(() => {
      if (current(request) && body.current) body.current.scrollTop = scrollTop;
    });
    return true;
  }, [current]);
  const enqueue = useCallback((request: number, work: () => Promise<void>) => {
    const guarded = () => current(request) ? work() : Promise.resolve();
    const pending = queue.current.then(guarded, guarded);
    queue.current = pending.catch(() => undefined);
    return pending;
  }, []);

  const refreshLoaded = useCallback(async (request: number, extent: number, retry = false) => {
    const pages: CompanionMonoLinkedSessionPage[] = [];
    let offset = 0;
    while (current(request)) {
      const next = await readPage(offset);
      if (!current(request)) return;
      if (next.offset !== offset && !retry) {
        await refreshLoaded(request, Math.min(extent, next.total), true);
        return;
      }
      pages.push(next);
      if (next.nextOffset === undefined || next.nextOffset <= offset || next.nextOffset >= extent) break;
      offset = next.nextOffset;
    }
    if (!pages.length) return;
    const combined = combinePages(pages);
    if (!retry && combined.items.length < Math.min(extent, combined.total)) {
      await refreshLoaded(request, extent, true);
      return;
    }
    commit(combined, request);
  }, [commit, current, readPage]);

  const scheduleRefresh = useCallback(() => {
    const request = generation.current;
    // `undefined` means the first page has not completed; an empty page is a
    // real result and must keep polling for newly launched children.
    if (!pageRef.current) return;
    refreshPending.current = true;
    if (refreshQueued.current) return;
    refreshQueued.current = true;
    setLoading(true);
    setError(undefined);
    void enqueue(request, async () => {
      try {
        do {
          refreshPending.current = false;
          await refreshLoaded(request, Math.max(1, pageRef.current?.items.length ?? 0));
        } while (current(request) && refreshPending.current);
      } catch (reason) {
        if (current(request)) setError(errorMessage(reason));
      } finally {
        if (current(request)) {
          refreshQueued.current = false;
          setLoading(false);
        }
      }
    });
  }, [current, enqueue, refreshLoaded]);

  const loadMore = useCallback((offset: number) => {
    const request = generation.current;
    setLoadingMore(true);
    setError(undefined);
    void enqueue(request, async () => {
      try {
        const before = pageRef.current;
        if (!before || before.nextOffset !== offset || !current(request)) return;
        const next = await readPage(offset);
        if (!current(request)) return;
        const overlaps = next.offset !== offset || next.items.some(item => before.items.some(existing => existing.id === item.id));
        if (overlaps) {
          await refreshLoaded(request, Math.min(Math.max(before.items.length, offset + next.items.length), next.total));
          return;
        }
        commit({ ...next, offset: 0, items: [...before.items, ...next.items] }, request);
      } catch (reason) {
        if (current(request)) setError(errorMessage(reason));
      } finally {
        if (current(request)) setLoadingMore(false);
      }
    });
  }, [commit, current, enqueue, readPage, refreshLoaded]);

  useEffect(() => {
    const request = ++generation.current;
    queue.current = Promise.resolve();
    refreshQueued.current = false;
    refreshPending.current = false;
    setPage(undefined);
    pageRef.current = undefined;
    setLoading(true);
    setLoadingMore(false);
    setError(undefined);
    void enqueue(request, async () => {
      try {
        const next = await readPage(0);
        commit(next, request);
      } catch (reason) {
        if (current(request)) setError(errorMessage(reason));
      } finally {
        if (current(request)) setLoading(false);
      }
    });
    closeButton.current?.focus({ preventScroll: true });
    return () => { if (current(request)) ++generation.current; };
  }, [commit, current, enqueue, readPage]);

  // The workspace already polls the Mac. Refresh the loaded pages in order so
  // live sorting cannot discard rows or collapse the sheet after Show more.
  useEffect(() => {
    scheduleRefresh();
  }, [refreshToken, scheduleRefresh]);

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const targets = [...(surface.current?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), [href]:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])') || [])];
    if (!targets.length) { event.preventDefault(); return; }
    const index = targets.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); targets[targets.length - 1]?.focus(); }
    else if (!event.shiftKey && index === targets.length - 1) { event.preventDefault(); targets[0]?.focus(); }
  };

  return <section className="mono-linked-sessions" role="dialog" aria-modal="true" aria-labelledby="mono-linked-sessions-title" onKeyDown={trapFocus}>
    <button className="mono-linked-sessions__scrim" type="button" tabIndex={-1} aria-label="Close sessions backdrop" onClick={onClose} />
    <div ref={surface} className="mono-linked-sessions__surface">
      <header>
        <div><h3 id="mono-linked-sessions-title">Sessions</h3><p>{mono.name}’s linked sessions</p></div>
        <button ref={closeButton} className="mono-linked-sessions__close" type="button" aria-label="Close sessions" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>
      <div ref={body} className="mono-linked-sessions__body" aria-busy={loading}>
        {loading && !page ? <p role="status">Loading linked sessions…</p> : null}
        {error ? <p className="error-copy" role="alert">{error} <button type="button" onClick={scheduleRefresh}>Retry</button></p> : null}
        {page && !page.items.length ? <p className="mono-linked-sessions__empty">No linked sessions are available on this Mac.</p> : null}
        {page?.items.length ? <ul aria-label={`${mono.name} linked sessions`}>{page.items.map(session => <li key={session.id}>
          <button type="button" onClick={() => onOpen(session)} aria-label={`Open ${session.title} · ${session.statusLabel}`}>
            <span className="mono-linked-sessions__state" data-state={session.state}><SessionIcon state={session.state} /></span>
            <span><strong>{session.title}</strong><small>{session.statusLabel}</small></span>
          </button>
        </li>)}</ul> : null}
        {page?.nextOffset !== undefined ? <button className="mono-linked-sessions__more" type="button" disabled={loadingMore} onClick={() => loadMore(page.nextOffset!)}>{loadingMore ? "Loading…" : `Show more · ${page.total - page.items.length} sessions`}</button> : null}
      </div>
    </div>
  </section>;
}
