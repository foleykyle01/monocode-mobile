import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff, ChevronRight } from "../../src/shared/ui/icons";
import { FileTypeIcon } from "../../src/features/files/ui/FileTypeIcon";
import { buildUnifiedFile } from "../../src/features/source-control/model/unifiedDiff";
import type { CompanionClient } from "./client";
import type { CompanionReview, CompanionReviewDiff } from "../../src/features/companion/model/companionReview";
import "./changes.css";

export function SessionChanges({ client, sessionId, epoch, turn, busy, offline }: {
  client: CompanionClient; sessionId: string; epoch: string; turn: number; busy: boolean; offline: boolean;
}) {
  const [data, setData] = useState<CompanionReview>();
  const [file, setFile] = useState<CompanionReviewDiff>();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const serial = useRef(0);
  useEffect(() => {
    setData(undefined); setFile(undefined); setExpanded(false);
  }, [sessionId, epoch, turn, busy]);
  const load = useCallback(async () => {
    const request = ++serial.current;
    setError(undefined); setLoading(false);
    if (busy || offline) return;
    setLoading(true);
    try {
      const result = await client.reviewList(sessionId);
      if (request !== serial.current) return;
      if (result.epoch !== epoch || result.turn !== turn) throw new Error("Session changed. Refresh to review its changes.");
      setData(result);
    } catch (reason) {
      if (request === serial.current) setError(reason instanceof Error ? reason.message : "Could not load session changes");
    } finally { if (request === serial.current) setLoading(false); }
  }, [client, sessionId, epoch, turn, busy, offline]);
  useEffect(() => { void load(); return () => { serial.current++; }; }, [load]);

  async function openFile(relative: string) {
    const request = ++serial.current;
    setFile(undefined); setError(undefined); setLoading(true);
    try {
      const result = await client.reviewRead(sessionId, relative);
      if (request !== serial.current) return;
      if (result.epoch !== epoch || result.turn !== turn) throw new Error("Session changed. Refresh to review its changes.");
      setFile(result);
    } catch (reason) {
      if (request === serial.current) setError(reason instanceof Error ? reason.message : "Could not read this diff");
    } finally { if (request === serial.current) setLoading(false); }
  }
  const diff = useMemo(() => file && !file.unavailable ? buildUnifiedFile(file.original, file.current) : undefined, [file]);
  function review() {
    setExpanded(!expanded);
    setFile(undefined);
    const first = data?.files.find(entry => entry.exact);
    if (!expanded && first) void openFile(first.relative);
  }
  if (busy || (!data?.total && !error)) return null;
  return <section className="session-changes" aria-label="Session changes">
    <header><FileDiff size={22} aria-hidden="true" /><div><strong>Changed {data?.total ?? ""} {data?.total === 1 ? "file" : "files"}</strong>{data ? <span className="session-changes__counts"><span>+{data.additions}</span> <span>−{data.deletions}</span></span> : null}</div><button type="button" disabled={offline || loading} onClick={review} aria-expanded={expanded}>{expanded ? "Close" : "Review"}</button></header>
    {error ? <div className="session-changes__notice"><p role="alert">{error}</p><button type="button" disabled={offline || loading} onClick={() => void load()}>Refresh</button></div> : null}
    {data ? (expanded ? data.files : data.files.slice(0, 3)).map(entry => <div key={entry.relative}>
      <button className="session-changes__file" type="button" disabled={offline || loading || !entry.exact} onClick={() => void openFile(entry.relative)} aria-expanded={file?.relative === entry.relative}>
        <FileTypeIcon name={entry.relative} isDir={false} size={16} /><span>{entry.relative}</span><small>{entry.exact ? `+${entry.additions} −${entry.deletions}` : "Diff unavailable"}</small>
      </button>
      {file?.relative === entry.relative ? file.unavailable ? <p className="session-changes__notice">Review this file on your Mac.</p> : <div className="changes-diff" aria-label={`Diff for ${entry.relative}`}>
        {diff?.blocks.map((block, index) => block.kind === "fold" ? <details key={index}><summary>{block.lines.length} unchanged lines</summary><pre>{block.lines.map(line => line.text).join("\n")}</pre></details> : <pre key={index}>{block.lines.map((line, i) => <span key={i} className={`diff-line diff-line--${line.kind}`}><span className="diff-number" aria-hidden="true">{line.oldNumber ?? ""}</span><span className="diff-number" aria-hidden="true">{line.newNumber ?? ""}</span><code>{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}{line.text || " "}</code></span>)}</pre>)}
      </div> : null}
    </div>) : null}
    {!expanded && data && data.files.length > 3 ? <button className="session-changes__more" type="button" onClick={() => setExpanded(true)}><ChevronRight size={14} />Show {data.files.length - 3} more files</button> : null}
    {data?.truncated ? <p className="session-changes__notice">Showing the first {data.files.length} files. Review the full list on your Mac.</p> : null}
    {loading && expanded && !file ? <p className="session-changes__notice" role="status">Loading diff…</p> : null}
  </section>;
}
