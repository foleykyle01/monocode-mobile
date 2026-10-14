// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transcript } from "./Transcript";
import type { CompanionBlock } from "./types";

let container: HTMLDivElement;
let root: Root;
let height = 1000;
let observerUpdate: () => void;

beforeEach(() => {
  height = 1000;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { observerUpdate = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(blocks: CompanionBlock[], onApprove = vi.fn(), options: Partial<Parameters<typeof Transcript>[0]> = {}) {
  await act(async () => root.render(createElement(Transcript, {
    blocks, loading: false, onApprove, approvalBusy: false, mutationsDisabled: false,
    ...options,
  })));
}

describe("phone transcript controls", () => {
  it.each(["working", "input", "draft", "failed", "stopped", "done", "unknown"] as const)("uses the host's %s lifecycle in a stable icon slot", async lifecycle => {
    await render([{ id: "launch", role: "assistant", text: "Started", spawnedSessions: [{ id: "child", title: "Task", cwd: "/repo", harness: "codex", model: "model", busy: false, needsApproval: false, turn: 1, lifecycle }] }], vi.fn(), { onOpenSession: vi.fn() });
    expect(container.querySelector(".spawned-session__status")?.getAttribute("data-state")).toBe(lifecycle);
    expect(container.querySelectorAll(".spawned-session__status svg")).toHaveLength(1);
  });

  it("loads older pending actions and focuses them once without approving or pulling later reading", async () => {
    const load = vi.fn(); const approve = vi.fn();
    await render([{ id: "recent", role: "assistant", text: "Recent" }], approve, { needsApproval: true, attentionToken: 1, onLoadEarlier: load });
    expect(load).toHaveBeenCalledOnce();
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    const blocks: CompanionBlock[] = [{ id: "pending", role: "tool", text: "Allow?", approval: { requestId: 7 } }, { id: "recent", role: "assistant", text: "Recent" }];
    await render(blocks, approve, { needsApproval: true, attentionToken: 1 });
    expect(document.activeElement).toBe(container.querySelector("[data-pending-approval]"));
    expect(scroll).toHaveBeenCalledOnce();
    expect(approve).not.toHaveBeenCalled();
    await render([...blocks, { id: "later", role: "assistant", text: "Later" }], approve, { needsApproval: true, attentionToken: 1 });
    expect(scroll).toHaveBeenCalledOnce();
  });

  it("shows queued, paused and failed follow-ups as undelivered", async () => {
    await render([], vi.fn(), { queuedMessages: [{ id: "1", text: "Next", state: "queued" }, { id: "2", text: "Then", state: "paused" }, { id: "3", text: "Retry", state: "failed" }] });
    expect(container.querySelector(".queued-follow-ups")?.textContent).toContain("Queued on Mac");
    expect(container.querySelector(".queued-follow-ups")?.textContent).toContain("Queue paused");
    expect(container.querySelector(".queued-follow-ups")?.textContent).toContain("Delivery failed");
  });
  it("opens a linked live project session with its current status and reading position", async () => {
    const session = { id: "child", title: "Check access", cwd: "/work/Power Platform", harness: "claude", model: "opus", busy: true, turn: 4, needsApproval: true };
    const open = vi.fn();
    const block: CompanionBlock = { id: "launch", role: "tool", text: "Started session", spawnedSessions: [session] };
    await render([block], vi.fn(), { mono: true, onOpenSession: open });
    const viewport = container.querySelector<HTMLDivElement>(".transcript")!;
    viewport.scrollTop = 123;
    const card = container.querySelector<HTMLButtonElement>(".spawned-session")!;
    expect(card.textContent).toContain("Power Platform · Needs input");
    await act(async () => card.click());
    expect(open).toHaveBeenCalledExactlyOnceWith(session, 123);
    await render([{ ...block, spawnedSessions: [{ ...session, busy: false, needsApproval: false }] }], vi.fn(), { onOpenSession: open });
    expect(container.querySelector(".spawned-session")?.textContent).toContain("Status unknown");
  });

  it("restores the parent reading position once and preserves it through live updates", async () => {
    await render([], vi.fn(), { loading: true, initialScrollTop: 123 });
    await render([{ id: "parent", role: "assistant", text: "Mono response" }], vi.fn(), { initialScrollTop: 123 });
    const viewport = container.querySelector<HTMLDivElement>(".transcript")!;
    expect(viewport.scrollTop).toBe(123);
    await act(async () => { viewport.scrollTop = 200; viewport.dispatchEvent(new Event("scroll")); });
    height = 1400;
    await render([{ id: "parent", role: "assistant", text: "Mono response updated" }], vi.fn(), { initialScrollTop: 123 });
    expect(viewport.scrollTop).toBe(200);
  });

  it("answers desktop questions and waits for the keep-open request before submitting", async () => {
    let release!: () => void;
    const hold = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const answer = vi.fn();
    const pendingQuestion = { requestId: 7, autoResolveAt: Date.now() + 60_000, questions: [{ id: "section", prompt: "What kind of section?", multiSelect: false, allowCustom: true, options: [{ id: "tasks", label: "Tasks", description: "A task category" }] }] };
    await render([], vi.fn(), { busy: true, pendingQuestion, onAnswer: answer, onQuestionInteraction: hold });
    expect(container.querySelector("[data-transcript-working]")).toBeNull();
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Tasks"))!;
    await act(async () => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await act(async () => container.querySelector<HTMLFormElement>(".phone-question form")!.requestSubmit());
    expect(answer).not.toHaveBeenCalled();
    await act(async () => release());
    expect(answer).toHaveBeenCalledExactlyOnceWith(7, { kind: "answered", answers: { section: ["tasks"] } });
    expect(hold).toHaveBeenCalledTimes(1);
    await render([], vi.fn(), { pendingQuestion, onAnswer: answer, onQuestionInteraction: hold, mutationsDisabled: true });
    expect(container.querySelector<HTMLFieldSetElement>(".phone-question")!.disabled).toBe(true);
  });

  it("groups tools in a tree while preserving approvals as actionable cards", async () => {
    await render([
      { id: "read", role: "tool", text: "private tool output", activity: { label: "Read tasks.json", state: "accepted", kind: "read" } },
      { id: "list", role: "tool", text: "Taskboard output", activity: { label: "List Taskboard", state: "pending", kind: "list" } },
      { id: "approval", role: "tool", text: "Write tasks.json", approval: { requestId: 8 } },
    ]);
    expect(container.querySelectorAll(".activity-tree")).toHaveLength(1);
    expect(container.querySelectorAll(".activity-tree li")).toHaveLength(2);
    expect(container.querySelector(".activity-tree__heading")?.textContent).toContain("2 steps");
    expect(container.querySelectorAll(".approval-actions button")).toHaveLength(2);
    await act(async () => container.querySelector<HTMLButtonElement>(".activity-tree__heading")!.click());
    expect(container.querySelector(".activity-tree ol")).toBeNull();
  });

  it("keeps inspected activity open when its last step completes", async () => {
    const block: CompanionBlock = { id: "task", role: "tool", text: "Output", activity: { label: "Read file", state: "pending", kind: "read" } };
    await render([block]);
    expect(container.querySelector(".activity-tree__heading")?.getAttribute("aria-expanded")).toBe("true");
    await render([{ ...block, activity: { ...block.activity!, state: "accepted" } }]);
    expect(container.querySelector(".activity-tree__heading")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".activity-tree ol")).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".activity-tree__heading")!.click());
    await render([block]);
    expect(container.querySelector(".activity-tree ol")).toBeNull();
  });

  it("renders desktop-style Markdown replies without role-label chrome", async () => {
    await render([{ id: "md", role: "assistant", text: "## Next steps\n\n- **Review** the change\n- Run `npm test`" }]);
    expect(container.querySelector("h2")?.textContent).toBe("Next steps");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("Review");
    expect(container.querySelector("code")?.textContent).toBe("npm test");
    expect(container.querySelector(".message__meta")).toBeNull();
  });

  it("opens at latest, preserves reading position, and resumes following after jumping", async () => {
    await render([{ id: "1", role: "assistant", text: "First" }]);
    const viewport = container.querySelector<HTMLDivElement>(".transcript")!;
    expect(viewport.scrollTop).toBe(1000);
    await act(async () => { viewport.scrollTop = 100; viewport.dispatchEvent(new Event("scroll")); });
    height = 1200;
    await render([{ id: "1", role: "assistant", text: "First" }, { id: "2", role: "assistant", text: "New output" }]);
    expect(viewport.scrollTop).toBe(100);
    await act(async () => container.querySelector<HTMLButtonElement>(".jump-latest")!.click());
    expect(viewport.scrollTop).toBe(1200);
    height = 1300;
    await act(async () => observerUpdate());
    expect(viewport.scrollTop).toBe(1300);
  });

  it("sends the selected decision and permits only Deny for a shortened approval", async () => {
    const onApprove = vi.fn();
    const block: CompanionBlock = { id: "approval", role: "tool", text: "Write /tmp/test", approval: { requestId: 9 } };
    await render([block], onApprove);
    const buttons = () => [...container.querySelectorAll<HTMLButtonElement>(".approval-actions button")];
    await act(async () => buttons().find(button => button.textContent === "Deny")!.click());
    expect(onApprove).toHaveBeenLastCalledWith(block, "deny");
    await act(async () => buttons().find(button => button.textContent === "Allow")!.click());
    expect(onApprove).toHaveBeenLastCalledWith(block, "allow");
    await render([{ ...block, truncated: true }], onApprove);
    expect(buttons().find(button => button.textContent === "Allow")!.disabled).toBe(true);
    expect(buttons().find(button => button.textContent === "Deny")!.disabled).toBe(false);
  });

  it("keeps the reading anchor when earlier history is prepended", async () => {
    const loadEarlier = vi.fn();
    await render([{ id: "current", role: "assistant", text: "Current message" }], vi.fn(), { onLoadEarlier: loadEarlier });
    const viewport = container.querySelector<HTMLDivElement>(".transcript")!;
    await act(async () => { viewport.scrollTop = 100; viewport.dispatchEvent(new Event("scroll")); });
    await act(async () => container.querySelector<HTMLButtonElement>(".history-control__button")!.click());
    expect(loadEarlier).toHaveBeenCalledOnce();
    height = 1200;
    await render([
      { id: "earlier", role: "assistant", text: "Earlier message" },
      { id: "current", role: "assistant", text: "Current message" },
    ], vi.fn(), { onLoadEarlier: loadEarlier });
    expect(viewport.scrollTop).toBe(300);
  });

  it("shows a compact history error and preserves a complete action preview", async () => {
    await render([{ id: "tool", role: "tool", text: "Write src/app.ts\n\nFull tool output" }], vi.fn(), {
      onLoadEarlier: vi.fn(), historyError: "Could not load earlier messages.",
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not load earlier messages.");
    await act(async () => container.querySelector<HTMLButtonElement>(".activity-tree__heading")!.click());
    const details = container.querySelector<HTMLDetailsElement>(".action-details")!;
    expect(details.querySelector("summary")?.textContent).toContain("Write src/app.ts");
    details.open = true;
    expect(details.textContent).toContain("Full tool output");
  });

  it("gives an empty conversation a clear next step", async () => {
    await render([]);
    expect(container.querySelector(".empty-transcript")?.textContent).toBe("No messages yet. Send a message to begin.");
  });

  it("keeps the desktop working shimmer at the transcript tail, except while approval needs attention", async () => {
    await render([{ id: "reply", role: "assistant", text: "Still working" }], vi.fn(), { busy: true });
    expect(container.querySelector("[data-transcript-working]")?.textContent).toBe("Working…");
    expect(container.querySelector("[data-transcript-working]")?.getAttribute("role")).toBe("status");
    await render([{ id: "reply", role: "assistant", text: "Still working" }], vi.fn(), { busy: true, needsApproval: true });
    expect(container.querySelector("[data-transcript-working]")).toBeNull();
    await render([{ id: "reply", role: "assistant", text: "Finished" }], vi.fn(), { busy: false });
    expect(container.querySelector("[data-transcript-working]")).toBeNull();
  });
});
