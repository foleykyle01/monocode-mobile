import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Streamdown, type Components } from "streamdown";
import {
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ExternalLink,
  GitPullRequest,
  RefreshCw,
} from "../../src/shared/ui/icons";
import { InboxProviderMark } from "../../src/features/inbox/ui/InboxProviderMark";
import type { CompanionClient } from "./client";
import type {
  CompanionInboxComment,
  CompanionInboxItem,
  CompanionInboxRead,
  CompanionProject,
} from "./types";
import "./inbox.css";
import { useEdgeSwipeBack } from "./useEdgeSwipeBack";

const PROVIDER_LABEL: Record<CompanionInboxItem["provider"], string> = {
  github: "GitHub",
  linear: "Linear",
  jira: "Jira",
  gitlab: "GitLab",
  azuredevops: "ADO",
};

const markdownComponents: Components = {
  img: ({ alt }) => <span className="remote-file-note">{alt || "Image"} · view on Mac</span>,
  a: ({ href, children }) => href && /^https?:\/\//i.test(href)
    ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
    : <span className="remote-file-note" title="Open this file on your Mac">{children}</span>,
};

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function matches(item: CompanionInboxItem, query: string) {
  const text = query.trim().toLowerCase();
  return !text || [
    item.title, item.reference, item.provider, item.kind, item.state,
    item.teamName, item.projectName, ...(item.labels ?? []).map(({ name }) => name),
  ].filter(Boolean).join(" ").toLowerCase().includes(text);
}

function Back({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="inbox-back" type="button" aria-label={label} onClick={onClick}>
      <ChevronLeft className="inbox-action-icon" strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

function WorkItemIcon({ item }: { item: CompanionInboxItem }) {
  const Icon = item.kind === "pr" ? GitPullRequest : CircleDot;
  return <Icon className="inbox-row__icon" strokeWidth={1.7} aria-hidden="true" />;
}

function dateLabel(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Comment({ comment, reply = false }: { comment: CompanionInboxComment; reply?: boolean }) {
  return (
    <article className={`inbox-comment ${reply ? "inbox-comment--reply" : ""}`}>
      <p className="inbox-comment__meta">{comment.author}{dateLabel(comment.createdAt) ? ` · ${dateLabel(comment.createdAt)}` : ""}</p>
      {comment.body ? <Streamdown className="companion-markdown" mode="static" controls={false} components={markdownComponents}>{comment.body}</Streamdown> : <p className="inbox-state">No comment text.</p>}
      {comment.replies.map((entry) => <Comment key={entry.id} comment={entry} reply />)}
    </article>
  );
}

type Props = {
  client: CompanionClient;
  projects: CompanionProject[];
  onBack: () => void;
};

/** Read-only, desktop-derived Inbox summaries and descriptions. */
export function InboxView({ client, projects, onBack }: Props) {
  const [items, setItems] = useState<CompanionInboxItem[]>([]);
  const [providerErrors, setProviderErrors] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string>();
  const [selected, setSelected] = useState<CompanionInboxItem>();
  const [description, setDescription] = useState("");
  const [nextOffset, setNextOffset] = useState<number>();
  const [extras, setExtras] = useState<Pick<CompanionInboxRead, "thread" | "changes" | "summaryWarnings">>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const detailEpoch = useRef<string | undefined>(undefined);

  const load = () => {
    const request = ++listRequest.current;
    setListError(undefined);
    if (items.length) setRefreshing(true);
    else setLoading(true);
    void client.inboxList().then((result) => {
      if (request !== listRequest.current) return;
      setItems(result.items);
      setProviderErrors(result.errors);
      setTruncated(result.truncated);
    }).catch((error: unknown) => {
      if (request === listRequest.current) setListError(message(error));
    }).finally(() => {
      if (request !== listRequest.current) return;
      setLoading(false);
      setRefreshing(false);
    });
  };

  useEffect(() => {
    load();
    return () => {
      listRequest.current += 1;
      detailRequest.current += 1;
    };
    // A new client represents a new connection and needs its own snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  function readDescription(item: CompanionInboxItem, offset = 0) {
    const request = ++detailRequest.current;
    setDetailError(undefined);
    setDetailLoading(true);
    void client.inboxRead(item.key, offset).then((result) => {
      if (request !== detailRequest.current) return;
      if (offset > 0 && detailEpoch.current && detailEpoch.current !== result.epoch) {
        setDetailError("Your Mac reconnected. Refresh this summary before loading more.");
        setNextOffset(undefined);
        return;
      }
      if (offset === 0) detailEpoch.current = result.epoch;
      setDescription((previous) => offset === 0 ? result.body : previous + result.body);
      setNextOffset(result.truncated ? result.nextOffset : undefined);
      if (offset === 0) {
        setExtras({
          thread: result.thread,
          changes: result.changes,
          summaryWarnings: result.summaryWarnings,
        });
      }
    }).catch((error: unknown) => {
      if (request === detailRequest.current) setDetailError(message(error));
    }).finally(() => {
      if (request === detailRequest.current) setDetailLoading(false);
    });
  }

  useEffect(() => {
    if (!selected) return;
    setDescription("");
    setNextOffset(undefined);
    setExtras(undefined);
    detailEpoch.current = undefined;
    readDescription(selected);
    // Selected identity is the navigation boundary; avoid a retrigger on refresh-only rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key, client]);

  const visible = useMemo(() => items.filter((item) => matches(item, query)), [items, query]);
  const selectedProject = selected?.projectId ? projects.find((project) => project.id === selected.projectId) : undefined;
  function closeDetail() {
    detailRequest.current += 1;
    setSelected(undefined);
    setDescription("");
    setExtras(undefined);
    setDetailError(undefined);
    detailEpoch.current = undefined;
  }
  const swipeSurface = useEdgeSwipeBack(selected ? closeDetail : onBack, true, selected?.key);

  if (selected) {
    const source = selected.teamName || selected.projectName;
    const meta = [PROVIDER_LABEL[selected.provider], selected.kind === "pr" ? "Pull request" : selected.kind, selected.state, selected.stateReason || "", selected.draft ? "Draft" : "", selected.attentionReason || ""].filter(Boolean);
    return (
      <section ref={swipeSurface} className="inbox-view inbox-view--detail" aria-label="Inbox item">
        <header className="inbox-header">
          <Back label="Back to Inbox" onClick={closeDetail} />
          <h2 title={selected.reference}>{selected.reference}</h2>
        </header>
        <div className="inbox-detail inbox-detail--enter">
          <div className="inbox-detail__summary">
            <div className="inbox-detail__eyebrow"><InboxProviderMark provider={selected.provider} className="inbox-provider-mark" /> <WorkItemIcon item={selected} /> <span>{meta.join(" · ")}</span></div>
            <h1>{selected.title}</h1>
            <div className="inbox-detail__context">
              {source ? <span>{source}</span> : null}
              {selectedProject ? <span>Mac project · {selectedProject.name}</span> : <span>Global Inbox item</span>}
              {dateLabel(selected.updatedAt) ? <span>Updated {dateLabel(selected.updatedAt)}</span> : null}
            </div>
            {selected.labels?.length ? <div className="inbox-labels" aria-label="Labels">{selected.labels.map((label) => <span key={label.name} style={{ "--inbox-label": `#${label.color.replace(/^#/, "")}` } as CSSProperties}>{label.name}</span>)}</div> : null}
            {selected.assignees?.length ? <p className="inbox-detail__assignees">Assigned to {selected.assignees.map(({ login }) => login).join(", ")}</p> : null}
          </div>
          <div className="inbox-summary">
            <div className="inbox-summary__heading">
              <h3>Summary</h3>
              {selected.url ? <a href={selected.url} target="_blank" rel="noreferrer noopener">Open on {PROVIDER_LABEL[selected.provider]} <ExternalLink aria-hidden="true" /></a> : null}
            </div>
            {detailLoading && !description ? <p className="inbox-state" role="status">Loading summary…</p> : null}
            {detailError ? <div className="inbox-state inbox-state--error" role="alert"><p>{detailError}</p><button className="button button--quiet button--small" type="button" onClick={() => readDescription(selected)}>Try again</button></div> : null}
            {description ? <div className="inbox-body"><Streamdown className="companion-markdown" mode="static" controls={false} components={markdownComponents}>{description}</Streamdown></div> : !detailLoading && !detailError ? <p className="inbox-state">No description was provided for this item.</p> : null}
            {nextOffset !== undefined ? <button className="inbox-load-more" type="button" disabled={detailLoading} onClick={() => readDescription(selected, nextOffset)}>{detailLoading ? "Loading description…" : "Load more description"}</button> : null}
            {extras?.changes ? <section className="inbox-summary-section" aria-label="Changed files"><div className="inbox-summary__heading"><h3>Changed files</h3><span className="inbox-change-count">+{extras.changes.additions} · -{extras.changes.deletions}</span></div>{extras.changes.files.length > 6 ? <details><summary>Show all {extras.changes.files.length} changed files</summary><ul className="inbox-change-files">{extras.changes.files.map((file) => <li key={file.path}><code>{file.path}</code><span>+{file.additions} · -{file.deletions}</span></li>)}</ul></details> : <ul className="inbox-change-files">{extras.changes.files.map((file) => <li key={file.path}><code>{file.path}</code><span>+{file.additions} · -{file.deletions}</span></li>)}</ul>}{extras.changes.truncated ? <p className="inbox-summary-note">More changed files are available on your Mac.</p> : null}</section> : null}
            {extras?.thread ? <section className="inbox-summary-section" aria-label="Discussion"><div className="inbox-summary__heading"><h3>Discussion</h3>{extras.thread.reviewDecision ? <span className="inbox-change-count">{extras.thread.reviewDecision}</span> : null}</div>{extras.thread.baseRefName && extras.thread.headRefName ? <p className="inbox-summary-note">{extras.thread.baseRefName} → {extras.thread.headRefName}</p> : null}{extras.thread.comments.length ? <div className="inbox-comments">{extras.thread.comments.map((comment) => <Comment key={comment.id} comment={comment} />)}</div> : <p className="inbox-state">No discussion yet.</p>}{extras.thread.truncated ? <p className="inbox-summary-note">Some discussion is not shown here. Review the full thread on your Mac.</p> : null}</section> : null}
            {extras?.summaryWarnings?.map((warning) => <p className="inbox-summary-note" key={warning}>{warning}</p>)}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section ref={swipeSurface} className="inbox-view inbox-view--list" aria-label="Inbox">
      <header className="inbox-header">
        <Back label="Back to workspace" onClick={onBack} />
        <h2>Inbox</h2>
        <button className="inbox-refresh" type="button" onClick={load} disabled={loading || refreshing} aria-label="Refresh Inbox"><RefreshCw className="inbox-action-icon" strokeWidth={1.8} aria-hidden="true" /></button>
      </header>
      <div className="inbox-list inbox-list--enter">
        <label className="inbox-search"><span className="sr-only">Search Inbox</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Inbox" type="search" /></label>
        {listError ? <p className={`inbox-state ${items.length ? "inbox-state--stale" : "inbox-state--error"}`} role="alert">{items.length ? "Showing the last available Inbox while your Mac reconnects." : listError}</p> : null}
        {providerErrors.length ? <div className="inbox-provider-errors" role="status">{providerErrors.map((error, index) => <p key={`${error}:${index}`}>{error}</p>)}</div> : null}
        {loading ? <p className="inbox-state" role="status">Loading Inbox…</p> : null}
        {!loading && !visible.length && !listError ? <p className="inbox-state">No Inbox items match this search.</p> : null}
        <div className="inbox-rows">
          {visible.map((item) => (
            <button className="inbox-row" type="button" key={item.key} onClick={() => setSelected(item)}>
              <InboxProviderMark provider={item.provider} className="inbox-provider-mark" />
              <WorkItemIcon item={item} />
              <span className="inbox-row__body"><strong>{item.title}</strong><small>{item.reference} · {item.state}{item.projectId ? ` · ${projects.find((project) => project.id === item.projectId)?.name || "Project"}` : ""}</small></span>
              <ChevronRight className="inbox-row__chevron" strokeWidth={1.8} aria-hidden="true" />
            </button>
          ))}
        </div>
        {truncated ? <p className="inbox-state">Showing the first available Inbox items. Refine filters on your Mac for more.</p> : null}
      </div>
    </section>
  );
}
