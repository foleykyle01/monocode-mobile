import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Streamdown, type Components } from "streamdown";
import type { CompanionBlock, CompanionSession, SessionRead } from "./types";
import type { UserQuestionReply } from "../../src/features/sessions/model/userQuestion";
import { QuestionCard } from "./QuestionCard";
import { LAUNCHED_SESSION_LABELS } from "../../src/features/monos/model/monoSpawnedSessions";
import { Check, ChevronRight, Terminal, File, Search, Wrench, Clock, CircleDashed, CircleAlert, CircleX, Loader } from "../../src/shared/ui/icons";
import "./transcript.css";

// The desktop uses Streamdown too. File/media actions stay on the Mac until
// the companion has an explicit remote file capability.
const markdownComponents: Components = {
  strong: ({ children }) => <strong>{children}</strong>,
  img: ({ alt }) => <span className="remote-file-note">{alt || "Image"} · view on Mac</span>,
  a: ({ href, children }) => href && /^https?:\/\//i.test(href)
    ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
    : <span className="remote-file-note" title="Open this file on your Mac">{children}</span>,
};

type ScrollSnapshot = { ids: string[]; height: number; top: number };

function prependedBlocks(previous: ScrollSnapshot | undefined, blocks: CompanionBlock[]) {
  if (!previous || blocks.length <= previous.ids.length) return false;
  const offset = blocks.length - previous.ids.length;
  return previous.ids.every((id, index) => blocks[index + offset]?.id === id);
}

function actionStatus(block: CompanionBlock) {
  if (block.approval?.decided === "allow") return "Allowed";
  if (block.approval?.decided === "deny") return "Denied";
  if (block.approval?.decided === "cancelled") return "Cancelled";
  return "Details";
}

function actionSummary(text: string) {
  return text.trim().split("\n")[0].slice(0, 300) || "Action";
}

export function Transcript({ blocks, loading, onApprove, approvalBusy, mutationsDisabled, mono = false, layout = "chat", onLoadEarlier, loadingEarlier = false, historyError, busy = false, needsApproval = false, pendingQuestion, questionUnavailable, questionKey, onAnswer, onQuestionInteraction, changes, onOpenSession, initialScrollTop, onPositionChange, attentionToken, queuedMessages }: {
  blocks: CompanionBlock[];
  loading: boolean;
  onApprove: (block: CompanionBlock, decision: "allow" | "deny") => void;
  approvalBusy: boolean;
  mutationsDisabled: boolean;
  mono?: boolean;
  layout?: "chat" | "full";
  onLoadEarlier?: () => void;
  loadingEarlier?: boolean;
  historyError?: string;
  /** Mirrors the desktop live-turn state; approval remains on its card. */
  busy?: boolean;
  needsApproval?: boolean;
  pendingQuestion?: SessionRead["pendingQuestion"];
  questionUnavailable?: boolean;
  questionKey?: string;
  onAnswer?: (requestId: number, reply: UserQuestionReply) => void;
  onQuestionInteraction?: (requestId: number) => Promise<unknown>;
  changes?: ReactNode;
  onOpenSession?: (session: CompanionSession, scrollTop: number) => void;
  initialScrollTop?: number;
  onPositionChange?: (top: number) => void;
  attentionToken?: number;
  queuedMessages?: SessionRead["queuedMessages"];
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const restoreTop = useRef(initialScrollTop);
  const snapshot = useRef<ScrollSnapshot | undefined>(undefined);
  const reviewedAttention = useRef<number | undefined>(undefined);
  const [below, setBelow] = useState(false);
  const approval = blocks.find(block => block.approval && !block.approval.decided);
  const showWorking = busy && !needsApproval && !pendingQuestion && !questionUnavailable;

  function measure() {
    const element = viewport.current;
    if (!element) return;
    const hasMore = element.scrollHeight - element.scrollTop - element.clientHeight > 64;
    following.current = !hasMore;
    snapshot.current = { ids: blocks.map(block => block.id), height: element.scrollHeight, top: element.scrollTop };
    if (!loading) onPositionChange?.(element.scrollTop);
    setBelow(hasMore);
  }

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => {
      const previous = snapshot.current;
      if (restoreTop.current !== undefined && !loading) {
        element.scrollTop = restoreTop.current;
        restoreTop.current = undefined;
        following.current = false;
      } else if (previous && prependedBlocks(previous, blocks)) {
        element.scrollTop = previous.top + element.scrollHeight - previous.height;
        following.current = false;
      } else if (following.current) {
        element.scrollTop = element.scrollHeight;
      }
      measure();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [blocks, loading, loadingEarlier, showWorking]);

  useLayoutEffect(() => {
    if (attentionToken === undefined || reviewedAttention.current === attentionToken || loading) return;
    const target = viewport.current?.querySelector<HTMLElement>("[data-pending-approval], [data-pending-question]");
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "instant" });
      target.focus({ preventScroll: true });
      reviewedAttention.current = attentionToken;
      measure();
    } else if (needsApproval && onLoadEarlier && !loadingEarlier && !historyError) {
      onLoadEarlier();
    }
  }, [attentionToken, blocks, loading, pendingQuestion, needsApproval, loadingEarlier, historyError]);

  function jump() {
    const element = viewport.current;
    if (!element) return;
    const target = approval ? element.querySelector<HTMLElement>("[data-pending-approval]") : null;
    if (target) target.scrollIntoView({ block: "center", behavior: "instant" });
    else element.scrollTop = element.scrollHeight;
    measure();
  }

  function loadEarlier() {
    if (!onLoadEarlier || loadingEarlier) return;
    const element = viewport.current;
    if (element) {
      snapshot.current = { ids: blocks.map(block => block.id), height: element.scrollHeight, top: element.scrollTop };
    }
    following.current = false;
    onLoadEarlier();
  }

  function sessionCards(block: CompanionBlock) {
    if (!onOpenSession || !block.spawnedSessions?.length) return null;
    return <div className="spawned-sessions" aria-label="Project sessions started by this Mono">
      {block.spawnedSessions.map(session => {
        const state = session.needsApproval || session.needsQuestion ? "input" : session.busy ? "working" : session.lifecycle ?? "unknown";
        const label = LAUNCHED_SESSION_LABELS[state] ?? LAUNCHED_SESSION_LABELS.unknown;
        const Icon = { working: Loader, input: Clock, draft: CircleDashed, failed: CircleAlert, stopped: CircleX, done: Check, unknown: CircleDashed }[state] ?? CircleDashed;
        const project = session.cwd.split(/[\\/]/).filter(Boolean).pop() || session.cwd;
        return <button className="spawned-session" type="button" key={session.id} onClick={() => onOpenSession(session, viewport.current?.scrollTop ?? 0)}>
          <span key={state} className="spawned-session__status" data-state={state} aria-hidden="true"><Icon size={16} /></span>
          <span className="spawned-session__body"><strong>{session.title}</strong><small>{project} · {label}</small></span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>;
      })}
    </div>;
  }

  return <div className="transcript-region">
    <div ref={viewport} className={`transcript transcript--${layout} ${mono ? "transcript--mono" : ""}`} onScroll={measure} aria-label="Conversation" tabIndex={0}>
      <div ref={content}>
        {onLoadEarlier ? <div className="history-control">
          <button type="button" className="history-control__button" onClick={loadEarlier} disabled={loadingEarlier || mutationsDisabled}>
            {loadingEarlier ? "Loading earlier messages…" : "Load earlier messages"}
          </button>
          {historyError ? <p className="history-control__error" role="alert">{historyError}</p> : null}
        </div> : null}
        {loading && blocks.length === 0 ? <p className="empty-transcript" role="status">Loading conversation…</p> : null}
        {!loading && !busy && blocks.length === 0 ? <div className="empty-transcript"><span className="empty-line" aria-hidden="true" /><p>No messages yet. Send a message to begin.</p></div> : null}
        {transcriptRows(blocks).map(row => {
          if (Array.isArray(row)) return <Fragment key={row[0].id}><ActivityTree blocks={row} />{row.map(block => <Fragment key={block.id}>{sessionCards(block)}</Fragment>)}</Fragment>;
          const block = row;
          const tool = block.role === "tool" || block.role === "approval";
          const pending = !!block.approval && !block.approval.decided;
          const shortened = block.truncated ? <span className="truncated-note">Preview shortened · review the full message on your Mac</span> : null;
          const body = block.role === "assistant"
            ? <><Streamdown className="companion-markdown" mode="static" controls={false} components={markdownComponents}>{block.text || ""}</Streamdown>{shortened}</>
            : <p>{block.text || "(empty)"}{shortened}</p>;
          return <Fragment key={block.id}><article tabIndex={pending ? -1 : undefined} className={`message message--${block.role} ${pending ? "message--pending" : ""}`} data-pending-approval={pending || undefined}>
            {tool && !pending ? <details className="action-details"><summary><span className="action-details__summary">{actionSummary(block.text)}</span><small>{actionStatus(block)}</small></summary>{body}</details> : <>
              {pending ? <div className="message__meta"><span className="approval-label">Needs approval</span></div> : null}
              {body}
              {pending ? <div className="approval-card"><p>{block.truncated ? "Review on your Mac before allowing." : "Allow this action on your Mac?"}</p><div className="approval-actions">
                <button className="button button--primary" type="button" onClick={() => onApprove(block, "allow")} disabled={mutationsDisabled || approvalBusy || block.truncated}>Allow</button>
                <button className="button button--quiet" type="button" onClick={() => onApprove(block, "deny")} disabled={mutationsDisabled || approvalBusy}>Deny</button>
              </div></div> : null}
            </>}
          </article>{sessionCards(block)}</Fragment>;
        })}
        {pendingQuestion && onAnswer && onQuestionInteraction ? <div data-pending-question tabIndex={-1}><QuestionCard key={`${questionKey}:${pendingQuestion.requestId}`} prompt={pendingQuestion} disabled={mutationsDisabled || approvalBusy} onAnswer={onAnswer} onInteraction={onQuestionInteraction} /></div> : null}
        {queuedMessages?.length ? <section className="queued-follow-ups" aria-label="Queued follow-ups">{queuedMessages.map(message => <div key={message.id}><small>{message.state === "failed" ? "Delivery failed · review on Mac" : message.state === "paused" ? "Queue paused · review on Mac" : "Queued on Mac"}</small><p>{message.text}</p></div>)}</section> : null}
        {questionUnavailable ? <p data-pending-question tabIndex={-1} className="truncated-note" role="status">The agent has a question. Open this session on your Mac to answer it.</p> : null}
        {changes}
        {showWorking ? <p className="transcript-working" role="status" data-transcript-working>
          <span className="transcript-working__shimmer">Working…</span>
        </p> : null}
      </div>
    </div>
    {below ? <button className={`jump-latest ${approval ? "jump-latest--approval" : ""}`} type="button" onClick={jump}>{approval ? "Review pending action" : "Latest messages"}<span aria-hidden="true">↓</span></button> : null}
  </div>;
}

function transcriptRows(blocks: CompanionBlock[]): (CompanionBlock | CompanionBlock[])[] {
  const rows: (CompanionBlock | CompanionBlock[])[] = [];
  for (const block of blocks) {
    const activity = (block.role === "tool" || block.role === "approval" || block.role === "reasoning") && !(block.approval && !block.approval.decided);
    const last = rows[rows.length - 1];
    if (activity && Array.isArray(last)) last.push(block);
    else rows.push(activity ? [block] : block);
  }
  return rows;
}

function ActivityTree({ blocks }: { blocks: CompanionBlock[] }) {
  const working = blocks.some(block => block.activity?.state === "pending");
  // Completion must not collapse activity the reader is inspecting.
  const [open, setExpanded] = useState(working);
  return <section className="activity-tree" aria-label="Agent activity">
    <button type="button" className="activity-tree__heading" aria-expanded={open} onClick={() => setExpanded(!open)}>
      <span className={open ? "activity-tree__chevron--open" : ""}><ChevronRight size={14} /></span>
      <span className={working ? "transcript-working__shimmer" : ""}>{working ? "Working" : "Worked"}</span>
      <span>{blocks.length} {blocks.length === 1 ? "step" : "steps"}</span>
    </button>
    {open ? <ol>{blocks.map(block => {
      const kind = block.activity?.kind?.toLowerCase() ?? "";
      const Icon = /search|list|glob|grep/.test(kind) ? Search : /read|write|edit/.test(kind) ? File : /shell|exec|bash/.test(kind) ? Terminal : Wrench;
      return <li key={block.id} data-state={block.activity?.state}>
        <Icon size={14} aria-hidden="true" />
        <details className="action-details"><summary><span className="action-details__summary">{block.role === "reasoning" ? "Thinking" : block.activity?.name || block.activity?.label || actionSummary(block.text)}</span>{block.activity?.state === "accepted" ? <Check size={12} aria-label="Completed" /> : <small>{block.approval?.decided ? actionStatus(block) : block.activity?.state === "rejected" ? "Failed" : block.activity?.state === "pending" ? "Running" : "Details"}</small>}</summary><p>{block.text}{block.truncated ? <span className="truncated-note">Preview shortened · review on your Mac</span> : null}</p>
          {block.activity?.steps?.length ? <ol aria-label="Subagent activity">{block.activity.steps.map(step => <li key={step.id} data-state={step.state}><span>{step.label}</span></li>)}</ol> : null}
          {block.activity?.stepsTruncated ? <span className="truncated-note">Latest 20 steps · full history on your Mac</span> : null}
        </details>
      </li>;
    })}</ol> : null}
  </section>;
}
