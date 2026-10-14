import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { scanPairingTicket, scannerErrorMessage } from "./scanner";
import type { CompanionClient } from "./client";
import { CompanionRequestError, createCompanionClient } from "./client";
import type {
  CompanionBlock,
  CompanionAppearance,
  CompanionNavigation,
  CompanionMonoRead,
  CompanionMutationAction,
  SessionConfiguration,
  CompanionSession,
  CompanionStatus,
  MutationInput,
  PendingMutation,
  SessionRead,
} from "./types";
import "./companion.css";
import { Transcript } from "./Transcript";
import { SessionChanges } from "./SessionChanges";
import { MonoMascot, Navigation } from "./Navigation";
import { MonoDetailsView } from "./MonoDetailsView";
import { ConnectionNotice } from "./ConnectionNotice";
import { SessionSettings } from "./SessionSettings";
import { NotificationSettings } from "./NotificationSettings";
import { PHONE_NOTIFICATIONS_ENABLED } from "./features";
import { usePhoneNotifications } from "./phoneNotifications";
import { appearanceStyle as desktopAppearanceStyle, BASE_APPEARANCES, readAppearanceMode, resolveAppearance } from "./appearance";
import { ChatBackground } from "./ChatBackground";
import { mergeLatest, prependHistory } from "./history";
import { InboxView } from "./InboxView";
import { ChangesView } from "./ChangesView";
import { useEdgeSwipeBack } from "./useEdgeSwipeBack";
import { useSessionActivity } from "./sessionActivity";
import { ChevronLeft, ChevronRight, Search, Settings, X, ArrowUp, Inbox } from "../../src/shared/ui/icons";
import "./glass.css";
import { createWorkspaceDemo } from "./workspaceDemo";

const appMark = new URL("../../src-tauri/icons/128x128.png", import.meta.url).href;

function SettingsChoices({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return <fieldset className="settings-choices"><legend>{label}</legend><div>{options.map(([id, title]) => <label key={id}><input type="radio" name={label} value={id} checked={value === id} onChange={() => onChange(id)} /><span>{title}</span></label>)}</div></fieldset>;
}

const DEMO_STATUS: CompanionStatus = { paired: true, hostId: "demo-host" };
const DEMO_EPOCH = "demo-epoch";
const DEMO_CONFIGURATION: SessionConfiguration = {
  models: [{ harness: "claude", id: "Opus 5.5", label: "Opus 5.5" }, { harness: "claude", id: "Claude Sonnet", label: "Sonnet" }, { harness: "codex", id: "GPT-5", label: "GPT-5" }],
  accessModes: [{ id: "supervised", label: "Supervised", description: "Ask before commands and file changes." }, { id: "autonomous", label: "Autonomous", description: "Run commands and edit files without asking each time." }],
};
const DEMO_NAVIGATION: CompanionNavigation = {
  groups: [
    { id: "apps", name: "Applications", projectIds: ["monocode", "lab"] },
    { id: "personal", name: "Personal", projectIds: ["notes"] },
  ],
  projects: [
    { id: "monocode", name: "MonoCode", path: "/Users/kyle/Code/monocode", groupId: "apps", mascot: "invader", color: "#69b7ff", logo: appMark },
    { id: "lab", name: "Companion Lab", path: "/Users/kyle/Code/lab", groupId: "apps", mascot: "robot", color: "#efb65b" },
    { id: "notes", name: "Notes", path: "/Users/kyle/Code/notes", groupId: "personal", mascot: "cat", color: "#98c78c" },
  ],
  monos: [
    { id: "scout", name: "Scout", mascot: "ghost", color: "#69b7ff", projectIds: ["monocode", "lab"], status: "working", statusLabel: "Working", activity: "Reviewing companion navigation", busy: true, needsApproval: false, sessionId: "mono-scout", canChat: true },
    { id: "atlas", name: "Atlas", mascot: "robot", color: "#c2a0fa", projectIds: ["notes"], status: "needs-you", statusLabel: "Needs you", activity: "Choose the notes to organize", busy: false, needsApproval: true, sessionId: "mono-atlas", canChat: true },
  ],
};
const DEMO_SESSIONS: CompanionSession[] = [
  { id: "mono-scout", title: "Scout", cwd: "/Users/kyle/Code/monocode", harness: "claude", model: "Opus 5.5", runtimeMode: "supervised", busy: true, turn: 0, needsApproval: false },
  { id: "mono-atlas", title: "Atlas", cwd: "/Users/kyle/Code/notes", harness: "codex", model: "GPT-5", runtimeMode: "supervised", busy: true, turn: 0, needsApproval: true, needsQuestion: true },
  {
    id: "demo-shipyard",
    projectId: "monocode",
    title: "Build the companion window",
    cwd: "/Users/kyle/Code/monocode",
    harness: "claude",
    model: "Opus 5.5",
    runtimeMode: "supervised",
    busy: true,
    turn: 12,
    needsApproval: true,
  },
  {
    id: "demo-docs",
    projectId: "monocode",
    title: "Review release notes",
    cwd: "/Users/kyle/Code/monocode",
    harness: "codex",
    model: "GPT-5",
    runtimeMode: "autonomous",
    busy: false,
    turn: 8,
    needsApproval: false,
  },
  {
    id: "demo-scratch",
    projectId: "lab",
    title: "Prototype a reconnect flow",
    cwd: "/Users/kyle/Code/lab",
    harness: "opencode",
    model: "Claude Sonnet",
    runtimeMode: "supervised",
    busy: false,
    turn: 3,
    needsApproval: false,
  },
];
const DEMO_BLOCKS: Record<string, CompanionBlock[]> = {
  "mono-scout": [
    { id: "scout-1", role: "user", text: "Build the companion window and review the release notes." },
    { id: "scout-2", role: "assistant", text: "I’ve started two sessions in MonoCode. Open either one to follow its progress, answer approvals, or send a message. I’ll bring the results back here.", spawnedSessions: DEMO_SESSIONS.filter(session => session.id === "demo-shipyard" || session.id === "demo-docs") },
  ],
  "mono-atlas": [{ id: "atlas-1", role: "assistant", text: "Ready to help with your notes." }],
  "demo-shipyard": [
    { id: "d1", role: "user", text: "Build the smallest useful companion client." },
    {
      id: "d2",
      role: "assistant",
      text: "I found the desktop bridge. I’m checking the mobile surface and its reconnect behavior now.",
    },
    {
      id: "d3",
      role: "tool",
      text: "Need approval to run: npm test -- companion",
      approval: { requestId: 42 },
    },
  ],
  "demo-docs": [
    ...Array.from({ length: 12 }, (_, index): CompanionBlock => ({ id: `history-${index}`, role: index % 2 ? "assistant" : "user", text: index % 2 ? "The project keeps its existing desktop session. I’ll preserve the draft and the current working directory." : `Review item ${Math.floor(index / 2) + 1} from the release checklist.` })),
    { id: "d4", role: "user", text: "Summarize the changes from this morning." },
    { id: "tool-1", role: "tool", text: "Read the taskboard configuration and existing sections.", activity: { label: "Read tasks.json", kind: "read", state: "accepted" } },
    { id: "tool-2", role: "tool", text: "Found three active project tasks.", activity: { label: "List Taskboard", kind: "list", state: "accepted" } },
    { id: "tool-3", role: "tool", text: "Updated the section documentation.", activity: { label: "Edit README.md", kind: "edit", state: "accepted" } },
    { id: "d5", role: "assistant", text: "## Ready for review\n\nYou can create a session inside a project and continue an existing Mono conversation. **Your Mac owns the session.**\n\n- Project icons and appearance follow the desktop.\n- Model and access changes apply to the next message.\n- Earlier messages remain available as the conversation grows.\n\n```ts\nconst session = await workspace.createSession(project.id);\n```\n\n| Check | Result |\n| --- | --- |\n| Project hierarchy | Preserved |\n| Session defaults | Inherited from Mac |\n| Long conversation | Load earlier messages |\n\n> Keep the Mac awake while using the companion.\n\nThis is sample content for reviewing the interface." },
  ],
  "demo-scratch": [
    { id: "d6", role: "assistant", text: "Ready when you are." },
  ],
};

function isDemo() {
  return new URLSearchParams(window.location.search).get("demo") === "1";
}

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function demoClient() {
  const epoch = DEMO_EPOCH;
  const sessions = DEMO_SESSIONS.map((session) => ({ ...session }));
  const blocks = structuredClone(DEMO_BLOCKS);
  let question: SessionRead["pendingQuestion"] = { requestId: 7, title: "Section type", questions: [{ id: "section", header: "Section type", prompt: "What kind of section would you like to add?", multiSelect: false, allowCustom: true, options: [
    { id: "tasks", label: "New status column in tasks.json", description: "Add a category alongside the existing tasks." },
    { id: "docs", label: "New section in README.md", description: "Add a documentation section to the README." },
  ] }] };
  const workspace = createWorkspaceDemo(epoch);
  const navigation = () => ({ ...DEMO_NAVIGATION, monos: DEMO_NAVIGATION.monos.map(mono => {
    const session = sessions.find(entry => entry.id === mono.sessionId)!;
    const status = session.needsApproval ? "needs-you" as const : session.busy ? "working" as const : "idle" as const;
    return { ...mono, status, statusLabel: status === "needs-you" ? "Needs you" : status === "working" ? "Working" : "Idle", activity: status === "idle" ? undefined : mono.activity, busy: session.busy, needsApproval: session.needsApproval };
  }) });
  const fake: CompanionClient = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
    if (command === "companion_status") return DEMO_STATUS as T;
    if (command === "companion_pair") return DEMO_STATUS as T;
    if (command === "companion_pending") return [] as T;
    if (command === "companion_dismiss_pending") return undefined as T;
    if (command === "companion_forget") return undefined as T;
    if (command === "companion_reconnect") return undefined as T;
    if (command === "companion_request") {
      const action = args?.action;
      const input = (args?.input || {}) as Record<string, unknown>;
      if (action === "sessions.list") return { ok: true, result: { epoch, sessions: sessions.map(session => ({ ...session })), navigation: navigation(), capabilities: { createSession: true, inbox: true, changes: true }, truncated: false } } as T;
      if (action === "monos.read") {
        const mono = navigation().monos.find(entry => entry.id === input.monoId);
        if (!mono) return { ok: false, error: "Sample Mono unavailable" } as T;
        const session = sessions.find(entry => entry.id === mono.sessionId)!;
        const result: CompanionMonoRead = {
          mono: { ...mono, canChat: !!mono.canChat }, scope: { projects: DEMO_NAVIGATION.projects.filter(project => mono.projectIds.includes(project.id)) },
          model: { harness: session.harness, id: session.model, label: session.model, settings: { effort: "high" } },
          access: { id: session.runtimeMode!, label: session.runtimeMode === "autonomous" ? "Autonomous" : "Supervised" },
          soul: { text: `You are ${mono.name}. Keep the user's projects organized, preserve their ongoing work, and explain decisions clearly.`, offset: 0, totalLines: 1, truncated: false },
          memory: { text: "The companion mirrors the Mac workspace. Keep Monos above groups, projects, and sessions.\nConnection controls belong in Settings.", offset: 0, totalLines: 2, truncated: false },
          habits: { offset: 0, total: 1, truncated: false, items: [{ id: "morning-review", name: "Morning project review", instructions: "Review active projects and surface anything that needs attention. Keep the update brief.", schedule: { scheduleKind: "daily", minute: 0, time: "09:00", dayOfWeek: 1 }, enabled: true, createdAt: 1791723600000, nextRunAt: 1791810000000, lastRunAt: 1791723600000, lastOutcome: "posted", runs: [{ at: 1791723600000, durationMs: 42000, outcome: "posted", report: "Companion navigation is ready for review. No other projects need attention." }] }] },
        };
        return { ok: true, result: { ...result, epoch } } as T;
      }
      const workspaceResponse = workspace.request(String(action), input);
      if (workspaceResponse !== undefined) return workspaceResponse as T;
      if (action === "sessions.create") {
        const project = DEMO_NAVIGATION.projects.find(entry => entry.id === input.projectId);
        if (!project || typeof input.sessionId !== "string") return { ok: false, error: "Sample project unavailable" } as T;
        if (!sessions.some(entry => entry.id === input.sessionId)) {
          const seed = sessions.find(entry => entry.projectId === project.id) || DEMO_SESSIONS[2];
          sessions.push({ id: input.sessionId, projectId: project.id, title: "New session", cwd: project.path, harness: seed.harness, model: seed.model, runtimeMode: seed.runtimeMode, busy: false, turn: 0, needsApproval: false });
          blocks[input.sessionId] = [];
        }
        return { ok: true, result: { epoch, sessionId: input.sessionId, accepted: true, turn: 0 } } as T;
      }
      if (action === "sessions.read") {
        const session = sessions.find((entry) => entry.id === input.sessionId) || sessions[0];
        const transcript = blocks[session.id] || [];
        const end = typeof input.before === "number" ? input.before : transcript.length;
        const start = Math.max(0, end - 8);
        return {
          ok: true,
          result: {
            epoch,
            session: { ...session },
            blocks: transcript.slice(start, end).map(block => block.spawnedSessions ? { ...block, spawnedSessions: block.spawnedSessions.flatMap(link => sessions.filter(target => target.id === link.id).map(target => ({ ...target }))) } : block),
            configuration: DEMO_CONFIGURATION,
            pendingQuestion: session.id === "mono-atlas" ? question : undefined,
            reviewAvailable: true,
            nextBefore: start || null,
            totalBlocks: (blocks[session.id] || []).length,
          },
        } as T;
      }
      const session = sessions.find(entry => entry.id === input.sessionId);
      if (!session) return { ok: false, error: "Sample session unavailable" } as T;
      if (action === "sessions.review.list") return { ok: true, result: { epoch, turn: session.turn, total: session.id === "demo-docs" ? 2 : 0, files: session.id === "demo-docs" ? [{ relative: "README.md", additions: 3, deletions: 1, exact: true }, { relative: "src/tasks.json", additions: 2, deletions: 0, exact: false }] : [], additions: 5, deletions: 1, truncated: false } } as T;
      if (action === "sessions.review.read") return { ok: true, result: { epoch, turn: session.turn, relative: input.relative, original: "# Taskboard\nOld section\n", current: "# Taskboard\n\n## Sections\nGroup related tasks into sections.\n", unavailable: false } } as T;
      if (action === "sessions.answer") {
        question = undefined; session.busy = false; session.needsApproval = false; session.needsQuestion = false;
        blocks[session.id].push({ id: "question-replied", role: "assistant", text: "Answer received in this preview. The live app sends your choice back to the agent on your Mac." });
      }
      if (action === "sessions.configure") {
        if (typeof input.model === "string") session.model = input.model;
        if (typeof input.harness === "string") session.harness = input.harness;
        if (typeof input.runtimeMode === "string") session.runtimeMode = input.runtimeMode;
      } else if (action === "sessions.send") {
        blocks[session.id] ||= [];
        blocks[session.id].push({ id: crypto.randomUUID(), role: "user", text: String(input.text) }, { id: crypto.randomUUID(), role: "assistant", text: "Preview response — your message stays in this sample conversation. No agent was contacted." });
        session.turn += 1;
      } else if (action === "sessions.stop" || action === "sessions.approve") {
        for (const block of blocks[session.id] || []) if (block.approval && !block.approval.decided) block.approval.decided = action === "sessions.stop" ? "cancelled" : input.decision as "allow" | "deny";
        session.busy = false;
        session.needsApproval = false;
      }
      return { ok: true, result: { epoch, sessionId: input.sessionId, accepted: true, turn: session.turn } } as T;
    }
    throw new Error("Demo command unavailable");
  }, { native: true });
  return fake;
}

function PairScreen({ client, onPaired }: { client: CompanionClient; onPaired: (status: CompanionStatus) => void }) {
  const [ticket, setTicket] = useState("");
  const [error, setError] = useState<string>();
  const [pairing, setPairing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const pairingRef = useRef(false);
  const demo = isDemo();
  const canScan = client.native && isIosDevice();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ticket.trim() || pairingRef.current || scanning) return;
    pairingRef.current = true;
    setPairing(true);
    setError(undefined);
    try {
      onPaired(await client.pair(ticket.trim()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Pairing failed");
    } finally {
      pairingRef.current = false;
      setPairing(false);
    }
  }

  async function scanTicket() {
    if (!client.native || scanning || pairingRef.current) return;
    setScanning(true);
    setError(undefined);
    try {
      setTicket(await scanPairingTicket());
    } catch (reason) {
      setError(scannerErrorMessage(reason));
    } finally {
      setScanning(false);
    }
  }

  return (
    <main className="companion-shell companion-shell--pair">
      <div className="pair-brand"><img className="brand-icon" src={appMark} alt="" /><span>MonoCode Mobile</span></div>
      <h1>Connect to your Mac</h1>
      <p className="pair-copy">Connect to MonoCode on your Mac to pick up your chats and Monos.</p>
      {client.native ? (
        <form className="pair-form" onSubmit={submit}>
          <ol className="pair-steps">
            <li><strong>Open MonoCode on your Mac</strong><span>Use the Mac build with phone support.</span></li>
            <li><strong>Go to Settings → Connections</strong><span>Under Phone companion, turn on Remote access.</span></li>
            <li><strong>Choose Show QR code</strong><span>Scan it here to pair this device.</span></li>
          </ol>
          {ticket.trim() && !showPaste && canScan ? <p className="pair-ready" role="status">Code ready. Connect to finish pairing.</p> : null}
          {canScan ? <button className="button button--primary" type={ticket.trim() ? "submit" : "button"} onClick={ticket.trim() ? undefined : () => void scanTicket()} disabled={scanning || pairing}>{ticket.trim() ? (pairing ? "Connecting…" : "Connect to Mac") : scanning ? "Opening camera…" : "Scan QR ticket"}</button> : null}
          {canScan && ticket.trim() ? <button className="button button--text" type="button" onClick={() => void scanTicket()} disabled={scanning || pairing}>{scanning ? "Opening camera…" : "Scan a different QR ticket"}</button> : null}
          {canScan ? <button className="button button--text" type="button" disabled={scanning || pairing} onClick={() => setShowPaste((shown) => !shown)}>{showPaste ? "Hide pasted ticket" : "Paste a ticket instead"}</button> : null}
          {(!canScan || showPaste) ? <div className="ticket-field"><label htmlFor="pair-ticket">Pairing ticket</label><textarea id="pair-ticket" value={ticket} onChange={(event) => setTicket(event.target.value)} placeholder={demo ? "Paste any sample text to try pairing" : "Paste the ticket from your Mac"} rows={3} autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={scanning || pairing} />{!canScan ? <button className="button button--primary" type="submit" disabled={!ticket.trim() || pairing}>{pairing ? "Connecting…" : "Connect to Mac"}</button> : null}</div> : null}
          {error ? <p className="error-copy" role="alert">{error}</p> : null}
          <p className="pair-footnote">Keep MonoCode open and your Mac awake. Your sessions and files stay on your Mac. No VPN app needed.</p>
        </form>
      ) : (
        <section className="pair-explanation" aria-labelledby="setup-title">
          <h2 id="setup-title">This window needs the MonoCode app</h2>
          <p>Use MonoCode Mobile to pair with your Mac.</p>
        </section>
      )}
      {demo ? <button className="button button--text" type="button" disabled={pairing || scanning} onClick={() => onPaired(DEMO_STATUS)}>Back to preview</button> : null}
    </main>
  );
}

function Workspace({ client, status, onForget, onPreviewSetup }: { client: CompanionClient; status: CompanionStatus; onForget: () => Promise<void>; onPreviewSetup?: () => void }) {
  const demo = isDemo();
  const appearanceKey = demo ? "companion.preview.appearance.v1" : "companion.appearance.v1";
  const [appearanceMode, setAppearanceMode] = useState(() => readAppearanceMode(appearanceKey));
  const changeAppearance = (value: string) => {
    if (value !== "host" && value !== "light" && value !== "dark") return;
    setAppearanceMode(value);
    try { localStorage.setItem(appearanceKey, value); } catch { /* Keep the choice for this run if storage is unavailable. */ }
  };
  const [sessions, setSessions] = useState<CompanionSession[]>([]);
  const [sessionEpoch, setSessionEpoch] = useState<string>();
  const [navigation, setNavigation] = useState<CompanionNavigation>();
  const [creationEpoch, setCreationEpoch] = useState<string>();
  const [workspaceCapabilities, setWorkspaceCapabilities] = useState({ inbox: false, changes: false });
  const [workspaceView, setWorkspaceView] = useState<{ kind: "inbox" } | { kind: "changes"; projectId: string } | { kind: "mono"; monoId: string }>();
  const availableSessionIds = useRef(new Set<string>());
  const notificationSelection = useRef<string | undefined>(undefined);
  const [selectedMonoId, setSelectedMonoId] = useState<string>();
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const [lastSeen, setLastSeen] = useState<number>();
  const [previewConnection, setPreviewConnection] = useState("connected");
  const [previewLayout, setPreviewLayout] = useState<"chat" | "full">("chat");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [monosExpanded, setMonosExpanded] = useState(true);
  const [viewportHeight, setViewportHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  const [viewportTop, setViewportTop] = useState(() => window.visualViewport?.offsetTop ?? 0);
  const [selectedId, setSelectedId] = useState<string>();
  const selectedIdRef = useRef(selectedId);
  useLayoutEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const [read, setRead] = useState<SessionRead>();
  const [linkedView, setLinkedView] = useState<{ session: CompanionSession; parent: { read: SessionRead; monoId: string; name: string; scrollTop: number } }>();
  const linkedViewRef = useRef(linkedView);
  useLayoutEffect(() => { linkedViewRef.current = linkedView; }, [linkedView]);
  const [restoredPosition, setRestoredPosition] = useState<{ sessionId: string; top: number }>();
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const historySerial = useRef(0);
  const historyInFlight = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const composer = selectedId ? drafts[selectedId] || "" : "";
  const setComposer = (text: string) => {
    if (selectedId) setDrafts((current) => ({ ...current, [selectedId]: text }));
  };
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string>();
  const [connectionError, setConnectionError] = useState<string>();
  const initialPendingRef = useRef<PendingMutation | undefined>(client.pendingMutations()[0]);
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | undefined>(() => initialPendingRef.current);
  const [acting, setActing] = useState(false);
  const [appearance, setAppearance] = useState<CompanionAppearance>();
  const [mobileListOpen, setMobileListOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBack = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [forgetOpen, setForgetOpen] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [forgetError, setForgetError] = useState<string>();
  const refreshSerial = useRef(0);
  const transcriptSerial = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const actingRef = useRef(false);
  const pendingRef = useRef<PendingMutation | undefined>(initialPendingRef.current);
  const offlineRef = useRef(false);
  const reconnectInFlight = useRef<Promise<void> | null>(null);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setForgetOpen(false);
    requestAnimationFrame(() => settingsButton.current?.focus({ preventScroll: true }));
  }, []);
  const settingsSurface = useEdgeSwipeBack(closeSettings, settingsOpen, "settings");
  useEffect(() => { if (settingsOpen) settingsBack.current?.focus({ preventScroll: true }); }, [settingsOpen]);
  const notifications = usePhoneNotifications(demo, status.hostId,
    !mobileListOpen && !settingsOpen && !workspaceView ? selectedId : undefined,
    target => {
      notificationSelection.current = target.sessionId;
      setSettingsOpen(false); setWorkspaceView(undefined); setSelectedMonoId(undefined);
      if (target.sessionId !== selectedId) setRead(undefined);
      setSelectedId(target.sessionId); setMobileListOpen(false);
    });

  useEffect(() => {
    const update = () => { setViewportHeight(window.visualViewport?.height ?? window.innerHeight); setViewportTop(window.visualViewport?.offsetTop ?? 0); };
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
    return () => { window.visualViewport?.removeEventListener("resize", update); window.visualViewport?.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);

  const refresh = useCallback(async (selectId?: string) => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const serial = ++refreshSerial.current;
    const task = (async () => {
      setLoading(true);
      try {
        const list = await client.sessionsList();
        if (serial !== refreshSerial.current) return;
        setSessions(list.sessions);
        setSessionEpoch(list.epoch);
        setNavigation(list.navigation);
        setCreationEpoch(list.capabilities?.createSession ? list.epoch : undefined);
        setWorkspaceCapabilities({ inbox: !!list.capabilities?.inbox, changes: !!list.capabilities?.changes });
        availableSessionIds.current = new Set(list.sessions.map(session => session.id));
        setLastSeen(Date.now());
        setAppearance(list.appearance);
        const notified = notificationSelection.current;
        if (notified && !list.sessions.some(entry => entry.id === notified) && !list.navigation?.monos.some(mono => mono.canChat && mono.sessionId === notified)) {
          setError("The notified session is no longer available in this workspace.");
          setMobileListOpen(true);
        }
        notificationSelection.current = undefined;
        setSelectedId((current) => {
          const preferred = notified ?? selectId ?? current ?? initialPendingRef.current?.input.sessionId;
          // A direct Mono link may point beyond the bounded workspace list.
          const available = preferred && (linkedViewRef.current?.session.id === preferred || list.sessions.some(entry => entry.id === preferred) || list.navigation?.monos.some(mono => mono.canChat && mono.sessionId === preferred));
          return available ? preferred : list.sessions[0]?.id;
        });
        offlineRef.current = false;
        setOffline(false);
        setConnectionError(undefined);
      } catch (reason) {
        if (serial !== refreshSerial.current) return;
        offlineRef.current = true;
        setOffline(true);
        setConnectionError(reason instanceof Error ? reason.message : "Desktop is unreachable");
      } finally {
        if (serial === refreshSerial.current) setLoading(false);
      }
    })();
    refreshInFlight.current = task;
    void task.finally(() => {
      if (refreshInFlight.current === task) refreshInFlight.current = null;
    });
    return task;
  }, [client, demo]);

  const refreshTranscript = useCallback(async (sessionId: string) => {
    const serial = ++transcriptSerial.current;
    try {
      const result = await client.sessionRead(sessionId);
      if (serial === transcriptSerial.current && selectedIdRef.current === sessionId) {
        setRead(previous => mergeLatest(previous, result));
        offlineRef.current = false;
        setOffline(false);
      }
    } catch (reason) {
      if (serial === transcriptSerial.current && selectedIdRef.current === sessionId) {
        offlineRef.current = true;
        setOffline(true);
        setConnectionError(reason instanceof Error ? reason.message : "Could not read this session");
      }
    }
  }, [client, demo]);

  const reconnect = useCallback(() => {
    if (reconnectInFlight.current) return reconnectInFlight.current;
    offlineRef.current = true;
    setOffline(true);
    setReconnecting(true);
    // Keep the last transcript and reading position visible while controls are disabled.
    ++historySerial.current;
    historyInFlight.current = false;
    setLoadingEarlier(false);
    setHistoryError(undefined);
    // Ignore results from reads started before suspension; a new snapshot wins.
    ++refreshSerial.current;
    ++transcriptSerial.current;
    refreshInFlight.current = null;
    const task = (async () => {
      try {
        if (!demo) await client.reconnect();
        const restored = client.pendingMutations()[0];
        pendingRef.current = restored;
        setPendingMutation(restored);
        await refresh();
        const currentId = selectedIdRef.current;
        if (currentId) await refreshTranscript(currentId);
      } catch (reason) {
        setConnectionError(reason instanceof Error ? reason.message : "Could not reconnect to the Mac");
      } finally {
        setReconnecting(false);
      }
    })();
    reconnectInFlight.current = task;
    void task.finally(() => { if (reconnectInFlight.current === task) reconnectInFlight.current = null; });
    return task;
  }, [client, demo, refresh, refreshTranscript]);

  useEffect(() => {
    const recover = () => {
      setNetworkOnline(navigator.onLine);
      if (document.visibilityState === "visible") void reconnect();
    };
    const wentOffline = () => { setNetworkOnline(false); offlineRef.current = true; setOffline(true); };
    document.addEventListener("visibilitychange", recover);
    window.addEventListener("online", recover);
    window.addEventListener("offline", wentOffline);
    return () => {
      document.removeEventListener("visibilitychange", recover);
      window.removeEventListener("online", recover);
      window.removeEventListener("offline", wentOffline);
    };
  }, [reconnect]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    setRead(previous => previous?.session.id === selectedId ? previous : undefined);
    setRestoredPosition(previous => previous?.sessionId === selectedId ? previous : undefined);
    if (linkedViewRef.current && linkedViewRef.current.session.id !== selectedId) setLinkedView(undefined);
    setError(undefined);
    ++historySerial.current;
    historyInFlight.current = false;
    setLoadingEarlier(false);
    setHistoryError(undefined);
    if (selectedId) void refreshTranscript(selectedId);
  }, [selectedId, refreshTranscript]);
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let running = false;
    const poll = async () => {
      if (stopped || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        if (reconnectInFlight.current) {
          await reconnectInFlight.current;
          return;
        }
        await refresh();
        if (!stopped && document.visibilityState === "visible" && selectedId) await refreshTranscript(selectedId);
      } finally {
        running = false;
        if (!stopped && document.visibilityState === "visible") timer = window.setTimeout(() => { timer = undefined; void poll(); }, 4000);
      }
    };
    const recover = () => {
      if (document.visibilityState === "visible") {
        if (timer) { window.clearTimeout(timer); timer = undefined; }
        void poll();
      }
    };
    document.addEventListener("visibilitychange", recover);
    void poll();
    return () => { stopped = true; document.removeEventListener("visibilitychange", recover); if (timer) window.clearTimeout(timer); };
  }, [refresh, refreshTranscript, selectedId]);

  const selectedMono = navigation?.monos.find(mono => selectedMonoId ? mono.id === selectedMonoId : mono.sessionId === selectedId);
  const displayOffline = demo ? previewConnection !== "connected" : offline || reconnecting || !networkOnline;
  const displayReconnecting = demo ? previewConnection === "reconnecting" : reconnecting;
  const displayOnline = demo ? previewConnection !== "offline" : networkOnline;
  const activeRead = read?.session.id === selectedId ? read : undefined;
  const unreadSessionIds = useSessionActivity(sessions, sessionEpoch, !mobileListOpen && !workspaceView && !settingsOpen && document.visibilityState === "visible" ? activeRead?.session : undefined);
  const selected = activeRead?.session || sessions.find((session) => session.id === selectedId) || (linkedView && linkedView.session.id === selectedId ? linkedView.session : undefined);
  const mutationsDisabled = displayOffline || !networkOnline || reconnecting || !!pendingMutation || acting;
  const canSend = !!selected && !!activeRead && !selected.busy && !!composer.trim() && !mutationsDisabled;
  const hostAppearance = demo ? { ...BASE_APPEARANCES.dark, transcriptLayout: previewLayout } : appearance;
  const displayedAppearance = resolveAppearance(appearanceMode, hostAppearance);
  const appearanceStyle = {
    "--companion-viewport": `${viewportHeight}px`,
    "--companion-viewport-top": `${viewportTop}px`,
    "--companion-bottom-inset": document.body.getBoundingClientRect().height - viewportHeight > 150 ? "0px" : "env(safe-area-inset-bottom)",
    ...desktopAppearanceStyle(displayedAppearance),
  } as React.CSSProperties;

  useEffect(() => {
    const root = document.documentElement;
    root.style.colorScheme = displayedAppearance?.scheme || "dark";
    root.style.backgroundColor = displayedAppearance ? `hsl(${displayedAppearance.hue} ${displayedAppearance.saturation}% ${displayedAppearance.backgroundLightness}%)` : "hsl(240 0% 9%)";
    return () => { root.style.removeProperty("color-scheme"); root.style.removeProperty("background-color"); };
  }, [displayedAppearance?.scheme, displayedAppearance?.hue, displayedAppearance?.saturation, displayedAppearance?.backgroundLightness]);

  async function loadEarlier() {
    if (!activeRead || activeRead.nextBefore === null || historyInFlight.current || displayOffline || reconnecting) return;
    const before = activeRead.nextBefore;
    const sessionId = activeRead.session.id;
    const serial = ++historySerial.current;
    historyInFlight.current = true;
    setLoadingEarlier(true);
    setHistoryError(undefined);
    try {
      const earlier = await client.sessionRead(sessionId, before);
      if (serial === historySerial.current) setRead(current => current ? prependHistory(current, earlier, before) : current);
    } catch (reason) {
      if (serial === historySerial.current) setHistoryError(reason instanceof Error ? reason.message : "Could not load earlier messages");
    } finally {
      if (serial === historySerial.current) { historyInFlight.current = false; setLoadingEarlier(false); }
    }
  }

  async function action(action: CompanionMutationAction, input: MutationInput) {
    if (actingRef.current || pendingRef.current || offlineRef.current || displayOffline || !networkOnline || reconnecting) return;
    if (action === "sessions.create") {
      if (!creationEpoch || input.epoch !== creationEpoch) return;
    } else if (!activeRead || activeRead.session.id !== selectedId || input.sessionId !== selectedIdRef.current) return;
    if (action === "sessions.send" && (selected?.busy || !input.text?.trim() || input.text.length > 32_768)) return;
    if (action === "sessions.approve") {
      const block = activeRead?.blocks.find((entry) => entry.id === input.blockId);
      if (!block?.approval || block.approval.decided || input.decision === undefined || (input.decision === "allow" && block.truncated)) return;
    }
    if (action === "sessions.stop" && !selected?.busy) return;
    actingRef.current = true;
    if (action !== "sessions.question.keepOpen") setActing(true);
    setError(undefined);
    try {
      await client.mutate(action, input);
      pendingRef.current = undefined;
      setPendingMutation(undefined);
      if (action === "sessions.send") setComposer("");
      if (action === "sessions.create") await openCreatedSession(input.sessionId);
      else {
        await refresh();
        const currentId = selectedIdRef.current;
        if (currentId) await refreshTranscript(currentId);
      }
      return true;
    } catch (reason) {
      const err = reason instanceof CompanionRequestError ? reason : new CompanionRequestError(String(reason), true);
      if (err.uncertain) {
        const nextPending = client.pendingMutations().find((entry) => entry.requestId === err.requestId);
        pendingRef.current = nextPending;
        setPendingMutation(nextPending);
      }
      setError(err.message);
      return err.message;
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function openCreatedSession(sessionId: string) {
    setWorkspaceView(undefined);
    // Finish any pre-create poll before fetching a list containing the new tab.
    await refreshInFlight.current;
    await refresh(sessionId);
    setSelectedMonoId(undefined);
    setSelectedId(sessionId);
    setRead(undefined);
    setMobileListOpen(false);
    setSearchOpen(false);
    setQuery("");
    await refreshTranscript(sessionId);
  }

  async function retryPending() {
    if (!pendingMutation || demo || actingRef.current || offlineRef.current) return;
    actingRef.current = true;
    setActing(true);
    try {
      await client.retry(pendingMutation);
      if (pendingMutation.action === "sessions.send") {
        const { sessionId, text } = pendingMutation.input;
        setDrafts(current => current[sessionId]?.trim() === text
          ? { ...current, [sessionId]: "" }
          : current);
      }
      pendingRef.current = undefined;
      setPendingMutation(undefined);
      setError(undefined);
      if (pendingMutation.action === "sessions.create") await openCreatedSession(pendingMutation.input.sessionId);
      else {
        await refresh();
        const currentId = selectedIdRef.current;
        if (currentId) await refreshTranscript(currentId);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Retry is still uncertain");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function refreshPendingConversation() {
    const sessionId = pendingMutation?.input.sessionId;
    if (!sessionId) return;
    if (pendingMutation.action === "sessions.create") {
      await refreshInFlight.current;
      await refresh();
      if (availableSessionIds.current.has(sessionId)) {
        setSelectedMonoId(undefined);
        setSelectedId(sessionId);
        setMobileListOpen(false);
        await refreshTranscript(sessionId);
      } else setMobileListOpen(true);
      setError("Check the project on your Mac before clearing this saved creation request, or retry the same request.");
      return;
    }
    setSelectedId(sessionId);
    setMobileListOpen(false);
    await refresh(sessionId);
    await refreshTranscript(sessionId);
    setError("The command remains pending. Reconcile it before sending another command.");
  }

  async function clearPendingAfterReview() {
    const pending = pendingRef.current;
    if (!pending || demo || actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    try {
      if (pending.action === "sessions.create") {
        await refreshInFlight.current;
        await refresh();
      } else {
        setSelectedId(pending.input.sessionId);
        setMobileListOpen(false);
        await refresh(pending.input.sessionId);
        await refreshTranscript(pending.input.sessionId);
      }
      if (offlineRef.current) throw new Error("Reconnect to the Mac before clearing this command");
      await client.dismissPending(pending.requestId);
      pendingRef.current = undefined;
      setPendingMutation(undefined);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not clear the pending command");
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  }

  async function forgetMac() {
    if (pendingRef.current || actingRef.current || forgetting) return;
    setForgetting(true);
    setForgetError(undefined);
    try {
      await onForget();
      setForgetOpen(false);
    } catch (reason) {
      setForgetError(reason instanceof Error ? reason.message : "Could not forget this Mac");
    } finally {
      setForgetting(false);
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !activeRead || !composer.trim() || mutationsDisabled) return;
    void action("sessions.send", { epoch: activeRead.epoch, sessionId: selected.id, turn: activeRead.session.turn, text: composer.trim() });
  };

  const detailMono = workspaceView?.kind === "mono" ? navigation?.monos.find(mono => mono.id === workspaceView.monoId) : !workspaceView && selectedMono && !selectedMono.canChat ? selectedMono : undefined;
  const workspaceProject = workspaceView?.kind === "changes" ? navigation?.projects.find(project => project.id === workspaceView.projectId) : undefined;
  const backToWorkspace = () => { setWorkspaceView(undefined); setMobileListOpen(true); };
  const linkedParent = linkedView && linkedView.session.id === selectedId && !workspaceView ? linkedView.parent : undefined;
  const openLinkedSession = (session: CompanionSession, scrollTop: number) => {
    if (!selectedMono || !activeRead || session.id === selectedId || actingRef.current) return;
    const next = { session, parent: { read: activeRead, monoId: selectedMono.id, name: selectedMono.name, scrollTop } };
    linkedViewRef.current = next;
    setLinkedView(next);
    setRestoredPosition(undefined);
    ++transcriptSerial.current;
    selectedIdRef.current = session.id;
    setSelectedMonoId(undefined);
    setSelectedId(session.id);
    setRead(undefined);
    setWorkspaceView(undefined);
    setMobileListOpen(false);
  };
  const backToConversation = () => {
    if (!linkedParent) { backToWorkspace(); return; }
    ++transcriptSerial.current;
    selectedIdRef.current = linkedParent.read.session.id;
    setSelectedId(linkedParent.read.session.id);
    setSelectedMonoId(linkedParent.monoId);
    setRead(linkedParent.read);
    setRestoredPosition({ sessionId: linkedParent.read.session.id, top: linkedParent.scrollTop });
    linkedViewRef.current = undefined;
    setLinkedView(undefined);
  };
  const swipeSurface = useEdgeSwipeBack(backToConversation, !mobileListOpen && !settingsOpen && workspaceView?.kind !== "inbox" && workspaceView?.kind !== "changes", detailMono?.id || selectedId);
  const recoveryBanner = pendingMutation ? <div className="recovery-banner" role="alert"><strong>Command status is uncertain.</strong><span>{pendingMutation.action.replace("sessions.", "")} may have reached the Mac.</span>{error ? <p className="recovery-banner__error">{error}</p> : null}<div><button className="button button--small button--primary" type="button" onClick={() => void retryPending()} disabled={acting || offline}>Retry same command</button><button className="button button--small button--quiet" type="button" onClick={() => void refreshPendingConversation()} disabled={acting}>{pendingMutation.action === "sessions.create" ? "Review project" : "Refresh conversation"}</button><button className="button button--small button--quiet" type="button" onClick={() => void clearPendingAfterReview()} disabled={acting || offline}>I checked — clear</button></div><small>{pendingMutation.action === "sessions.create" ? "A new session may already exist. Review this project on the Mac before clearing; retry uses the same session ID." : "We refresh the original session before removing this saved command. New commands stay blocked until then."}</small></div> : null;

  const connectionLabel = !displayOnline ? "This device is offline" : displayReconnecting ? "Reconnecting to your Mac" : displayOffline ? "Can’t reach your Mac" : "Connected to your Mac";
  const connectionDot = `status-dot ${displayReconnecting && displayOnline ? "status-dot--reconnecting" : displayOffline ? "status-dot--offline" : "status-dot--connected"}`;

  return (
    <main className={`companion-shell companion-shell--workspace ${displayedAppearance?.scheme === "light" ? "companion-shell--light" : ""}`} style={appearanceStyle}>
      <section ref={settingsSurface} hidden={!settingsOpen} className="workspace-settings" aria-labelledby="workspace-settings-title" onKeyDown={event => { if (event.key === "Escape") closeSettings(); }}>
        <div className="workspace-settings__surface">
          <header className="detail-heading"><button ref={settingsBack} className="back-button" type="button" aria-label="Back from settings" onClick={closeSettings}><ChevronLeft size={20} aria-hidden="true" /></button><h2 id="workspace-settings-title">Settings</h2></header>
          <div className="workspace-settings__body">
            <section className="workspace-settings__section" aria-label="Mac connection">
              <h3>Connection</h3>
              <div className="settings-connection"><span className={connectionDot} aria-hidden="true" /><div><strong role="status">{connectionLabel}</strong><p>{demo ? "Sample workspace · no live Mac connection" : status.hostId ? `Mac ${status.hostId.slice(0, 12)} · Private connection` : "Private connection"}</p></div></div>
              {displayOffline ? <ConnectionNotice online={displayOnline} reconnecting={displayReconnecting} lastSeen={lastSeen} error={demo ? undefined : connectionError} onReconnect={() => demo ? setPreviewConnection("connected") : void reconnect()} /> : <button className="button button--quiet settings-reconnect" type="button" onClick={() => demo ? setPreviewConnection("connected") : void reconnect()} disabled={reconnecting}>Reconnect</button>}
              {demo ? <SettingsChoices label="Connection preview" value={previewConnection} options={[["connected", "Connected"], ["reconnecting", "Reconnecting"], ["unreachable", "Mac unreachable"], ["offline", "Device offline"]]} onChange={setPreviewConnection} /> : null}
            </section>
            {PHONE_NOTIFICATIONS_ENABLED ? <NotificationSettings notifications={notifications} demo={demo} /> : null}
            <section className="workspace-settings__section" aria-label="Appearance"><h3>Appearance</h3>
              <SettingsChoices label="Theme" value={appearanceMode} options={[["host", "Follow host"], ["light", "Light"], ["dark", "Dark"]]} onChange={changeAppearance} />
              <p className="settings-note">Follow host uses your Mac’s appearance. Light and Dark use a plain theme on this device. Text stays at 100%.</p>
              {demo ? <><SettingsChoices label="Transcript layout" value={previewLayout} options={[["chat", "Chat"], ["full", "Document"]]} onChange={value => setPreviewLayout(value as "chat" | "full")} /><button className="button button--quiet" type="button" onClick={onPreviewSetup}>Preview connection setup</button></> : null}
            </section>
            {!demo ? <section className="workspace-settings__section" aria-label="Pairing">
              {forgetOpen ? <div className="settings-forget"><strong>Forget this paired Mac?</strong><p>This only removes the phone’s saved pairing. You’ll need a new ticket to connect again.</p>{forgetError ? <p className="error-copy" role="alert">{forgetError}</p> : null}<div><button className="button button--quiet" type="button" onClick={() => setForgetOpen(false)} disabled={forgetting}>Keep pairing</button><button className="button button--danger" type="button" onClick={() => void forgetMac()} disabled={!!pendingMutation || acting || forgetting}>{forgetting ? "Forgetting…" : "Forget Mac"}</button></div></div> : <button className="button button--danger" type="button" onClick={() => setForgetOpen(true)} disabled={!!pendingMutation || acting || forgetting}>Forget this Mac…</button>}
              {pendingMutation ? <p className="settings-note">Review the saved command before forgetting this Mac.</p> : null}
            </section> : null}
          </div>
        </div>
      </section>
      <div className="app-header" hidden={settingsOpen}>
        {pendingMutation?.action === "sessions.create" ? recoveryBanner : null}
      </div>
      <div className="workspace-grid" hidden={settingsOpen}>
        <aside className={`session-panel ${mobileListOpen ? "mobile-list-open" : ""}`} aria-label="Workspace">
          <div className="workspace-toolbar"><h1 className="workspace-title">MonoCode Mobile</h1><button ref={searchButton} className="search-toggle" type="button" aria-label={searchOpen ? "Close workspace search" : "Search workspace"} aria-expanded={searchOpen} onClick={() => { setSearchOpen(open => !open); if (searchOpen) { setQuery("");  } }}>{searchOpen ? <X size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}</button><button ref={settingsButton} className="settings-toggle" type="button" aria-label="Settings" aria-describedby="companion-connection-status" aria-expanded={settingsOpen} aria-controls="workspace-settings-title" onClick={() => setSettingsOpen(true)}><Settings size={19} aria-hidden="true" /><span id="companion-connection-status" className="connection-indicator" role="status" aria-label={connectionLabel} title={connectionLabel}><span className={connectionDot} aria-hidden="true" /></span></button></div>
          {searchOpen ? <div className="session-search" onKeyDown={event => { if (event.key === "Escape") { setSearchOpen(false); setQuery("");  searchButton.current?.focus(); } }}><input type="search" aria-label="Search workspace" placeholder="Search workspace" autoFocus value={query} onChange={event => { setQuery(event.target.value); if (event.target.value.trim()) setMonosExpanded(true); }} /></div> : null}
          {error && !pendingMutation && !displayOffline ? <p className="inline-error" role="alert">{error}</p> : null}
          <div className="workspace-scroll">
            {workspaceCapabilities.inbox ? <button className="inbox-navigation-button" type="button" onClick={() => { setWorkspaceView({ kind: "inbox" }); setMobileListOpen(false); }}><Inbox size={18} aria-hidden="true" /><strong>Inbox</strong><ChevronRight size={16} aria-hidden="true" /></button> : null}
            <div className="workspace-heading"><h2>{navigation ? <button className="monos-toggle" type="button" aria-expanded={monosExpanded} aria-controls="companion-monos" onClick={() => setMonosExpanded(expanded => !expanded)}><ChevronRight className="nav-chevron" data-expanded={monosExpanded} size={12} aria-hidden="true" /><span>Monos</span><span className="nav-count">{navigation.monos.length}</span></button> : "Projects"}</h2></div>
            {loading && !sessions.length && !navigation && !displayOffline ? <p className="nav-note" role="status">Loading workspace…</p> : null}<Navigation unreadSessionIds={unreadSessionIds} monosExpanded={monosExpanded} onMonoDetails={id => { setWorkspaceView({ kind: "mono", monoId: id }); setMobileListOpen(false); }} onChanges={workspaceCapabilities.changes ? project => { setWorkspaceView({ kind: "changes", projectId: project.id }); setMobileListOpen(false); } : undefined} onCreate={creationEpoch ? project => { void action("sessions.create", { epoch: creationEpoch, projectId: project.id, sessionId: crypto.randomUUID() }); } : undefined} createDisabled={mutationsDisabled} sessions={sessions} navigation={navigation} query={query} filter="all" selectedId={selectedId} selectedMonoId={selectedMonoId} onSession={id => { setWorkspaceView(undefined); setSelectedMonoId(undefined); if (id !== selectedId) setRead(undefined); setSelectedId(id); setMobileListOpen(false); }} onMono={id => { setWorkspaceView(undefined); const mono = navigation?.monos.find(entry => entry.id === id); setSelectedMonoId(id); if (mono?.sessionId) { if (mono.sessionId !== selectedId) setRead(undefined); setSelectedId(mono.sessionId); } setMobileListOpen(false); }} />
          {!navigation && !sessions.length && !loading ? <div className="empty-panel">{displayOffline ? "Reconnect to see your workspace." : "No available sessions on this Mac."}</div> : null}
          </div>
        </aside>
        <section ref={swipeSurface} className={`session-detail ${mobileListOpen ? "" : "mobile-detail-open"}`} aria-label="Selected session">
          {appearanceMode === "host" && activeRead && !workspaceView ? <ChatBackground background={activeRead.chatBackground} empty={activeRead.totalBlocks === 0} /> : null}
          {detailMono ? <MonoDetailsView key={detailMono.id} client={client} mono={detailMono} projects={navigation?.projects || []} onBack={backToWorkspace} /> : workspaceView?.kind === "inbox" ? <InboxView client={client} projects={navigation?.projects || []} onBack={backToWorkspace} /> : workspaceView?.kind === "changes" ? workspaceProject ? <ChangesView key={workspaceView.projectId} client={client} project={workspaceProject} sessions={sessions.filter(session => session.projectId === workspaceProject.id)} disabled={displayOffline} onBack={backToWorkspace} /> : <div className="empty-panel"><p>This project is no longer available.</p><button className="button button--quiet" onClick={backToWorkspace}>Back to workspace</button></div> : selected ? <>
            <header className="detail-heading">
              <button className={`back-button ${linkedParent ? "back-button--linked" : ""}`} type="button" aria-label={linkedParent ? `Back to ${linkedParent.name}` : "Back to workspace"} title={linkedParent ? `Back to ${linkedParent.name}` : "Back to workspace"} onClick={backToConversation}><ChevronLeft size={20} aria-hidden="true" /></button>
              {selectedMono ? <MonoMascot mono={selectedMono} /> : null}
              <h2 className="conversation-title" title={selectedMono?.name || selected.title || "Untitled session"}>{selectedMono?.name || selected.title || "Untitled session"}</h2>
            </header>
            {displayOffline ? <div className="chat-connection" role="status"><span className={connectionDot} aria-hidden="true" /><span>{!displayOnline ? "Offline" : displayReconnecting ? "Reconnecting…" : "Mac unavailable"}</span>{displayOnline && !displayReconnecting ? <button type="button" onClick={() => demo ? setPreviewConnection("connected") : void reconnect()}>Retry</button> : null}</div> : null}
            {pendingMutation?.action !== "sessions.create" ? recoveryBanner : null}
            {error && !pendingMutation && !displayOffline ? <p className="inline-error" role="alert">{error}</p> : null}
            <Transcript busy={selected.busy} needsApproval={selected.needsApproval} key={selected.id} mono={!!selectedMono} layout={displayedAppearance?.transcriptLayout} blocks={activeRead?.blocks || []} loading={!activeRead} onLoadEarlier={activeRead?.nextBefore != null ? () => void loadEarlier() : undefined} loadingEarlier={loadingEarlier} historyError={historyError} approvalBusy={acting} mutationsDisabled={mutationsDisabled}
              onOpenSession={selectedMono && activeRead ? openLinkedSession : undefined}
              initialScrollTop={restoredPosition?.sessionId === selected.id ? restoredPosition.top : undefined}
              pendingQuestion={activeRead?.pendingQuestion} questionUnavailable={activeRead?.questionUnavailable}
              questionKey={`${activeRead?.epoch}:${activeRead?.session.turn}`}
              changes={activeRead?.reviewAvailable ? <SessionChanges key={selected.id} client={client} sessionId={selected.id} epoch={activeRead.epoch} turn={activeRead.session.turn} busy={selected.busy} offline={displayOffline} /> : undefined}
              onQuestionInteraction={async questionId => { if (activeRead) return action("sessions.question.keepOpen", { epoch: activeRead.epoch, sessionId: selected.id, turn: activeRead.session.turn, questionId }); }}
              onAnswer={(questionId, reply) => { if (activeRead) void action("sessions.answer", { epoch: activeRead.epoch, sessionId: selected.id, turn: activeRead.session.turn, questionId, reply }); }}
              onApprove={(block, decision) => { if (block.approval && activeRead) void action("sessions.approve", { epoch: activeRead.epoch, sessionId: selected.id, turn: activeRead.session.turn, blockId: block.id, decision }); }} />
            <form className="composer" onSubmit={submit}><div className="composer-input"><div className="composer-field"><textarea value={composer} onChange={(event) => setComposer(event.target.value)} placeholder={selected.busy ? "Draft a follow-up…" : selectedMono ? `Message ${selectedMono.name}…` : "Message…"} rows={1} disabled={acting} maxLength={32768} aria-label="Message this session" onKeyDown={(event) => { if (!isIosDevice() && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(event); } }} /><div className="composer-measure" aria-hidden="true">{composer + " "}</div></div>{selected.busy ? <button className="send-button send-button--stop" type="button" aria-label="Stop agent" title="Stop agent" disabled={mutationsDisabled || !activeRead} onClick={() => { if (activeRead) void action("sessions.stop", { epoch: activeRead.epoch, sessionId: selected.id, turn: activeRead.session.turn }); }}><span className="stop-icon" aria-hidden="true" /></button> : <button className="send-button" type="submit" disabled={!canSend} aria-label="Send message"><ArrowUp size={18} aria-hidden="true" /></button>}</div><SessionSettings key={selected.id} session={selected} configuration={activeRead?.configuration} disabled={mutationsDisabled || !activeRead} onApply={async change => { if (!activeRead) throw new Error("Refresh this conversation before changing settings."); const result = await action("sessions.configure", { epoch: activeRead.epoch, sessionId: selected.id, turn: activeRead.session.turn, ...change }); if (result !== true) throw new Error(typeof result === "string" ? result : "Wait for the connection or current command before changing settings."); }} /></form>
          </> : <div className="empty-detail"><div className="empty-detail__glyph">◒</div><h2>{displayOffline ? "Waiting for your Mac" : loading ? "Loading workspace" : "Select a session or Mono"}</h2><p>{displayOffline ? "Your workspace will refresh when the connection returns." : loading ? "Checking the workspace on your Mac." : "Choose a session to continue working, or a Mono to see its projects."}</p></div>}
        </section>
      </div>
    </main>
  );
}

export default function CompanionApp() {
  const demo = isDemo();
  const [client] = useState(() => demo ? demoClient() : createCompanionClient());
  const [status, setStatus] = useState<CompanionStatus>();
  const [startupError, setStartupError] = useState<string>();
  const [checking, setChecking] = useState(true);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [previewSetup, setPreviewSetup] = useState(false);

  useEffect(() => {
    let live = true;
    setChecking(true);
    setStartupError(undefined);
    void client.status().then((next) => { if (live) setStatus(next); }).catch((reason) => { if (live) { setStartupError(reason instanceof Error ? reason.message : "Could not open the companion connection"); setStatus(demo ? DEMO_STATUS : { paired: false }); } }).finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [client, demo, startupAttempt]);

  if (checking) return <main className="companion-shell companion-shell--loading" role="status"><img className="brand-icon" src={appMark} alt="" /><span>Opening MonoCode Mobile…</span></main>;
  if (startupError) return <main className="companion-shell companion-shell--pair"><div className="pair-brand"><img className="brand-icon" src={appMark} alt="" /><span>MonoCode Mobile</span></div><h1>Let’s try that again.</h1><p className="pair-copy">We couldn’t read your saved connection.</p><p className="error-copy" role="alert">{startupError}</p><button className="button button--primary" type="button" onClick={() => setStartupAttempt(attempt => attempt + 1)}>Try again</button></main>;
  if (!status?.paired || previewSetup) return <PairScreen client={client} onPaired={next => { setStatus(next); setPreviewSetup(false); }} />;
  return <Workspace client={client} status={status} onPreviewSetup={demo ? () => setPreviewSetup(true) : undefined} onForget={async () => { await client.forget(); setStatus({ paired: false }); }} />;
}
