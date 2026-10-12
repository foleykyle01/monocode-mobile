import { useLayoutEffect, useRef, useState } from "react";
import { Streamdown, type Components } from "streamdown";
import type { CompanionBlock } from "./types";
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
  return text.trim().split("\n")[0] || "Action";
}

export function Transcript({ blocks, loading, onApprove, approvalBusy, mutationsDisabled, mono = false, layout = "chat", onLoadEarlier, loadingEarlier = false, historyError, busy = false, needsApproval = false }: {
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
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const snapshot = useRef<ScrollSnapshot | undefined>(undefined);
  const [below, setBelow] = useState(false);
  const approval = blocks.find(block => block.approval && !block.approval.decided);
  const showWorking = busy && !needsApproval;

  function measure() {
    const element = viewport.current;
    if (!element) return;
    const hasMore = element.scrollHeight - element.scrollTop - element.clientHeight > 64;
    following.current = !hasMore;
    snapshot.current = { ids: blocks.map(block => block.id), height: element.scrollHeight, top: element.scrollTop };
    setBelow(hasMore);
  }

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => {
      const previous = snapshot.current;
      if (previous && prependedBlocks(previous, blocks)) {
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
  }, [blocks, loadingEarlier, showWorking]);

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

  return <div className="transcript-region">
    <div ref={viewport} className={`transcript transcript--${layout} ${mono ? "transcript--mono" : ""}`} onScroll={measure} aria-label="Conversation" tabIndex={0}>
      <div ref={content}>
        {onLoadEarlier ? <div className="history-control">
          <button type="button" className="history-control__button" onClick={loadEarlier} disabled={loadingEarlier}>
            {loadingEarlier ? "Loading earlier messages…" : "Load earlier messages"}
          </button>
          {historyError ? <p className="history-control__error" role="alert">{historyError}</p> : null}
        </div> : null}
        {loading && blocks.length === 0 ? <p className="empty-transcript" role="status">Loading conversation…</p> : null}
        {!loading && !busy && blocks.length === 0 ? <div className="empty-transcript"><span className="empty-line" aria-hidden="true" /><p>No messages yet. Send a message to begin.</p></div> : null}
        {blocks.map(block => {
          const tool = block.role === "tool" || block.role === "approval";
          const pending = !!block.approval && !block.approval.decided;
          const shortened = block.truncated ? <span className="truncated-note">Preview shortened · review the full message on your Mac</span> : null;
          const body = block.role === "assistant"
            ? <><Streamdown className="companion-markdown" mode="static" controls={false} components={markdownComponents}>{block.text || ""}</Streamdown>{shortened}</>
            : <p>{block.text || "(empty)"}{shortened}</p>;
          return <article className={`message message--${block.role} ${pending ? "message--pending" : ""}`} key={block.id} data-pending-approval={pending || undefined}>
            {tool && !pending ? <details className="action-details"><summary><span className="action-details__summary">{actionSummary(block.text)}</span><small>{actionStatus(block)}</small></summary>{body}</details> : <>
              {pending ? <div className="message__meta"><span className="approval-label">Needs approval</span></div> : null}
              {body}
              {pending ? <div className="approval-card"><p>{block.truncated ? "Review on your Mac before allowing." : "Allow this action on your Mac?"}</p><div className="approval-actions">
                <button className="button button--primary" type="button" onClick={() => onApprove(block, "allow")} disabled={mutationsDisabled || approvalBusy || block.truncated}>Allow</button>
                <button className="button button--quiet" type="button" onClick={() => onApprove(block, "deny")} disabled={mutationsDisabled || approvalBusy}>Deny</button>
              </div></div> : null}
            </>}
          </article>;
        })}
        {showWorking ? <p className="transcript-working" role="status" data-transcript-working>
          <span className="transcript-working__shimmer">Working…</span>
        </p> : null}
      </div>
    </div>
    {below ? <button className={`jump-latest ${approval ? "jump-latest--approval" : ""}`} type="button" onClick={jump}>{approval ? "Review pending action" : "Latest messages"}<span aria-hidden="true">↓</span></button> : null}
  </div>;
}
