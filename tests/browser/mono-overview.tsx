import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MonoOverview, type MonoOverviewTab } from "../../src/features/monos/ui/MonoOverview";
import { LaunchedSessionCard } from "../../src/features/monos/ui/LaunchedSessionCard";
import { newSession } from "../../src/features/sessions/model/session";
import { launchedSessionState } from "../../src/features/monos/model/monoSpawnedSessions";
import "../../src/styles/index.css";

const initial = ["approval", "question", "draft", "failed", "stopped", "done", "unknown"].map((state, index) => ({
  ...newSession("codex", "/repo"), id: state, title: `Task ${index + 1}`, busy: state === "approval" || state === "question",
  pendingQuestion: state === "question" ? { requestId: 2, questions: [] } : undefined,
  blocks: [{ id: `user-${state}`, role: "user" as const, text: "Check the project", ...(state === "done" ? { durationMs: 10 } : {}), ...(state === "draft" ? { draft: true } : {}) },
    ...(state === "approval" ? [{ id: "approval", role: "tool" as const, text: "Run checks?", approval: { requestId: 1 } }] : []),
    ...(state === "failed" || state === "stopped" ? [{ id: "notice", role: "system" as const, text: state, notice: state === "failed" ? "error" as const : "interrupt" as const }] : [])],
}));
const launches = initial.map(session => ({ sessionId: session.id, cwd: session.cwd, title: session.title, harness: session.harness, model: session.model }));
function Fixture() {
  const [sessions, setSessions] = useState(initial);
  const [tab, setTab] = useState<MonoOverviewTab>("sessions");
  const [shown, setShown] = useState<string>();
  const session = sessions.find(entry => entry.id === shown);
  return <main style={{ height: "100%", display: "flex" }}>
    <MonoOverview open monoId="fixture" cwd="/repo" agent={{ name: "Scout", mascot: "cat", color: "#459bf7", projects: [] }} state={{ status: "working" }} launches={launches} sessions={sessions} documents={[]} tab={tab} onTabChange={setTab} onOpenSession={setShown} onOpenDocument={() => {}} onClose={() => {}} onBackFromSession={() => setShown(undefined)} shownSession={session ? {
      sessionId: session.id, title: session.title,
      pane: <div style={{ overflow: "auto", flex: 1, padding: 16 }}>
        <LaunchedSessionCard launch={launches.find(launch => launch.sessionId === session.id)!} view={{ state: launchedSessionState(session), title: session.title }} onOpen={() => {}} />
        <div style={{ height: 900 }}>Earlier conversation</div>
        {session.busy ? <div {...(session.id === "question" ? { "data-question-form": "" } : { "data-pending-approval": "" })}><p>{session.id === "question" ? "Choose a section" : "Run checks?"}</p><button onClick={() => setSessions(current => current.map(entry => entry.id === session.id ? { ...entry, busy: false, pendingQuestion: undefined, blocks: [] } : entry))}>Resolve fixture</button></div> : <p>Resolved</p>}
      </div>,
    } : undefined} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
