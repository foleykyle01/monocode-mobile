// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { applyHarnessEvent } from "../../../integrations/harness/core/apply";
import { createCompanionBridge } from "./companionBridge";
import type * as ChildModule from "../../../integrations/harness/core/child";

const sent: Array<Record<string, any>> = [];
let onLine: (line: string) => void;
let providerTurn = 0;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("../../../integrations/harness/core/child", async (importOriginal) => ({
  ...await importOriginal<typeof ChildModule>(),
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (line: string) => void) => { onLine = line; },
  writeChild: async (_id: string, line: string) => {
    const message = JSON.parse(line);
    sent.push(message);
    if (message.id === undefined || !message.method) return;
    let result = {};
    if (message.method === "thread/start") result = { thread: { id: "existing-thread" } };
    if (message.method === "turn/start") result = { turn: { id: `turn-${++providerTurn}` } };
    queueMicrotask(() => {
      onLine(JSON.stringify({ id: message.id, result }));
      if (message.method === "turn/interrupt")
        onLine(JSON.stringify({ method: "turn/completed", params: { turn: { id: `turn-${providerTurn}`, status: "interrupted" } } }));
    });
  },
}));
const { codexAdapter } = await import("../../../integrations/harness/providers/codex/codexAdapter");
const { __codexTestReset } = await import("../../../integrations/harness/providers/codex/codex");

afterEach(async () => {
  await codexAdapter.stopSession("existing-desktop-session");
  __codexTestReset();
  localStorage.clear();
});

it("attaches to an existing Codex owner, reads output, answers approval, follows up and cancels through the same adapter", async () => {
  let session: Session = {
    id: "existing-desktop-session", harness: "codex", model: "codex:gpt-5.4", modelSettings: {},
    runtimeMode: "supervised", title: "Isolated test", cwd: "/tmp/companion-test", blocks: [],
  };
  let turn = 0;
  let completion: Promise<void>;
  function start(prompt: string) {
    turn++;
    session = { ...session, busy: true, turnReady: false, blocks: [...session.blocks, { id: `user-${turn}`, role: "user", text: prompt }] };
    completion = codexAdapter.sendTurn({
      sessionId: session.id, cwd: session.cwd, model: session.model,
      runtimeMode: session.runtimeMode, text: prompt,
      onEvent: (event) => { session = applyHarnessEvent(session, event); },
    });
  }
  // The desktop owns and starts a turn before the companion attaches.
  start("Initial desktop prompt");
  await vi.waitFor(() => expect(sent.filter(m => m.method === "turn/start")).toHaveLength(1));
  const bridge = createCompanionBridge({
    flush() {}, sessions: () => [session], eligible: () => true, turn: () => turn,
    send: async (_id, prompt) => { start(prompt); return true; },
    approve: (id, requestId, decision) => codexAdapter.respondApproval(id, requestId, decision),
    answer: (id, requestId, reply) => codexAdapter.respondQuestion!(id, requestId, reply),
    stop: async (id) => { await codexAdapter.cancelTurn(id); turn++; },
  }, "integration-epoch");
  const input = () => ({ epoch: bridge.epoch, sessionId: session.id, turn });

  onLine(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "existing-thread", turnId: "turn-1", itemId: "answer", delta: "Output from the desktop's running agent" } }));
  const snapshot = await bridge.handle("read", "sessions.read", { sessionId: session.id });
  expect(JSON.stringify(snapshot)).toContain("Output from the desktop's running agent");

  onLine(JSON.stringify({ id: 91, method: "item/commandExecution/requestApproval", params: { threadId: "existing-thread", turnId: "turn-1", itemId: "command", command: "echo test", cwd: session.cwd } }));
  await vi.waitFor(() => expect(session.blocks.some(b => b.approval)).toBe(true));
  const approval = session.blocks.find(b => b.approval)!;
  await bridge.handle("approve", "sessions.approve", { ...input(), blockId: approval.id, decision: "allow" });
  await vi.waitFor(() => expect(sent.find(m => m.id === 91)?.result).toEqual({ decision: "accept" }));

  onLine(JSON.stringify({ id: 92, method: "item/tool/requestUserInput", params: {
    threadId: "existing-thread", turnId: "turn-1", itemId: "question",
    questions: [{ id: "section", header: "Section type", question: "Which section?", isOther: true, options: [{ label: "Tasks" }, { label: "Docs" }] }],
  } }));
  await vi.waitFor(() => expect(session.pendingQuestion).toBeDefined());
  const prompt = session.pendingQuestion!;
  await bridge.handle("answer", "sessions.answer", { ...input(), questionId: prompt.requestId, reply: { kind: "answered", answers: { section: [prompt.questions[0].options[1].id] } } });
  await bridge.handle("answer", "sessions.answer", { ...input(), questionId: prompt.requestId, reply: { kind: "answered", answers: { section: [prompt.questions[0].options[1].id] } } });
  await vi.waitFor(() => expect(sent.find(m => m.id === 92)?.result).toEqual({ answers: { section: { answers: ["Docs"] } } }));
  expect(sent.filter(m => m.id === 92)).toHaveLength(1);

  onLine(JSON.stringify({ method: "turn/completed", params: { turn: { id: "turn-1", status: "completed" } } }));
  await completion!;
  session = { ...session, busy: false };
  await bridge.handle("follow-up", "sessions.send", { ...input(), text: "Continue from my phone" });
  await vi.waitFor(() => expect(sent.filter(m => m.method === "turn/start")).toHaveLength(2));
  await vi.waitFor(() => expect(session.blocks[session.blocks.length - 1]?.providerTurnId).toBe("turn-2"));
  expect(sent.filter(m => m.method === "thread/start")).toHaveLength(1);
  await bridge.handle("stop", "sessions.stop", input());
  await completion!;
  expect(sent.some(m => m.method === "turn/interrupt" && m.params.threadId === "existing-thread")).toBe(true);
}, 10_000);
