// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import type { PendingMutation, SessionRead } from "./types";

const fake = vi.hoisted(() => {
  const regular = { id: "session", title: "Project work", cwd: "/app", harness: "claude", model: "opus", runtimeMode: "supervised", busy: false, needsApproval: false, turn: 0 };
  const mono = { ...regular, id: "mono-session", title: "Scout" };
  const configuration = { models: [{ harness: "claude", id: "opus", label: "Opus" }], accessModes: [{ id: "supervised", label: "Supervised" }, { id: "autonomous", label: "Autonomous" }] };
  return {
    native: true,
    pair: vi.fn(async (_ticket: string) => ({ paired: true, hostId: "host" })),
    status: vi.fn(async () => ({ paired: true, hostId: "host" })),
    pendingMutations: vi.fn((): PendingMutation[] => []),
    retry: vi.fn(async (_pending: PendingMutation) => ({ accepted: true })),
    sessionsList: vi.fn(async () => ({ epoch: "e", sessions: [regular], truncated: false, navigation: { groups: [], projects: [{ id: "/app", path: "/app", name: "App" }], monos: [{ id: "scout", name: "Scout", mascot: "ghost", color: "#fff", projectIds: ["/app"], busy: false, needsApproval: false, sessionId: mono.id, canChat: true }] } })),
    sessionRead: vi.fn(async (id: string, _before?: number): Promise<SessionRead> => ({ epoch: "e", session: id === mono.id ? mono : regular, blocks: [], totalBlocks: 0, nextBefore: null, configuration })),
    currentEpoch: vi.fn(() => "e"),
    monoRead: vi.fn(async () => ({ epoch: "e", mono: { id: "scout", name: "Scout", mascot: "ghost", color: "#fff", projectIds: ["/app"], status: "idle", statusLabel: "Idle", canChat: true, busy: false, needsApproval: false }, scope: { projects: [{ id: "/app", name: "App" }] }, habits: { items: [], offset: 0, total: 0, truncated: false } })),
    inboxList: vi.fn(async () => ({ items: [], errors: [], truncated: false, epoch: "e" })),
    inboxRead: vi.fn(async (key: string) => ({ item: { key, title: "Inbox item", provider: "github", kind: "issue", reference: key, state: "open", url: "", projectId: "/app" }, body: "", truncated: false, epoch: "e" })),
    changesList: vi.fn(async (_target: { projectId: string; sessionId?: string }) => ({ branch: "main", head: "head", files: [], additions: 0, deletions: 0, revision: "rev", epoch: "e" })),
    mutate: vi.fn(async () => ({ accepted: true })),
    reconnect: vi.fn(async () => {}),
  };
});
vi.mock("./client", async importOriginal => ({ ...await importOriginal<typeof import("./client")>(), createCompanionClient: () => fake }));
vi.mock("./Transcript", () => ({ Transcript: ({ blocks, onLoadEarlier, loadingEarlier, onOpenSession, initialScrollTop, onApprove, mutationsDisabled, attentionToken }: Parameters<typeof import("./Transcript").Transcript>[0]) => createElement("div", { className: "test-transcript", "data-scroll-top": initialScrollTop, "data-attention": attentionToken }, blocks.map(block => createElement("div", { key: block.id },
  createElement("p", null, block.text),
  block.spawnedSessions?.map(session => createElement("button", { key: session.id, className: "spawned-session", onClick: () => onOpenSession?.(session, 123) }, session.title)),
  block.approval && !block.approval.decided ? createElement("button", { className: "test-allow", disabled: mutationsDisabled, onClick: () => onApprove(block, "allow") }, "Allow") : null,
)), onLoadEarlier ? createElement("button", { onClick: onLoadEarlier, disabled: loadingEarlier }, "Load earlier messages") : null) }));
import CompanionApp from "./CompanionApp";
import { CompanionRequestError } from "./client";

const defaultList = fake.sessionsList.getMockImplementation()!;
const defaultRead = fake.sessionRead.getMockImplementation()!;
const defaultInboxList = fake.inboxList.getMockImplementation()!;
const defaultInboxRead = fake.inboxRead.getMockImplementation()!;
const defaultChangesList = fake.changesList.getMockImplementation()!;
const defaultMonoRead = fake.monoRead.getMockImplementation()!;
function swipeBack(element: Element) {
  for (const [type, x] of [["touchstart", 8], ["touchmove", 130], ["touchend", 150]] as const) {
    const point = { identifier: 1, clientX: x, clientY: 200 };
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : [point] }, changedTouches: { value: [point] } });
    element.dispatchEvent(event);
  }
}
beforeEach(() => {
  localStorage.removeItem("companion.appearance.v1");
  localStorage.removeItem("companion.preview.appearance.v1");
  fake.pair.mockReset().mockResolvedValue({ paired: true, hostId: "host" });
  fake.sessionsList.mockImplementation(defaultList);
  fake.sessionRead.mockImplementation(defaultRead);
  fake.inboxList.mockImplementation(defaultInboxList);
  fake.inboxRead.mockImplementation(defaultInboxRead);
  fake.changesList.mockImplementation(defaultChangesList);
  fake.monoRead.mockImplementation(defaultMonoRead);
  fake.currentEpoch.mockReturnValue("e");
  fake.status.mockResolvedValue({ paired: true, hostId: "host" });
  fake.mutate.mockReset().mockResolvedValue({ accepted: true });
  fake.pendingMutations.mockReset().mockReturnValue([]);
  fake.retry.mockReset().mockResolvedValue({ accepted: true });
  fake.reconnect.mockReset().mockResolvedValue(undefined);
});

it("uses full controls for a linked session outside the list and restores the Mono draft on Back", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: query === "(max-width: 700px)", media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.useFakeTimers();
  const child = { ...await defaultRead("session"), session: { ...(await defaultRead("session")).session, id: "child", title: "Check access", busy: true, needsApproval: true, turn: 7 }, blocks: [{ id: "approve", role: "tool", text: "Run check", approval: { requestId: 9 } }], totalBlocks: 1 };
  const parent = { ...await defaultRead("mono-session"), blocks: [{ id: "launch", role: "assistant", text: "Started the check", spawnedSessions: [child.session] }], totalBlocks: 1 };
  fake.sessionRead.mockImplementation(async id => id === "child" ? structuredClone(child) : id === "mono-session" ? parent : defaultRead(id));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const enter = async (text: string) => act(async () => {
    const field = container.querySelector<HTMLTextAreaElement>(".composer textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    await act(async () => container.querySelector<HTMLButtonElement>(".mono-row")!.click());
    await enter("My Mono draft");
    await act(async () => container.querySelector<HTMLButtonElement>(".spawned-session")!.click());
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Check access");
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Check access");
    await act(async () => container.querySelector<HTMLButtonElement>(".test-allow")!.click());
    expect(fake.mutate).toHaveBeenLastCalledWith("sessions.approve", { epoch: "e", sessionId: "child", turn: 7, blockId: "approve", decision: "allow" });
    child.session.busy = false; child.session.needsApproval = false; child.blocks = [];
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Stop agent"]')!.click());
    expect(fake.mutate).toHaveBeenLastCalledWith("sessions.stop", { epoch: "e", sessionId: "child", turn: 7 });
    await enter("Continue this check");
    await act(async () => container.querySelector("form.composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(fake.mutate).toHaveBeenLastCalledWith("sessions.send", { epoch: "e", sessionId: "child", turn: 7, text: "Continue this check" });
    await enter("Child draft");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Back to Scout"]')!.click());
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Scout");
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")!.value).toBe("My Mono draft");
    expect(container.querySelector(".test-transcript")?.getAttribute("data-scroll-top")).toBe("123");
    await act(async () => container.querySelector<HTMLButtonElement>(".spawned-session")!.click());
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")!.value).toBe("Child draft");
    await act(async () => swipeBack(container.querySelector(".session-detail")!));
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Scout");
  } finally { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it("opens an idle Mono's header Sessions button, follows a linked child, and restores the Mono draft", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: query === "(max-width: 700px)", media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const child = { ...await defaultRead("session"), session: { ...(await defaultRead("session")).session, id: "header-child", title: "Working review", busy: true, needsApproval: false, turn: 3 }, blocks: [{ id: "child-reply", role: "assistant", text: "Reviewing now." }], totalBlocks: 1 };
  fake.sessionRead.mockImplementation(async id => id === "header-child" ? structuredClone(child) : defaultRead(id));
  fake.monoRead.mockImplementation(async (_monoId: string, section?: string) => section === "sessions"
    ? {
        epoch: "e",
        mono: { id: "scout", name: "Scout", mascot: "ghost", color: "#fff", projectIds: ["/app"], status: "idle" as const, statusLabel: "Idle", canChat: true, busy: false, needsApproval: false },
        scope: { projects: [{ id: "/app", name: "App" }] },
        sessions: { offset: 0, total: 3, truncated: false, items: [
          { id: "header-child", title: "Working review", state: "working" as const, statusLabel: "Working" },
          { id: "waiting-child", title: "Choose scope", state: "input" as const, statusLabel: "Needs input" },
          { id: "done-child", title: "Finished notes", state: "done" as const, statusLabel: "Done" },
        ] },
      }
    : defaultMonoRead(_monoId, section as never));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const enter = async (text: string) => act(async () => {
    const field = container.querySelector<HTMLTextAreaElement>(".composer textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    await act(async () => container.querySelector<HTMLButtonElement>(".mono-row")!.click());
    await enter("Keep this Mono draft");
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Sessions for Scout"]')!;
    expect(trigger.disabled).toBe(false);
    await act(async () => trigger.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Working review");
    const rows = [...container.querySelectorAll<HTMLButtonElement>(".mono-linked-sessions__body li > button")];
    expect(rows.map(row => row.textContent)).toEqual(expect.arrayContaining(["Working reviewWorking", "Choose scopeNeeds input", "Finished notesDone"]));
    await act(async () => rows[0].click());
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Working review");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Back to Scout"]')!.click());
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Scout");
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")!.value).toBe("Keep this Mono draft");
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it("ignores a late linked-session read after returning to the Mono", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const child = { ...await defaultRead("session"), session: { ...(await defaultRead("session")).session, id: "child", title: "Check access" } };
  let resolve!: (read: SessionRead) => void;
  const pending = new Promise<SessionRead>(done => { resolve = done; });
  fake.sessionRead.mockImplementation(async id => id === "child" ? pending : id === "mono-session" ? { ...await defaultRead(id), blocks: [{ id: "launch", role: "assistant", text: "Started", spawnedSessions: [child.session] }], totalBlocks: 1 } : defaultRead(id));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    await act(async () => container.querySelector<HTMLButtonElement>(".mono-row")!.click());
    await act(async () => container.querySelector<HTMLButtonElement>(".spawned-session")!.click());
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Back to Scout"]')!.click());
    await act(async () => resolve(child));
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Scout");
    expect(container.querySelector(".test-transcript")?.textContent).toContain("Started");
    expect(fake.mutate).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it.each([false, true])("reconciles a retried send without deleting a follow-up draft (follow-up: %s)", async followUp => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.useFakeTimers();
  const pending: PendingMutation = { requestId: "retry-send", action: "sessions.send", input: { epoch: "e", sessionId: "session", turn: 0, text: "Original message" }, error: "Receipt timed out" };
  fake.mutate.mockImplementationOnce(async () => {
    fake.pendingMutations.mockReturnValue([pending]);
    throw new CompanionRequestError("Control request timed out. Retry with the same request ID.", true, pending.requestId);
  });
  fake.retry.mockImplementationOnce(async () => {
    fake.pendingMutations.mockReturnValue([]);
    return { accepted: true };
  });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const enter = async (field: HTMLTextAreaElement, text: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    const field = container.querySelector<HTMLTextAreaElement>(".composer textarea")!;
    await enter(field, " Original message ");
    await act(async () => container.querySelector("form.composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.querySelector(".recovery-banner")).not.toBeNull();
    if (followUp) await enter(field, "New follow-up");
    const retry = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Retry same command")!;
    await act(async () => retry.click());
    expect(fake.retry).toHaveBeenCalledWith(pending);
    expect(container.querySelector(".recovery-banner")).toBeNull();
    expect(field.value).toBe(followUp ? "New follow-up" : "");
    expect(fake.mutate).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("restores an unconfirmed send's text after relaunch and retries its original receipt", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const pending: PendingMutation = { requestId: "saved", action: "sessions.send", input: { epoch: "e", sessionId: "session", turn: 0, text: "Saved follow-up" }, error: "Unconfirmed" };
  fake.pendingMutations.mockReturnValue([pending]);
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")!.value).toBe("Saved follow-up");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.disabled).toBe(true);
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Retry same command")!.click());
    expect(fake.retry).toHaveBeenCalledExactlyOnceWith(pending);
    expect(fake.mutate).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it.each(["epoch", "turn"])("disables both actions for a stale %s and retains the draft", async field => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const base = await defaultList(); const read = await defaultRead("session");
  fake.sessionsList.mockResolvedValue({ ...base, sessions: [{ ...read.session, busy: true, turn: 2 }], capabilities: { queuedFollowUps: true } } as typeof base);
  fake.sessionRead.mockResolvedValue({ ...read, epoch: field === "epoch" ? "old" : "e", session: { ...read.session, busy: true, turn: field === "turn" ? 1 : 2 } });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    const textarea = container.querySelector<HTMLTextAreaElement>(".composer textarea")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Keep draft"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Stop agent"]')!.disabled).toBe(true);
    await act(async () => container.querySelector("form.composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(fake.mutate).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Keep draft");
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it("follows host appearance by default, persists local overrides, and restores the latest host theme", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.useFakeTimers();
  const base = await defaultList();
  const host = { version: 1 as const, scheme: "dark" as const, hue: 275, saturation: 24, backgroundLightness: 12, contentLightness: 92, accent: "#69b7ff", userAccent: "#b8a0e8" };
  fake.sessionsList.mockResolvedValue({ ...base, ...{ appearance: host } });
  fake.sessionRead.mockImplementation(async id => ({ ...await defaultRead(id), chatBackground: { image: "data:image/png;base64,YQ==", scope: "all", emptyOpacity: .3, sessionOpacity: .2, effect: "none" } }));
  const container = document.createElement("div");
  document.body.append(container);
  let root = createRoot(container);
  const choose = async (mode: string) => act(async () => container.querySelector<HTMLInputElement>('input[name="Theme"][value="' + mode + '"]')!.click());
  const style = () => container.querySelector<HTMLElement>("main")!.style;
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    expect(container.querySelector<HTMLInputElement>('input[value="host"]')!.checked).toBe(true);
    expect(style().getPropertyValue("--companion-bg")).toBe("hsl(275 24% 12%)");
    expect(container.querySelector(".companion-chat-background")).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
    await choose("light");
    expect(style().colorScheme).toBe("light");
    expect(style().getPropertyValue("--companion-send-bg")).toBe("");
    expect(container.querySelector(".companion-chat-background")).toBeNull();
    expect(localStorage.getItem("companion.appearance.v1")).toBe("light");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(CompanionApp)));
    expect(style().colorScheme).toBe("light");
    fake.sessionsList.mockResolvedValue({ ...base, ...{ appearance: { ...host, hue: 180 } } });
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(style().getPropertyValue("--companion-bg")).toBe("hsl(240 0% 97%)");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
    await choose("host");
    expect(style().getPropertyValue("--companion-bg")).toBe("hsl(180 24% 12%)");
    expect(container.querySelector(".companion-chat-background")).not.toBeNull();
    expect(fake.mutate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("guides first-time pairing, retains failed tickets, and opens the workspace after success", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.status.mockResolvedValue({ paired: false, hostId: "" });
  fake.pair.mockRejectedValueOnce(new Error("Ticket expired. Generate a new QR code."));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    expect(container.querySelectorAll(".pair-steps li")).toHaveLength(3);
    expect(container.textContent).toContain("Settings → Connections");
    expect(container.textContent).toContain("Show QR code");
    const field = container.querySelector<HTMLTextAreaElement>("#pair-ticket")!;
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "  sample-ticket  ");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(fake.pair).toHaveBeenCalledWith("sample-ticket");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Ticket expired");
    expect(field.value).toBe("  sample-ticket  ");
    await act(async () => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.querySelector(".pair-form")).toBeNull();
    expect(container.querySelector(".workspace-title")?.textContent).toBe("MonoCode Mobile");
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it("retries a startup failure without treating a saved connection as unpaired", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.status.mockRejectedValueOnce(new Error("Saved connection unavailable"));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    expect(container.querySelector(".pair-form")).toBeNull();
    expect(container.textContent).toContain("We couldn’t read your saved connection.");
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector(".workspace-title")).not.toBeNull();
    expect(fake.pair).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it("queues a busy follow-up with Send and Stop together, blocks rapid duplicates and preserves another session's draft", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const base = await defaultList(); const read = await defaultRead("session");
  const session = { ...read.session, busy: true, needsApproval: true, turn: 7 };
  fake.sessionsList.mockResolvedValue({ ...base, sessions: [session], capabilities: { queuedFollowUps: true } } as typeof base);
  fake.sessionRead.mockImplementation(async id => id === "session" ? { ...read, session } : defaultRead(id));
  let acknowledge!: (value: { accepted: boolean; delivery: "queued" }) => void;
  fake.mutate.mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const enter = async (text: string) => act(async () => {
    const field = container.querySelector<HTMLTextAreaElement>(".composer textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    await act(async () => container.querySelector<HTMLButtonElement>(".mono-row")!.click());
    await enter("Other draft");
    await act(async () => container.querySelector<HTMLButtonElement>(".session-row")!.click());
    await enter("Follow up without stopping");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Stop agent"]')!.disabled).toBe(false);
    await act(async () => {
      const form = container.querySelector("form.composer")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(fake.mutate).toHaveBeenCalledExactlyOnceWith("sessions.send", { epoch: "e", sessionId: "session", turn: 7, text: "Follow up without stopping" });
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")!.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>(".mono-row")!.click());
    await act(async () => acknowledge({ accepted: true, delivery: "queued" }));
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")!.value).toBe("Other draft");
    await act(async () => container.querySelector<HTMLButtonElement>(".session-row")!.click());
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")!.value).toBe("");
    expect(container.querySelector(".send-receipt")?.textContent).toBe("Follow-up queued on Mac");
    await enter("Keep on failure");
    fake.mutate.mockRejectedValueOnce(new CompanionRequestError("The session turn changed; refresh before acting", false));
    await act(async () => container.querySelector("form.composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")!.value).toBe("Keep on failure");
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it("opens a waiting session from home and makes the next waiting session reachable after resolution", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const base = await defaultList(); const read = await defaultRead("session");
  const session = { ...read.session, busy: true, needsApproval: true };
  const monos = base.navigation.monos.map(mono => ({ ...mono, needsApproval: true }));
  fake.sessionsList.mockImplementation(async () => ({ ...base, sessions: [{ ...session }], navigation: { ...base.navigation, monos } }));
  fake.sessionRead.mockImplementation(async id => id === "session" ? { ...read, session: { ...session }, blocks: session.needsApproval ? [{ id: "pending", role: "tool", text: "Review", approval: { requestId: 1 } }] : [] } : defaultRead(id));
  fake.mutate.mockImplementation(async () => { session.needsApproval = false; return { accepted: true }; });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    const chooser = container.querySelector(".needs-you-chooser")!;
    await act(async () => [...chooser.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Project work"))!.click());
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Project work");
    expect(container.querySelector(".test-transcript")?.getAttribute("data-attention")).toBe("1");
    expect(fake.mutate).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>(".test-allow")!.click());
    const next = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Next waiting session")!;
    expect(next).toBeDefined();
    await act(async () => next.click());
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Scout");
    expect(fake.mutate).toHaveBeenCalledTimes(1);
    await act(async () => container.querySelector<HTMLButtonElement>(".session-row")!.click());
    expect(container.querySelector(".test-transcript")?.hasAttribute("data-attention")).toBe(false);
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it.each([false, true])("keeps Stop in the busy composer and acknowledges only success (failure=%s)", async failure => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.useFakeTimers();
  const base = await defaultList();
  const read = await defaultRead("session");
  const session = { ...read.session, busy: true, needsApproval: true, turn: 7 };
  fake.sessionsList.mockResolvedValue({ ...base, sessions: [session] });
  fake.sessionRead.mockResolvedValue({ ...read, session });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    expect(container.querySelector(".run-controls")).toBeNull();
    expect(container.querySelector(".composer-hint")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')?.disabled).toBe(true);
    if (failure) fake.mutate.mockRejectedValueOnce(new CompanionRequestError("Stop refused", false));
    await act(async () => container.querySelector<HTMLButtonElement>('.composer [aria-label="Stop agent"]')!.click());
    expect(fake.mutate).toHaveBeenCalledWith("sessions.stop", { epoch: "e", sessionId: "session", turn: 7 });
    expect(container.querySelector(".send-receipt")?.textContent).toBe(failure ? "" : "Stop accepted by Mac");
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("keeps Inbox and projects visible when a large Mono roster is collapsed, and reveals search matches", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.useFakeTimers();
  const base = await defaultList();
  fake.sessionsList.mockResolvedValue({ ...base, navigation: { ...base.navigation, monos: Array.from({ length: 30 }, (_, index) => ({ ...base.navigation.monos[0], id: `mono-${index}`, name: `Scout ${index}` })) }, capabilities: { createSession: true, inbox: true, changes: true } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector(".inbox-navigation-button")?.textContent).toContain("Inbox");
    expect(container.querySelector('[aria-label="Changes in App"]')).not.toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>('.monos-toggle')!;
    expect(toggle.textContent).toBe('Monos30');
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector<HTMLElement>('#companion-monos')?.hidden).toBe(true);
    expect(container.querySelector('.session-row')?.textContent).toContain('Project work');
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(container.querySelector<HTMLElement>('#companion-monos')?.hidden).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('.search-toggle')!.click());
    const search = container.querySelector<HTMLInputElement>('.session-search input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Scout 29');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector<HTMLElement>('#companion-monos')?.hidden).toBe(false);
    expect(container.querySelectorAll('.mono-row')).toHaveLength(1);
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("opens an Inbox item for read-only review", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  vi.useFakeTimers();
  const base = await defaultList();
  const item = { key: "github:acme/app:issue:7", title: "Fix login", provider: "github" as const, kind: "issue" as const, reference: "acme/app#7", state: "open", url: "", projectId: "/app" };
  fake.sessionsList.mockResolvedValue({ ...base, capabilities: { createSession: true, inbox: true, changes: true } });
  fake.inboxList.mockResolvedValue({ items: [item], errors: [], truncated: false, epoch: "e" });
  fake.inboxRead.mockResolvedValue({ item, body: "Please fix the login flow.", truncated: false, epoch: "e" });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    await act(async () => { await Promise.resolve(); });
    await act(async () => container.querySelector<HTMLButtonElement>(".inbox-navigation-button")!.click());
    await act(async () => { await Promise.resolve(); });
    await act(async () => container.querySelector<HTMLButtonElement>(".inbox-row")!.click());
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector(".inbox-detail__summary h1")?.textContent).toBe("Fix login");
    expect(container.textContent).toContain("Please fix the login flow.");
    expect(container.querySelector(".inbox-start")).toBeNull();
    await act(async () => swipeBack(container.querySelector(".inbox-detail")!));
    expect(container.querySelector(".inbox-row")).not.toBeNull();
    expect(container.querySelector(".mobile-list-open")).toBeNull();
    await act(async () => swipeBack(container.querySelector(".inbox-list")!));
    expect(container.querySelector(".mobile-list-open")).not.toBeNull();
    expect(container.querySelector(".inbox-view")).toBeNull();
    expect(fake.mutate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("opens project-only Changes and returns to a regular session", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  vi.useFakeTimers();
  const base = await defaultList();
  fake.sessionsList.mockResolvedValue({ ...base, capabilities: { createSession: true, inbox: true, changes: true } });
  fake.changesList.mockResolvedValue({ branch: "main", head: "head", files: [], additions: 0, deletions: 0, revision: "rev", epoch: "e" });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    await act(async () => { await Promise.resolve(); });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Changes in App"]')!.click());
    await act(async () => { await Promise.resolve(); });
    expect(fake.changesList).toHaveBeenCalledWith({ projectId: "/app" });
    expect(container.querySelector(".changes-toolbar strong")?.textContent).toBe("App");
    await act(async () => swipeBack(container.querySelector(".changes-view")!));
    expect(container.querySelector(".mobile-list-open")).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".session-row")!.click());
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Project work");
    const field = container.querySelector<HTMLTextAreaElement>(".composer textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Unsent draft");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => swipeBack(container.querySelector(".test-transcript")!));
    expect(container.querySelector(".mobile-list-open")).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".session-row")!.click());
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")!.value).toBe("Unsent draft");
    expect(fake.mutate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it.each(["reconnect", "poll"])("keeps the chosen chat and its draft when a delayed %s finishes", async recovery => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.useFakeTimers();
  const base = await defaultList();
  const other = { ...base.sessions[0], id: "other", title: "Other chat" };
  const list = { ...base, sessions: [...base.sessions, other] };
  fake.sessionsList.mockResolvedValue(list);
  fake.sessionRead.mockImplementation(async id => ({ ...await defaultRead(id), session: id === other.id ? other : base.sessions[0] }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const enter = async (text: string) => act(async () => {
    const field = container.querySelector<HTMLTextAreaElement>(".composer textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  let finishList!: (value: typeof list) => void;
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    await enter("First draft");
    fake.sessionsList.mockImplementationOnce(() => new Promise(resolve => { finishList = resolve; }));
    await act(async () => {
      if (recovery === "reconnect") window.dispatchEvent(new Event("online"));
      else await vi.advanceTimersByTimeAsync(4000);
    });
    expect(finishList).toBeTypeOf("function");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".session-row")].find(button => button.textContent?.includes("Other chat"))!.click());
    await enter("Second draft");
    await act(async () => finishList(list));
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Other chat");
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")?.value).toBe("Second draft");
    expect(fake.sessionRead).toHaveBeenLastCalledWith("other");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".session-row")].find(button => button.textContent?.includes("Project work"))!.click());
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")?.value).toBe("First draft");
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("shows project running and unread badges on Home and clears completion after opening the chat", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.useFakeTimers();
  const base = await defaultList();
  const running = { ...base.sessions[0], busy: true, turn: 1 };
  const done = { ...running, busy: false };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    expect(container.querySelector(".project-activity")).toBeNull();
    fake.sessionsList.mockResolvedValue({ ...base, sessions: [running] });
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(container.querySelector('.project-activity[aria-label="1 running"]')).not.toBeNull();
    expect(container.querySelector(".project-activity")?.textContent).toBe("");
    expect(container.querySelector(".project-toggle .nav-count")).toBeNull();
    expect(container.querySelector(".group-toggle .project-activity")).toBeNull();
    fake.sessionsList.mockResolvedValue({ ...base, sessions: [done] });
    fake.sessionRead.mockImplementation(async () => ({ ...await defaultRead(done.id), session: done }));
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(container.querySelector('.project-activity[aria-label="1 completed, unread"]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".session-row")!.click());
    expect(container.querySelector(".project-activity")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Back to workspace"]')!.click());
    expect(container.querySelector(".project-activity")).toBeNull();
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it.each([false, true])("keeps the conversation and draft visible through resume (read fails: %s)", async fails => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.useFakeTimers();
  const saved = { ...await defaultRead("session"), blocks: [{ id: "saved", role: "assistant" as const, text: "Last received reply" }], totalBlocks: 3, nextBefore: 2 };
  fake.sessionRead.mockResolvedValue(saved);
  let connected!: () => void;
  fake.reconnect.mockImplementationOnce(() => new Promise<void>(resolve => { connected = resolve; }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    await act(async () => container.querySelector<HTMLButtonElement>(".session-row")!.click());
    const message = container.querySelector(".test-transcript p");
    const field = container.querySelector<HTMLTextAreaElement>(".composer textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Draft\nwith another line");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!;
    let finishRead!: () => void;
    fake.sessionRead.mockImplementation(() => new Promise((resolve, reject) => { finishRead = () => fails ? reject(new Error("Mac unavailable")) : resolve({ ...saved, blocks: [{ ...saved.blocks[0], text: "Fresh reply" }] }); }));
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(container.querySelector(".test-transcript p")).toBe(message);
    expect(message?.textContent).toBe("Last received reply");
    expect(field.value).toBe("Draft\nwith another line");
    expect(container.querySelector(".chat-connection")?.textContent).toBe("Reconnecting…");
    expect(send.disabled).toBe(true);
    await act(async () => connected());
    // Listing the workspace is not enough to re-enable actions on the old transcript.
    expect(container.querySelector(".chat-connection")?.textContent).toBe("Reconnecting…");
    expect(send.disabled).toBe(true);
    await act(async () => finishRead());
    expect(container.querySelector(".test-transcript p")).toBe(message);
    expect(message?.textContent).toBe(fails ? "Last received reply" : "Fresh reply");
    expect(send.disabled).toBe(fails);
    expect(container.querySelector(".chat-connection")?.textContent ?? "").toBe(fails ? "Mac unavailableRetry" : "");
    expect(field.value).toBe("Draft\nwith another line");
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("keeps connection recovery in Settings, reports progress, and requires a separate forget confirmation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.useFakeTimers();
  let finishReconnect!: () => void;
  fake.reconnect.mockImplementationOnce(() => new Promise<void>(resolve => { finishReconnect = resolve; }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    const gear = container.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!;
    const dialog = container.querySelector<HTMLElement>(".workspace-settings")!;
    expect(gear.parentElement?.querySelector('[aria-label="Search workspace"]')).not.toBeNull();
    expect(container.querySelector(".workspace-connection button")).toBeNull();
    expect(gear.querySelector('.connection-indicator')?.getAttribute('aria-label')).toBe('Connected to your Mac');
    expect(container.querySelector('.workspace-connection')).toBeNull();
    expect(dialog.hidden).toBe(true);
    await act(async () => gear.click());
    expect(dialog.hidden).toBe(false);
    expect(container.querySelector<HTMLElement>(".workspace-grid")!.hidden).toBe(true);
    expect(dialog.querySelector('[aria-label="Notifications"]')).toBeNull();
    expect(dialog.querySelector('.workspace-settings__section')?.getAttribute('aria-label')).toBe('Mac connection');
    expect(dialog.querySelector('[aria-label="Back from settings"]')?.textContent).toBe('');
    const button = (text: string) => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(entry => entry.textContent === text)!;
    await act(async () => button("Reconnect").click());
    expect(fake.reconnect).toHaveBeenCalledTimes(1);
    expect(dialog.hidden).toBe(false);
    expect(button("Reconnecting…").disabled).toBe(true);
    expect(container.querySelector(".connection-indicator .status-dot--reconnecting")).not.toBeNull();
    expect(container.querySelector(".app-header .connection-notice")).toBeNull();
    await act(async () => finishReconnect());
    expect(container.querySelector(".connection-indicator")?.getAttribute("aria-label")).toBe("Connected to your Mac");
    await act(async () => button("Forget this Mac…").click());
    expect(dialog.textContent).toContain("Forget this paired Mac?");
    await act(async () => button("Keep pairing").click());
    expect(dialog.textContent).not.toContain("Forget this paired Mac?");
    await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Back from settings"]')!.click());
    expect(dialog.hidden).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(document.activeElement).toBe(gear);
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("uses direct preview choices and preserves them when Settings is reopened", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "?demo=1");
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    const gear = container.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!;
    await act(async () => gear.click());
    const dialog = container.querySelector<HTMLElement>(".workspace-settings")!;
    expect(dialog.querySelector("select")).toBeNull();
    expect(dialog.querySelector('input[name="Text size"]')).toBeNull();
    await act(async () => dialog.querySelector<HTMLInputElement>('input[name="Theme"][value="light"]')!.click());
    expect(container.querySelector(".companion-shell--light")).not.toBeNull();
    await act(async () => dialog.querySelector<HTMLInputElement>('input[value="unreachable"]')!.click());
    expect(dialog.hidden).toBe(false);
    expect(dialog.querySelector(".connection-notice")).not.toBeNull();
    expect(container.querySelector(".connection-indicator .status-dot--offline")).not.toBeNull();
    await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Back from settings"]')!.click());
    await act(async () => gear.click());
    expect(dialog.querySelector<HTMLInputElement>('input[name="Theme"][value="light"]')!.checked).toBe(true);
  } finally {
    await act(async () => root.unmount()); container.remove(); window.history.replaceState(null, "", "/"); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("fits the visible keyboard viewport without retaining the home-indicator inset", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const viewport = Object.assign(new EventTarget(), { height: 874, offsetTop: 0 });
  vi.stubGlobal("visualViewport", viewport);
  vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue({ height: 874 } as DOMRect);
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    const shell = container.querySelector<HTMLElement>(".companion-shell--workspace")!;
    expect(shell.style.getPropertyValue("--companion-bottom-inset")).toBe("env(safe-area-inset-bottom)");
    // WKWebView can shrink innerHeight too; the CSS page retains its full height.
    vi.stubGlobal("innerHeight", 480);
    viewport.height = 480;
    viewport.offsetTop = 24;
    await act(async () => { viewport.dispatchEvent(new Event("resize")); });
    expect(shell.style.getPropertyValue("--companion-viewport")).toBe("480px");
    expect(shell.style.getPropertyValue("--companion-viewport-top")).toBe("24px");
    expect(shell.style.getPropertyValue("--companion-bottom-inset")).toBe("0px");
    viewport.height = 874;
    viewport.offsetTop = 0;
    await act(async () => { viewport.dispatchEvent(new Event("resize")); });
    expect(shell.style.getPropertyValue("--companion-bottom-inset")).toBe("env(safe-area-inset-bottom)");
  } finally {
    await act(async () => root.unmount());
    container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("creates from a project with no sessions, blocks a double tap, and opens its blank composer", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.useFakeTimers();
  const originalList = fake.sessionsList.getMockImplementation()!;
  const originalRead = fake.sessionRead.getMockImplementation()!;
  const base = await originalList();
  const workspace = { ...base, sessions: [], capabilities: { createSession: true }, navigation: { ...base.navigation, monos: [] } };
  fake.sessionsList.mockResolvedValue(workspace);
  fake.mutate.mockClear();
  fake.mutate.mockImplementationOnce(async (_action?: string, input?: { sessionId: string; projectId: string }) => {
    const session = { ...base.sessions[0], id: input!.sessionId, projectId: input!.projectId, title: "New session" };
    fake.sessionsList.mockResolvedValue({ ...workspace, sessions: [session] } as typeof base);
    fake.sessionRead.mockResolvedValue({ ...(await originalRead("session")), session });
    return { accepted: true };
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    expect(container.querySelector(".composer textarea")).toBeNull();
    const create = container.querySelector<HTMLButtonElement>('[aria-label="New session in App"]')!;
    expect(create).not.toBeNull();
    await act(async () => { create.click(); create.click(); });
    expect(fake.mutate).toHaveBeenCalledTimes(1);
    expect(fake.mutate).toHaveBeenCalledWith("sessions.create", { epoch: "e", projectId: "/app", sessionId: expect.any(String) });
    expect(container.querySelector(".conversation-title")?.textContent).toBe("New session");
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")?.value).toBe("");
    expect(container.querySelector(".session-detail")?.classList.contains("mobile-detail-open")).toBe(true);
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    fake.sessionsList.mockImplementation(originalList); fake.sessionRead.mockImplementation(originalRead);
  }
});

it("keeps a Mono selected across list polls and retains a draft while changing its access", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(entry => entry.textContent?.includes(text))!;
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    expect(container.querySelector('input[type="search"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".search-toggle")!.click());
    expect(container.querySelector('input[type="search"]')).not.toBeNull();
    expect(container.querySelector('.session-search select')).toBeNull();
    await act(async () => button("Scout").click());
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Scout");
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(fake.sessionRead).toHaveBeenLastCalledWith("mono-session");
    expect(container.querySelector(".conversation-title")?.textContent).toBe("Scout");
    const field = container.querySelector<HTMLTextAreaElement>(".composer textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Keep this draft");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Supervised").click());
    await act(async () => button("Autonomous").click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Details for Scout"]')!.click());
    expect(container.querySelector(".mono-details")?.textContent).toContain("Project scope");
    expect(container.querySelector(".composer")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Back to workspace"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>(".mono-row")!.click());
    expect(container.querySelector<HTMLTextAreaElement>(".composer textarea")?.value).toBe("Keep this draft");
    expect(fake.mutate).toHaveBeenCalledWith("sessions.configure", { epoch: "e", sessionId: "mono-session", turn: 0, runtimeMode: "autonomous" });
    expect(field.value).toBe("Keep this draft");
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("retains loaded history through polls and keeps a rejected setting visible", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.useFakeTimers();
  const originalRead = fake.sessionRead.getMockImplementation()!;
  const snapshot = await originalRead("session");
  fake.sessionRead.mockImplementation(async (_id, before) => ({ ...snapshot, totalBlocks: 4, nextBefore: before === 2 ? null : 2, blocks: (before === 2 ? [1, 2] : [3, 4]).map(id => ({ id: String(id), role: "assistant", text: `Message ${id}` })) }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(entry => entry.textContent?.includes(text))!;
  try {
    await act(async () => root.render(createElement(CompanionApp)));
    await act(async () => button("Project work").click());
    await act(async () => button("Load earlier messages").click());
    expect(fake.sessionRead).toHaveBeenCalledWith("session", 2);
    expect(container.querySelector(".test-transcript")?.textContent).toBe("Message 1Message 2Message 3Message 4");
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(container.querySelector(".test-transcript")?.textContent).toBe("Message 1Message 2Message 3Message 4");
    fake.mutate.mockRejectedValueOnce(new Error("Session is busy; wait before changing settings"));
    await act(async () => button("Supervised").click());
    await act(async () => button("Autonomous").click());
    expect(container.querySelector('[aria-label="Change access"]')).not.toBeNull();
    expect(container.querySelector(".settings-picker__error")?.textContent).toContain("Session is busy");
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(container.querySelector(".inline-error")?.textContent).toContain("Session is busy");
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    fake.sessionRead.mockImplementation(originalRead);
  }
});
