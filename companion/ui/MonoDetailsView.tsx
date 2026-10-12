import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Bot, File, RefreshCw, SlidersHorizontal } from "../../src/shared/ui/icons";
import { habitScheduleLabel } from "../../src/features/monos/model/monoHabits";
import { MonoMascot, ProjectIcon } from "./Navigation";
import type { CompanionClient } from "./client";
import type {
  CompanionMono,
  CompanionMonoHabitPage,
  CompanionMonoRead,
  CompanionMonoTextPage,
  CompanionProject,
} from "./types";
import "./mono-details.css";

type Props = { client: CompanionClient; mono: CompanionMono; projects: CompanionProject[]; onBack: () => void };
type MonoRead = CompanionMonoRead & { epoch: string };

function appendTextPage(current: CompanionMonoTextPage | undefined, next: CompanionMonoTextPage) {
  if (!current || next.offset === 0) return next;
  return { ...next, offset: current.offset, text: [current.text, next.text].filter(Boolean).join("\n") };
}

function appendHabitPage(current: CompanionMonoHabitPage | undefined, next: CompanionMonoHabitPage) {
  if (!current || next.offset === 0) return next;
  return { ...next, offset: current.offset, items: [...current.items, ...next.items] };
}

function timestamp(value: number | undefined) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not run yet";
}

function FactSection({ title, page, empty, onMore, loading }: { title: string; page?: CompanionMonoTextPage; empty: string; onMore: () => void; loading: boolean }) {
  return <details className="mono-details-section">
    <summary><File size={16} aria-hidden="true" /><span>{title}</span><span className="mono-details-section__hint">Read-only</span></summary>
    {page?.text ? <pre>{page.text}</pre> : <p>{page ? empty : "Loading from your Mac…"}</p>}
    {page?.contentTruncated ? <p className="mono-details-truncated">Some content was shortened by your Mac before it was sent here.</p> : null}
    {page?.nextOffset !== undefined ? <button className="mono-details-more" type="button" disabled={loading} onClick={onMore}>{loading ? "Loading…" : `Show more · ${page.totalLines - (page.nextOffset || page.totalLines)} lines`}</button> : null}
  </details>;
}

/** Read-only projection of the desktop's Mono profile and bounded local files. */
export function MonoDetailsView({ client, mono, projects, onBack }: Props) {
  const [data, setData] = useState<MonoRead>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingSection, setLoadingSection] = useState<"soul" | "memory" | "habits">();
  const serial = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++serial.current;
    setLoading(true);
    setLoadingSection(undefined);
    setError(undefined);
    try {
      const result = await client.monoRead(mono.id);
      if (request === serial.current) setData(result);
    } catch (reason) {
      if (request === serial.current) setError(reason instanceof Error ? reason.message : "Could not load this Mono");
    } finally {
      if (request === serial.current) setLoading(false);
    }
  }, [client, mono.id]);

  useEffect(() => {
    setData(undefined);
    void refresh();
    return () => { serial.current += 1; };
  }, [refresh]);

  const loadMore = useCallback(async (section: "soul" | "memory" | "habits") => {
    const page = data?.[section];
    if (!page?.nextOffset || loading || loadingSection) return;
    const request = ++serial.current;
    setLoadingSection(section);
    setError(undefined);
    try {
      const offset = page.nextOffset;
      const next = await client.monoRead(mono.id, section, offset);
      if (request !== serial.current) return;
      const nextPage = next[section];
      if (next.epoch !== data?.epoch || !nextPage || nextPage.offset !== offset) {
        setError("This Mono changed on your Mac. Refresh before loading more details.");
        return;
      }
      setData((current) => {
        if (!current) return current;
        if (section === "habits" && next.habits) return { ...current, habits: appendHabitPage(current.habits, next.habits) };
        if (section === "soul" && next.soul) return { ...current, soul: appendTextPage(current.soul, next.soul) };
        if (section === "memory" && next.memory) return { ...current, memory: appendTextPage(current.memory, next.memory) };
        return current;
      });
    } catch (reason) {
      if (request === serial.current) setError(reason instanceof Error ? reason.message : "Could not load more details");
    } finally {
      if (request === serial.current) setLoadingSection(undefined);
    }
  }, [client, data, loading, loadingSection, mono.id]);

  const summary = data?.mono || mono;
  const scopeIds = data ? data.scope.projects.map((project) => project.id) : mono.projectIds;
  const assigned = projects.filter((project) => scopeIds.includes(project.id));
  const model = data?.model?.label || data?.model?.id;
  const access = data?.access?.label || data?.access?.id;

  return <section className="mono-details" aria-label={`${summary.name} details`}>
    <header className="detail-heading mono-details-header mono-details-heading">
      <button className="back-button" type="button" aria-label="Back to workspace" onClick={onBack}><ChevronLeft size={20} aria-hidden="true" /></button>
      <h2>{summary.name}</h2>
      <button className="mono-details-refresh" type="button" aria-label="Refresh Mono details" title="Refresh Mono details" disabled={loading} onClick={() => void refresh()}><RefreshCw size={17} aria-hidden="true" /></button>
    </header>
    <div className="mono-details__content">
      <div className="mono-details-identity"><MonoMascot mono={summary} /><div><p>Mono</p><strong>{summary.statusLabel}</strong>{summary.activity ? <small>{summary.activity}</small> : null}</div></div>

      <section className="mono-details-card" aria-labelledby="mono-scope-title">
        <div className="mono-details-card__heading"><Bot size={17} aria-hidden="true" /><div><h3 id="mono-scope-title">Project scope</h3><p>Projects this Mono can work across on your Mac.</p></div></div>
        {assigned.length ? <ul className="mono-details-projects">{assigned.map((project) => <li key={project.id}><ProjectIcon project={project} /><span><strong>{project.name}</strong><small>{project.path}</small></span></li>)}</ul> : <p className="mono-details-empty">No available projects are assigned.</p>}
      </section>

      <section className="mono-details-card" aria-labelledby="mono-runtime-title">
        <div className="mono-details-card__heading"><SlidersHorizontal size={17} aria-hidden="true" /><div><h3 id="mono-runtime-title">Session</h3><p>Current desktop configuration.</p></div></div>
        <dl className="mono-details-facts"><div><dt>Model</dt><dd>{model || "Configured on your Mac"}</dd></div><div><dt>Access</dt><dd>{access || "Configured on your Mac"}</dd></div>{data?.model?.harness ? <div><dt>Provider</dt><dd>{data.model.harness}</dd></div> : null}</dl>
        {data?.model?.settings && Object.keys(data.model.settings).length ? <dl className="mono-details-settings">{Object.entries(data.model.settings).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : null}
      </section>

      <details className="mono-details-section">
        <summary><Bot size={16} aria-hidden="true" /><span>Habits</span><span className="mono-details-section__hint">{data?.habits?.total ?? "…"}</span></summary>
        {!data?.habits ? <p>Loading from your Mac…</p> : data.habits.items.length ? <ul className="mono-details-habits">{data.habits.items.map((habit) => <li key={habit.id}><strong>{habit.name}</strong><small>{habitScheduleLabel(habit.schedule)}{habit.enabled ? "" : " · Paused"}</small><p>{habit.instructions}</p><dl className="mono-details-habit-facts"><div><dt>Next</dt><dd>{timestamp(habit.nextRunAt)}</dd></div><div><dt>Last</dt><dd>{timestamp(habit.lastRunAt)}{habit.lastOutcome ? ` · ${habit.lastOutcome}` : ""}</dd></div></dl>{habit.lastError ? <p className="mono-details-habit-error">Last error: {habit.lastError}</p> : null}{habit.runs?.length ? <details className="mono-details-runs"><summary>Recent runs</summary>{habit.runs.map((run, index) => <article key={`${run.at}:${index}`}><strong>{timestamp(run.at)} · {run.outcome}</strong><small>{Math.round(run.durationMs / 1_000)}s</small>{run.report ? <pre>{run.report}</pre> : null}{run.error ? <p className="mono-details-habit-error">{run.error}</p> : null}</article>)}</details> : null}{habit.contentTruncated ? <p className="mono-details-truncated">Some habit content was shortened by your Mac before it was sent here.</p> : null}</li>)}</ul> : <p>No habits are scheduled for this Mono.</p>}
        {data?.habits?.truncated ? <button className="mono-details-more" type="button" disabled={loadingSection !== undefined} onClick={() => void loadMore("habits")}>{loadingSection === "habits" ? "Loading…" : "Show more habits"}</button> : null}
      </details>
      <FactSection title="Soul" page={data?.soul} empty="This Mono has no standing instructions." loading={loadingSection === "soul"} onMore={() => void loadMore("soul")} />
      <FactSection title="Memory" page={data?.memory} empty="Nothing has been remembered yet." loading={loadingSection === "memory"} onMore={() => void loadMore("memory")} />
      {error ? <p className="error-copy" role="alert">{error} <button className="mono-details-retry" type="button" onClick={() => void refresh()}>Retry</button></p> : null}
      {loading ? <p className="settings-note" role="status">Loading Mono details…</p> : null}
    </div>
  </section>;
}
