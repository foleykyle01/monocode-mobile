import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MonoOverview, type MonoOverviewTab } from "../../src/features/monos/ui/MonoOverview";
import { LaunchedSessionCard } from "../../src/features/monos/ui/LaunchedSessionCard";
import { newSession } from "../../src/features/sessions/model/session";
import { launchedSessionState } from "../../src/features/monos/model/monoSpawnedSessions";
import { Modal } from "../../src/shared/ui/Modal";
import { SecondaryButton } from "../../src/shared/ui/SecondaryButton";
import { SearchableSelect } from "../../src/shared/ui/SearchableSelect";
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
  const [dialog, setDialog] = useState(false);
  const [appearance, setAppearance] = useState("system");
  const [sessions, setSessions] = useState(initial);
  const [tab, setTab] = useState<MonoOverviewTab>("sessions");
  const [shown, setShown] = useState<string>();
  const session = sessions.find(entry => entry.id === shown);
  return <main style={{ height: "100%", display: "flex" }}>
    <div style={{ position: "absolute", zIndex: 1, right: 16, bottom: 16 }}><SecondaryButton onClick={() => setDialog(true)}>Interface settings</SecondaryButton></div>
    {dialog ? <Modal title="Interface settings" description="Keep the workspace comfortable on this Mac." onClose={() => setDialog(false)}><div className="space-y-4 p-4"><SearchableSelect label="Appearance" value={appearance} options={[{ value: "system", label: "Follow system" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={setAppearance} /><SecondaryButton onClick={() => setDialog(false)}>Done</SecondaryButton></div></Modal> : null}
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
