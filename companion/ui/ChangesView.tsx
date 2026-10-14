import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildUnifiedFile } from "../../src/features/source-control/model/unifiedDiff";
import type { CompanionClient } from "./client";
import type { CompanionChangeRead, CompanionChangesList, CompanionProject, CompanionSession } from "./types";
import "./changes.css";
import { ChevronLeft } from "../../src/shared/ui/icons";
import { useEdgeSwipeBack } from "./useEdgeSwipeBack";

type Props = {
  client: CompanionClient;
  project: CompanionProject;
  sessions: CompanionSession[];
  sessionId?: string;
  disabled: boolean;
  onBack: () => void;
};

export function ChangesView({ client, project, sessions, sessionId, disabled, onBack }: Props) {
  const [workspace, setWorkspace] = useState(sessionId);
  const target = useMemo(
    () => ({ projectId: project.id, ...(workspace ? { sessionId: workspace } : {}) }),
    [project.id, workspace],
  );
  const [data, setData] = useState<CompanionChangesList & { epoch: string }>();
  const [file, setFile] = useState<CompanionChangeRead>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const serial = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++serial.current;
    setLoading(true);
    setError(undefined);
    try {
      const result = await client.changesList(target);
      if (request !== serial.current) return;
      setData(result);
      setFile(undefined);
    } catch (reason) {
      if (request !== serial.current) return;
      setError(reason instanceof Error ? reason.message : "Could not load changes");
    } finally {
      if (request === serial.current) setLoading(false);
    }
  }, [client, target]);

  useEffect(() => {
    setData(undefined);
    setFile(undefined);
    void refresh();
    return () => { serial.current += 1; };
  }, [refresh]);

  const openFile = useCallback(async (relative: string, kind: "staged" | "unstaged") => {
    const request = ++serial.current;
    setLoading(true);
    setError(undefined);
    try {
      const result = await client.changesRead(target, relative, kind);
      if (request !== serial.current) return;
      if (result.epoch !== data?.epoch) {
        setData(undefined);
        setFile(undefined);
        setError("Changes changed on your Mac. Refresh before reviewing again.");
        return;
      }
      setFile(result);
    } catch (reason) {
      if (request === serial.current)
        setError(reason instanceof Error ? reason.message : "Could not read this diff");
    } finally {
      if (request === serial.current) setLoading(false);
    }
  }, [client, data?.epoch, data?.revision, target]);

  const diff = useMemo(
    () => file && !file.binary && !file.tooLarge && !file.truncated
      ? buildUnifiedFile(file.original, file.current)
      : undefined,
    [file],
  );
  const currentSession = sessions.find((entry) => entry.id === workspace);
  const blocked = disabled || loading;
  const goBack = () => { if (file) setFile(undefined); else onBack(); };
  const swipeSurface = useEdgeSwipeBack(goBack, true, file ? `${file.kind}:${file.relative}` : undefined);

  return <section ref={swipeSurface} className="changes-page" aria-label="Project changes">
    <header className="detail-heading changes-heading">
      <button className="back-button" type="button" aria-label={file ? "Back to changes" : "Back to workspace"} onClick={goBack}>
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <h2 title={file?.relative}>{file ? file.relative.split("/").pop() : "Changes"}</h2>
    </header>
    <div className="changes-view">
      <div className="changes-toolbar">
        <div><strong>{project.name}</strong><span>{data?.branch || "No branch"}{data ? ` · +${data.additions} −${data.deletions}` : ""}</span></div>
        <button className="button button--quiet button--small" type="button" disabled={blocked} onClick={() => void refresh()}>Refresh</button>
      </div>
      {!file ? <details className="changes-workspaces"><summary>Workspace · {currentSession?.title || "Project workspace"}</summary><div><button type="button" aria-pressed={!workspace} disabled={blocked} onClick={() => setWorkspace(undefined)}>Project workspace</button>{sessions.map((session) => <button key={session.id} type="button" aria-pressed={workspace === session.id} disabled={blocked} onClick={() => setWorkspace(session.id)}>{session.title || "Untitled session"}</button>)}</div></details> : <p className="changes-path">{file.relative} · {file.kind === "staged" ? "Staged" : "Changes"}</p>}
      {disabled ? <p className="settings-note">Reconnect to refresh these changes.</p> : null}
      {error ? <p className="error-copy" role="alert">{error}</p> : null}
      <p className="settings-note changes-loading" role="status">{loading ? "Loading changes…" : ""}</p>
      {file ? (file.binary || file.tooLarge || file.truncated ? <p className="settings-note">This file needs review on your Mac.</p> : <div className="changes-diff" aria-label="File diff">{diff?.blocks.map((block, index) => block.kind === "fold" ? <details key={index}><summary>{block.lines.length} unchanged lines</summary><pre>{block.lines.map((line) => line.text).join("\n")}</pre></details> : <pre key={index}>{block.lines.map((line, lineIndex) => <span key={lineIndex} className={`diff-line diff-line--${line.kind}`}><span className="diff-number" aria-hidden="true">{line.oldNumber ?? ""}</span><span className="diff-number" aria-hidden="true">{line.newNumber ?? ""}</span><code>{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}{line.text || " "}</code></span>)}</pre>)}</div>) : data ? <>{!data.files.length ? <p className="changes-empty">No uncommitted changes.</p> : (["staged", "unstaged"] as const).map((kind) => {
        const files = data.files.filter((entry) => entry[kind]);
        return files.length ? <section className="changes-section" key={kind}><h3>{kind === "staged" ? "Staged" : "Changes"}<span>{files.length}</span></h3>{files.map((entry) => <button className="changed-file" key={entry.relative} type="button" disabled={blocked} onClick={() => void openFile(entry.relative, kind)}><span><strong>{entry.relative}</strong><small>{entry.status}</small></span><span className="changed-file__counts">+{entry.additions} −{entry.deletions}</span><span aria-hidden="true">›</span></button>)}</section> : null;
      })}</> : null}
    </div>
  </section>;
}
