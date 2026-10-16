import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleAlert, CircleDashed, CircleX, Clock, Loader, X } from "../../src/shared/ui/icons";
import type { CompanionClient } from "./client";
import type { CompanionMono, CompanionMonoLinkedSession, CompanionMonoLinkedSessionPage } from "./types";

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
    ? "Update MonoCode on your Mac to browse linked sessions."
    : message;
}

/** A paged, read-only list of sessions explicitly launched from this Mono. */
export function MonoLinkedSessions({ client, mono, refreshToken, onOpen, onClose }: Props) {
  const [page, setPage] = useState<CompanionMonoLinkedSessionPage>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const serial = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (offset = 0, append = false) => {
    const request = ++serial.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(undefined);
    try {
      const result = await client.monoRead(mono.id, "sessions", offset);
      const next = result.sessions;
      if (request !== serial.current || !next || next.offset !== offset) return;
      setPage(current => append && current
        ? { ...next, offset: current.offset, items: [...current.items, ...next.items] }
        : next);
    } catch (reason) {
      if (request === serial.current) setError(errorMessage(reason));
    } finally {
      if (request === serial.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [client, mono.id]);

  useEffect(() => {
    setPage(undefined);
    void load();
    closeButton.current?.focus({ preventScroll: true });
    return () => { serial.current += 1; };
  }, [load]);

  // The workspace already polls the Mac. Refresh the first bounded page as
  // that snapshot changes so a child settling or waiting for input is visible.
  useEffect(() => {
    if (page) void load();
  // `page` intentionally starts the refresh loop only after the first read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  return <section className="mono-linked-sessions" role="dialog" aria-modal="true" aria-labelledby="mono-linked-sessions-title" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
  }}>
    <button className="mono-linked-sessions__scrim" type="button" tabIndex={-1} aria-label="Close sessions" onClick={onClose} />
    <div className="mono-linked-sessions__surface">
      <header>
        <div><h3 id="mono-linked-sessions-title">Sessions</h3><p>{mono.name}’s linked sessions</p></div>
        <button ref={closeButton} className="mono-linked-sessions__close" type="button" aria-label="Close sessions" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>
      <div className="mono-linked-sessions__body" aria-busy={loading}>
        {loading && !page ? <p role="status">Loading linked sessions…</p> : null}
        {error ? <p className="error-copy" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p> : null}
        {page && !page.items.length ? <p className="mono-linked-sessions__empty">No linked sessions are available on this Mac.</p> : null}
        {page?.items.length ? <ul aria-label={`${mono.name} linked sessions`}>{page.items.map(session => <li key={session.id}>
          <button type="button" onClick={() => onOpen(session)} aria-label={`Open ${session.title} · ${session.statusLabel}`}>
            <span className="mono-linked-sessions__state" data-state={session.state}><SessionIcon state={session.state} /></span>
            <span><strong>{session.title}</strong><small>{session.statusLabel}</small></span>
          </button>
        </li>)}</ul> : null}
        {page?.nextOffset !== undefined ? <button className="mono-linked-sessions__more" type="button" disabled={loadingMore} onClick={() => void load(page.nextOffset, true)}>{loadingMore ? "Loading…" : `Show more · ${page.total - page.items.length} sessions`}</button> : null}
      </div>
    </div>
  </section>;
}
