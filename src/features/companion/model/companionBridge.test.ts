import { describe, expect, it, vi } from "vitest";
import type { MonoSpawnedSession, Session } from "../../sessions/model/session";
import { createCompanionBridge, type CompanionOwner } from "./companionBridge";
import { buildCompanionNavigation, companionProjectId } from "./companionNavigation";
import { queueCompanionFollowUp } from "./companionFollowUp";

function fixture() {
  const session: Session = {
    id: "test-session", harness: "codex", model: "test-model", modelSettings: {},
    runtimeMode: "supervised", title: "Development test", cwd: "/tmp/companion-test",
    blocks: [{ id: "user-1", role: "user", text: "Original desktop prompt" }],
  };
  const sessions = [session];
  let turn = 1;
  const owner: CompanionOwner = {
    sessions: () => sessions, eligible: () => true, flush: vi.fn(), turn: () => turn,
    send: vi.fn(async (_id, prompt, requestId) => {
      session.blocks.push({ id: requestId, role: "user", text: prompt });
      session.busy = true; turn++; return true;
    }),
    approve: vi.fn(),
    stop: vi.fn(async () => { session.busy = false; turn++; }),
  };
  const bridge = createCompanionBridge(owner, "test-epoch");
  const input = () => ({ epoch: bridge.epoch, sessionId: session.id, turn });
  return { session, sessions, owner, bridge, input };
}

describe("desktop companion owner boundary", () => {
  it("keeps app-authored Mono prompts and drafts out of phone transcript snapshots", async () => {
    const { bridge, session } = fixture();
    session.blocks = [
      { id: "literal", role: "user", text: "Please explain this system prompt literal to me." },
      {
        id: "completion", role: "user", text: "INTERNAL_UPDATER_HANDOFF originalPrompt={\\n...}", internal: true,
        monoSessionCompletion: { sessionId: "worker", title: "Review", status: "completed" },
        tool: { detail: "INTERNAL_TOOL_DETAIL", preview: { kind: "shell", output: "INTERNAL_PREVIEW" } },
      },
      { id: "report", role: "assistant", text: "The linked review completed successfully." },
      { id: "legacy", role: "user", text: "INTERNAL_LEGACY_COMPLETION", internal: true },
      { id: "draft", role: "user", text: "UNSENT_DESKTOP_DRAFT", draft: true },
      { id: "approval", role: "tool", text: "Approve the deploy?", approval: { requestId: 9 } },
    ];

    const result = await bridge.handle("read", "sessions.read", { sessionId: session.id }) as { blocks: { id: string; text: string; approval?: unknown }[] };
    expect(result.blocks.map(block => block.id)).toEqual(["literal", "report", "approval"]);
    expect(result.blocks.map(block => block.text).join("\n")).toContain("system prompt literal");
    expect(JSON.stringify(result)).not.toMatch(/INTERNAL_|UNSENT_DESKTOP_DRAFT/);
    expect(result.blocks.at(-1)?.approval).toEqual({ requestId: 9 });
  });

  it("keeps raw history cursors and launch-card anchors correct around hidden blocks", async () => {
    const { bridge, session, sessions } = fixture();
    const child: Session = {
      id: "child", harness: "codex", model: "test-model", modelSettings: {}, runtimeMode: "supervised",
      title: "Linked review", cwd: "/tmp/child", busy: true, blocks: [],
    };
    sessions.push(child);
    const launch: MonoSpawnedSession = {
      sessionId: child.id, cwd: child.cwd, title: child.title, harness: child.harness, model: child.model,
    };
    session.blocks = [
      { id: "hidden-start", role: "user", text: "hidden", internal: true },
      { id: "prompt", role: "user", text: "Start the review", monoSpawnedSessions: [launch] },
      { id: "receipt", role: "tool", text: "Started linked review" },
      { id: "hidden-completion", role: "user", text: "hidden completion", internal: true },
      { id: "report", role: "assistant", text: "The parent report is visible." },
    ];
    const linked = await bridge.handle("linked", "sessions.read", { sessionId: session.id }) as { blocks: { id: string; spawnedSessions?: { id: string }[] }[] };
    expect(linked.blocks.map(block => block.id)).toEqual(["prompt", "receipt", "report"]);
    expect(linked.blocks.find(block => block.id === "receipt")?.spawnedSessions).toMatchObject([{ id: child.id }]);

    session.blocks = [
      { id: "older-visible", role: "assistant", text: "Older visible reply" },
      { id: "older-draft", role: "user", text: "draft", draft: true },
      ...Array.from({ length: 100 }, (_, index) => ({ id: `hidden-${index}`, role: "user" as const, text: "hidden", internal: true })),
    ];
    const newest = await bridge.handle("newest", "sessions.read", { sessionId: session.id }) as { blocks: unknown[]; nextBefore: number | null; totalBlocks: number };
    expect(newest).toMatchObject({ blocks: [], nextBefore: 2, totalBlocks: 102 });
    const older = await bridge.handle("older", "sessions.read", { sessionId: session.id, before: newest.nextBefore }) as { blocks: { id: string }[]; nextBefore: number | null };
    expect(older).toMatchObject({ nextBefore: null });
    expect(older.blocks.map(block => block.id)).toEqual(["older-visible"]);
  });

  it("accepts queued follow-ups once during work, preserves existing messages and reports the actual queue", async () => {
    const { bridge, session, owner, input } = fixture();
    session.busy = true;
    session.queuedMessages = [{ id: "desktop", text: "Existing", attachments: [] }];
    session.blocks.push({ id: "approval", role: "tool", text: "Allow?", approval: { requestId: 2 } });
    owner.queuedFollowUps = true;
    owner.send = vi.fn(async (_id, prompt, requestId) => {
      Object.assign(session, queueCompanionFollowUp(session, prompt, requestId));
      return "queued" as const;
    });
    const command = { ...input(), text: "Next" };
    const results = await Promise.all([bridge.handle("one", "sessions.send", command), bridge.handle("one", "sessions.send", command)]);
    expect(results[0]).toMatchObject({ accepted: true, delivery: "queued", turn: 1 });
    expect(results[1]).toEqual(results[0]);
    await bridge.handle("two", "sessions.send", { ...input(), text: "Then this" });
    expect(owner.send).toHaveBeenCalledTimes(2);
    expect(owner.stop).not.toHaveBeenCalled();
    expect(session.busy).toBe(true);
    expect(session.blocks[1].approval?.decided).toBeUndefined();
    expect(session.queuedMessages.map(message => message.text)).toEqual(["Existing", "Next", "Then this"]);
    expect(await bridge.handle("read-queue", "sessions.read", { sessionId: session.id })).toMatchObject({ queuedMessages: [
      { id: "desktop", state: "queued" }, { id: "companion_test-epoch_one", state: "queued" }, { id: "companion_test-epoch_two", state: "queued" },
    ] });
    await expect(bridge.handle("invalid", "sessions.send", { ...input(), turn: 0, text: "Stale" })).rejects.toThrow("turn changed");
    await expect(bridge.handle("missing", "sessions.send", { ...input(), sessionId: "missing", text: "Wrong" })).rejects.toThrow("not available");
    expect(owner.send).toHaveBeenCalledTimes(2);
  });

  it("does not enable busy sends for an owner without queue support", async () => {
    const { bridge, session, owner, input } = fixture();
    session.busy = true;
    await expect(bridge.handle("old-owner", "sessions.send", { ...input(), text: "Next" })).rejects.toThrow("update the Mac");
    expect(owner.send).not.toHaveBeenCalled();
  });

  it.each(["failed", "stopped", "draft", "done", "unknown"] as const)("exports the authoritative %s outcome", async state => {
    const { bridge, session } = fixture();
    if (state === "draft") session.blocks[0].draft = true;
    if (state === "done") session.blocks[0].durationMs = 5;
    if (state === "failed" || state === "stopped") session.blocks.push({ id: "notice", role: "system", text: "Stopped", notice: state === "failed" ? "error" : "interrupt" });
    expect(await bridge.handle("state", "sessions.read", { sessionId: session.id })).toMatchObject({ session: { lifecycle: state } });
  });
  const launch: MonoSpawnedSession = {
    sessionId: "app-mono-child",
    cwd: "/tmp/companion-test",
    title: "Child task",
    harness: "codex",
    model: "child-model",
  };

  function readBlocks(result: unknown) {
    return (result as { blocks: Array<Record<string, unknown>> }).blocks;
  }

  it("exports live summaries for Mono-launched sessions and refreshes them on each read", async () => {
    const { bridge, session, sessions, owner } = fixture();
    const child: Session = {
      ...session,
      id: launch.sessionId,
      title: launch.title,
      cwd: launch.cwd,
      model: launch.model,
      blocks: [{ id: "child-output", role: "assistant", text: "Working" }],
      busy: false,
    };
    sessions.push(child);
    session.blocks = [
      { id: "prompt", role: "user", text: "Delegate", monoSpawnedSessions: [launch] },
      { id: "reply", role: "assistant", text: "Started" },
    ];
    owner.turn = vi.fn((id) => id === child.id ? 4 : 1);

    const first = readBlocks(await bridge.handle("first", "sessions.read", { sessionId: session.id }));
    expect(first[1]).toMatchObject({ spawnedSessions: [{ id: child.id, busy: false, turn: 4 }] });

    child.busy = true;
    child.blocks.push({ id: "approval", role: "approval", text: "Allow?", approval: { requestId: 2 } });
    owner.turn = vi.fn((id) => id === child.id ? 5 : 1);
    const second = readBlocks(await bridge.handle("second", "sessions.read", { sessionId: session.id }));
    expect(second[1]).toMatchObject({ spawnedSessions: [{ id: child.id, busy: true, turn: 5, needsApproval: true }] });
  });

  it("omits self, unavailable, unlistable, and deleted Mono targets without leaking their metadata", async () => {
    const { bridge, session, sessions, owner } = fixture();
    const targets = [launch, { ...launch, sessionId: "excluded", title: "Private" }, { ...launch, sessionId: "hidden", title: "Hidden" }, { ...launch, sessionId: "deleted", title: "Gone" }];
    session.blocks = [{
      id: "prompt", role: "user", text: "Delegate",
      monoSpawnedSessions: [...targets, { ...launch, sessionId: session.id }],
    }];
    sessions.push(
      ...targets.slice(0, 2).map((entry) => ({ ...session, ...entry, id: entry.sessionId, blocks: [] })),
    );
    owner.eligible = (entry) => entry.id !== "excluded";
    owner.listable = (entry) => entry.id !== "hidden";

    const first = await bridge.handle("filtered", "sessions.read", { sessionId: session.id });
    expect(JSON.stringify(first)).not.toContain("Private");
    expect(JSON.stringify(first)).not.toContain("Hidden");
    expect(JSON.stringify(first)).not.toContain("Gone");
    expect(readBlocks(first)[0]).toMatchObject({ spawnedSessions: [{ id: launch.sessionId }] });

    sessions.splice(sessions.findIndex((entry) => entry.id === launch.sessionId), 1);
    const second = readBlocks(await bridge.handle("deleted", "sessions.read", { sessionId: session.id }));
    expect(second[0]).not.toHaveProperty("spawnedSessions");
  });

  it("deduplicates launch records and anchors an old launch to the latest page's turn tail", async () => {
    const { bridge, session, sessions } = fixture();
    sessions.push({ ...session, id: launch.sessionId, title: launch.title, blocks: [] });
    session.blocks = [
      { id: "old-prompt", role: "user", text: "Delegate", monoSpawnedSessions: [launch, launch] },
      ...Array.from({ length: 120 }, (_, index) => ({ id: `reply-${index}`, role: "assistant" as const, text: "Output" })),
    ];

    const result = readBlocks(await bridge.handle("paged", "sessions.read", { sessionId: session.id }));
    expect(result).toHaveLength(100);
    expect(result[0]).not.toHaveProperty("spawnedSessions");
    expect(result[99]).toMatchObject({ id: "reply-119", spawnedSessions: [{ id: launch.sessionId }] });
  });

  it("allows the same child to be linked once in each Mono turn", async () => {
    const { bridge, session, sessions } = fixture();
    sessions.push({ ...session, id: launch.sessionId, title: launch.title, blocks: [] });
    session.blocks = [
      { id: "first-prompt", role: "user", text: "Start", monoSpawnedSessions: [launch, launch] },
      { id: "first-reply", role: "assistant", text: "Started" },
      { id: "second-prompt", role: "user", text: "Continue", monoSpawnedSessions: [launch] },
      { id: "second-reply", role: "assistant", text: "Continuing" },
    ];

    const blocks = readBlocks(await bridge.handle("repeat", "sessions.read", { sessionId: session.id }));
    expect(blocks[1]).toMatchObject({ spawnedSessions: [{ id: launch.sessionId }] });
    expect(blocks[3]).toMatchObject({ spawnedSessions: [{ id: launch.sessionId }] });
  });

  function questionFixture() {
    const f = fixture();
    f.session.busy = true;
    f.session.pendingQuestion = { requestId: 7, questions: [{ id: "section", prompt: "What kind of section?", multiSelect: false, allowCustom: true, options: [{ id: "tasks", label: "Tasks" }, { id: "docs", label: "Docs" }] }] };
    f.owner.answer = vi.fn();
    f.owner.keepQuestionOpen = vi.fn();
    const reply = { kind: "answered", answers: { section: ["tasks"] } };
    return { ...f, reply, answer: () => ({ ...f.input(), questionId: 7, reply }) };
  }

  it("exports the exact question and accepts its answer once across retries", async () => {
    const { bridge, session, owner, answer, reply } = questionFixture();
    expect(await bridge.handle("read", "sessions.read", { sessionId: session.id })).toMatchObject({ pendingQuestion: session.pendingQuestion, session: { needsQuestion: true, needsApproval: true } });
    await bridge.handle("answer", "sessions.answer", answer());
    await bridge.handle("answer", "sessions.answer", answer());
    await expect(bridge.handle("other-phone", "sessions.answer", answer())).rejects.toThrow("no longer pending");
    expect(owner.answer).toHaveBeenCalledExactlyOnceWith(session.id, 7, reply);
  });

  it("keeps a deadline open without consuming the question, then permits skip", async () => {
    const { bridge, session, owner, input } = questionFixture();
    await bridge.handle("interact", "sessions.question.keepOpen", { ...input(), questionId: 7 });
    expect(owner.keepQuestionOpen).toHaveBeenCalledExactlyOnceWith(session.id, 7);
    await bridge.handle("skip", "sessions.answer", { ...input(), questionId: 7, reply: { kind: "skipped" } });
    expect(owner.answer).toHaveBeenCalledExactlyOnceWith(session.id, 7, { kind: "skipped" });
  });

  it.each([
    { kind: "answered", answers: { missing: ["tasks"] } },
    { kind: "answered", answers: { section: ["invented"] } },
    { kind: "answered", answers: { section: ["tasks", "docs"] } },
    { kind: "answered", answers: { section: ["tasks", "tasks"] } },
    { kind: "answered", answers: { section: ["__custom__"] } },
    { kind: "answered", answers: { section: ["tasks"] }, custom: { section: "hidden extra" } },
    { kind: "answered", answers: {}, custom: { section: "x".repeat(8193) } },
    { kind: "skipped", extra: true },
  ])("rejects malformed/unsupported question answers before dispatch (%#)", async reply => {
    const { bridge, owner, answer } = questionFixture();
    await expect(bridge.handle("bad", "sessions.answer", { ...answer(), reply })).rejects.toThrow();
    expect(owner.answer).not.toHaveBeenCalled();
  });

  it("accepts custom and partial multi-question answers, but enforces custom permission", async () => {
    const { bridge, session, owner, answer } = questionFixture();
    const reply = { kind: "answered", answers: { section: ["__custom__"] }, custom: { section: "A new project" } };
    session.pendingQuestion!.questions[0].allowCustom = false;
    await expect(bridge.handle("forbidden", "sessions.answer", { ...answer(), reply })).rejects.toThrow();
    session.pendingQuestion!.questions[0].allowCustom = true;
    session.pendingQuestion!.questions.push({ id: "later", prompt: "Optional?", options: [], multiSelect: false, allowCustom: true });
    await bridge.handle("custom", "sessions.answer", { ...answer(), reply });
    expect(owner.answer).toHaveBeenCalledWith(session.id, 7, reply);
  });

  it("rejects stale questions and retains uncertain decisions without redispatch", async () => {
    const { bridge, owner, answer } = questionFixture();
    await expect(bridge.handle("stale", "sessions.answer", { ...answer(), questionId: 6 })).rejects.toThrow("no longer pending");
    owner.answer = vi.fn(() => { throw new Error("provider disconnected"); });
    await expect(bridge.handle("uncertain", "sessions.answer", answer())).rejects.toMatchObject({ outcomeUnknown: true });
    await expect(bridge.handle("uncertain", "sessions.answer", answer())).rejects.toMatchObject({ outcomeUnknown: true });
    await expect(bridge.handle("new", "sessions.answer", answer())).rejects.toThrow("no longer pending");
    expect(owner.answer).toHaveBeenCalledTimes(1);
  });

  it("fails closed for oversized questions without sending abbreviated choices", async () => {
    const { bridge, session, owner, answer } = questionFixture();
    session.pendingQuestion!.questions[0].prompt = "x".repeat(33_000);
    expect(await bridge.handle("read", "sessions.read", { sessionId: session.id })).toMatchObject({ pendingQuestion: undefined, questionUnavailable: true });
    await expect(bridge.handle("bad", "sessions.answer", answer())).rejects.toThrow("no longer pending");
    expect(owner.answer).not.toHaveBeenCalled();
  });

  it("revalidates session review after asynchronous loading", async () => {
    const { bridge, owner, session } = fixture();
    const result = { files: [], total: 0, additions: 0, deletions: 0, truncated: false };
    owner.review = vi.fn(async () => result);
    expect(await bridge.handle("review", "sessions.review.list", { sessionId: session.id })).toMatchObject({ ...result, epoch: bridge.epoch, turn: 1 });
    owner.review = vi.fn(async () => { session.busy = true; return result; });
    await expect(bridge.handle("race", "sessions.review.list", { sessionId: session.id })).rejects.toThrow("Session changed");
    await expect(bridge.handle("path", "sessions.review.read", { sessionId: session.id, relative: "a", cwd: "/secret" })).rejects.toThrow("Unsupported input");
  });

  it("bounds subagent activity while keeping desktop tool labels and states", async () => {
    const { bridge, session } = fixture();
    session.blocks.push({ id: "agent", role: "tool", text: "Inspect tasks", tool: { kind: "agent", status: "running" }, agentRun: { name: "Task review", steps: Array.from({ length: 25 }, (_, index) => ({ id: `s${index}`, kind: "tool", text: "x".repeat(1000), status: "completed" })) } });
    const snapshot = await bridge.handle("read", "sessions.read", { sessionId: session.id }) as { blocks: { activity?: { steps: { label: string }[] } }[] };
    expect(snapshot.blocks[1]).toMatchObject({ activity: { name: "Task review", state: "pending", stepsTruncated: true } });
    expect(snapshot.blocks[1].activity!.steps).toHaveLength(20);
    expect(snapshot.blocks[1].activity!.steps[0].label).toHaveLength(512);
  });

  it("routes Inbox and project-only Changes reads through the owner boundary", async () => {
    const { bridge, owner } = fixture();
    owner.inbox = {
      list: vi.fn(async () => ({ items: [], errors: [], truncated: false })),
      read: vi.fn(async (key: string) => ({ item: { key }, body: "Issue body", truncated: false })),
      context: vi.fn(),
    } as never;
    owner.changes = {
      list: vi.fn(async (target: { projectId: string; sessionId?: string }) => ({
        branch: "main", head: "abc", files: [], additions: 0, deletions: 0, revision: `rev:${target.projectId}`,
      })),
      read: vi.fn(async (target: { projectId: string; sessionId?: string }, relative: string, kind: "staged" | "unstaged") => ({
        relative, kind, status: "modified", original: "", current: "change", binary: false, tooLarge: false, truncated: false,
        revision: `rev:${target.projectId}`,
      })),
      stage: vi.fn(), unstage: vi.fn(), commit: vi.fn(),
    } as never;

    await expect(bridge.handle("inbox-list", "inbox.list", {})).resolves.toMatchObject({ epoch: bridge.epoch, items: [] });
    await expect(bridge.handle("inbox-read", "inbox.read", { key: "github:item" })).resolves.toMatchObject({ epoch: bridge.epoch, item: { key: "github:item" } });
    await expect(bridge.handle("changes-list", "changes.list", { projectId: "/work/app" })).resolves.toMatchObject({ epoch: bridge.epoch, revision: "rev:/work/app" });
    await expect(bridge.handle("changes-read", "changes.read", { projectId: "/work/app", relative: "src/main.ts", kind: "unstaged" })).resolves.toMatchObject({ epoch: bridge.epoch, relative: "src/main.ts", kind: "unstaged" });

    expect(owner.inbox.list).toHaveBeenCalledExactlyOnceWith();
    expect(owner.inbox.read).toHaveBeenCalledExactlyOnceWith("github:item");
    expect(owner.changes.list).toHaveBeenCalledExactlyOnceWith({ projectId: "/work/app" });
    expect(owner.changes.read).toHaveBeenCalledExactlyOnceWith({ projectId: "/work/app" }, "src/main.ts", "unstaged");
  });

  it("routes bounded Mono detail reads and rejects arbitrary fields or offsets", async () => {
    const { bridge, owner } = fixture();
    owner.monoRead = vi.fn(async (input) => ({
      mono: { id: input.monoId }, scope: { projects: [] },
      ...(input.section === "memory" ? { memory: { text: "facts", offset: input.offset ?? 0, totalLines: 1, truncated: false } } : {}),
    })) as never;

    await expect(bridge.handle("mono-read", "monos.read", { monoId: "mono-1", section: "memory", offset: 20 }))
      .resolves.toMatchObject({ epoch: bridge.epoch, memory: { text: "facts", offset: 20 } });
    await expect(bridge.handle("bad-field", "monos.read", { monoId: "mono-1", path: "/tmp/secret" }))
      .rejects.toThrow("Unsupported input field");
    await expect(bridge.handle("bad-offset", "monos.read", { monoId: "mono-1", offset: -1 }))
      .rejects.toThrow("Invalid page offset");
    expect(owner.monoRead).toHaveBeenCalledExactlyOnceWith({ monoId: "mono-1", section: "memory", offset: 20 });
  });

  it("includes approval file contents and rejects allowing a truncated action", async () => {
    const { bridge, session, owner, input } = fixture();
    session.busy = true;
    const block = { id: "write", role: "tool" as const, text: "Write", approval: { requestId: 1 },
      tool: { preview: { kind: "write" as const, path: "/tmp/approval.txt", lines: [{ kind: "add" as const, text: "TEST" }] } } };
    session.blocks.push(block);
    expect(await bridge.handle("read", "sessions.read", { sessionId: session.id })).toMatchObject({
      blocks: expect.arrayContaining([expect.objectContaining({ id: "write", text: "Write\n\n/tmp/approval.txt\n\n+TEST", truncated: false })]),
    });
    block.tool.preview.lines[0].text = "shortened…";
    await expect(bridge.handle("allow-shortened", "sessions.approve", { ...input(), blockId: "write", decision: "allow" })).rejects.toThrow("full action");
    block.tool.preview.lines[0].text = "x".repeat(9_000);
    await expect(bridge.handle("allow-large", "sessions.approve", { ...input(), blockId: "write", decision: "allow" })).rejects.toThrow("full action");
    expect(owner.approve).not.toHaveBeenCalled();
    await bridge.handle("deny-large", "sessions.approve", { ...input(), blockId: "write", decision: "deny" });
    expect(owner.approve).toHaveBeenCalledExactlyOnceWith(session.id, 1, "deny");
  });

  it("reads the existing owner's live session without creating or persisting another", async () => {
    const { bridge, session, owner } = fixture();
    session.blocks.push({ id: "output", role: "assistant", text: "Live desktop output" });
    const result = await bridge.handle("read", "sessions.read", { sessionId: session.id });
    expect(result).toMatchObject({ epoch: "test-epoch", session: { id: session.id, turn: 1 }, blocks: session.blocks.map(b => ({ ...b, truncated: false })) });
    expect(owner.send).not.toHaveBeenCalled();
  });

  it("adds a resolved phone-safe background only to an individual transcript read", async () => {
    const { bridge, owner, session } = fixture();
    owner.chatBackground = vi.fn(() => ({
      image: "data:image/jpeg;base64,background",
      scope: "all" as const,
      emptyOpacity: 0.24,
      sessionOpacity: 0.18,
      effect: "none" as const,
    }));

    await expect(bridge.handle("read", "sessions.read", { sessionId: session.id }))
      .resolves.toMatchObject({
        chatBackground: {
          image: "data:image/jpeg;base64,background",
          sessionOpacity: 0.18,
        },
      });
    await expect(bridge.handle("list", "sessions.list", {})).resolves.not.toHaveProperty(
      "chatBackground",
    );
    expect(owner.chatBackground).toHaveBeenCalledExactlyOnceWith(session);
  });

  it("places model and access choices at the SessionRead top level", async () => {
    const { bridge, owner, session } = fixture();
    owner.configuration = () => ({
      models: [{ harness: "codex", id: "test-model", label: "Test model" }],
      accessModes: [{ id: "supervised", label: "Supervised" }],
    });

    const result = await bridge.handle("read", "sessions.read", { sessionId: session.id }) as {
      session: Record<string, unknown>;
      configuration?: unknown;
    };
    expect(result.configuration).toMatchObject({
      models: [{ id: "test-model" }],
      accessModes: [{ id: "supervised" }],
    });
    expect(result.session).not.toHaveProperty("configuration");
  });

  it("adds bounded desktop project and Mono navigation without broadening controls", async () => {
    const { bridge, owner, session } = fixture();
    session.cwd = "/work/client";
    session.worktreeCwd = "/work/client-feature";
    owner.navigation = () => buildCompanionNavigation({
      projectPaths: ["/work/client"],
      groups: [{ id: "clients", name: "Clients", collapsed: false }],
      assignments: { "/work/client": "clients" },
      monos: [],
      sessions: [session],
    });
    owner.projectId = (current, navigation) => companionProjectId(current.cwd, navigation);

    await expect(bridge.handle("list", "sessions.list", {})).resolves.toMatchObject({
      sessions: [expect.objectContaining({ id: session.id, projectId: "/work/client" })],
      navigation: {
        groups: [{ id: "clients", projectIds: ["/work/client"] }],
        projects: [{ id: "/work/client", path: "/work/client" }],
        monos: [],
      },
    });
    expect(owner.send).not.toHaveBeenCalled();
    expect(owner.approve).not.toHaveBeenCalled();
    expect(owner.stop).not.toHaveBeenCalled();
  });

  it("creates one blank session in an advertised project with a client UUID", async () => {
    const { bridge, owner, sessions } = fixture();
    const projectId = "/tmp/companion-test";
    const sessionId = "e2f1e9f4-617a-4cb5-85ef-1d9e8cf1cc26";
    owner.navigation = () => buildCompanionNavigation({
      projectPaths: [projectId], groups: [], assignments: {}, monos: [], sessions,
    });
    owner.createSession = vi.fn((_project, id) => {
      sessions.push({
        ...sessions[0], id, blocks: [], busy: false,
      });
    });
    const command = { epoch: bridge.epoch, projectId, sessionId };

    await expect(Promise.all([
      bridge.handle("create", "sessions.create", command),
      bridge.handle("create", "sessions.create", command),
    ])).resolves.toEqual([
      { epoch: bridge.epoch, sessionId, accepted: true, turn: 0 },
      { epoch: bridge.epoch, sessionId, accepted: true, turn: 0 },
    ]);
    expect(owner.createSession).toHaveBeenCalledExactlyOnceWith(projectId, sessionId);
    await expect(bridge.handle("list", "sessions.list", {})).resolves.toMatchObject({
      capabilities: { createSession: true },
    });
  });

  it("rejects stale, arbitrary, invalid, and uncertain project creation", async () => {
    const { bridge, owner, sessions } = fixture();
    const projectId = "/tmp/companion-test";
    owner.navigation = () => buildCompanionNavigation({
      projectPaths: [projectId], groups: [], assignments: {}, monos: [], sessions,
    });
    owner.createSession = vi.fn(() => { throw new Error("Desktop lost response"); });
    const validId = "b2f1e9f4-617a-4cb5-85ef-1d9e8cf1cc26";

    await expect(bridge.handle("stale-create", "sessions.create", {
      epoch: "old", projectId, sessionId: validId,
    })).rejects.toThrow("connection changed");
    await expect(bridge.handle("arbitrary-project", "sessions.create", {
      epoch: bridge.epoch, projectId: "/outside", sessionId: validId,
    })).rejects.toThrow("creation is unavailable");
    await expect(bridge.handle("bad-id", "sessions.create", {
      epoch: bridge.epoch, projectId, sessionId: "not-a-uuid",
    })).rejects.toThrow("Invalid session ID");
    const uncertain = { epoch: bridge.epoch, projectId, sessionId: validId };
    await expect(bridge.handle("uncertain-create", "sessions.create", uncertain))
      .rejects.toMatchObject({ outcomeUnknown: true });
    await expect(bridge.handle("uncertain-create", "sessions.create", uncertain))
      .rejects.toMatchObject({ outcomeUnknown: true });
    expect(owner.createSession).toHaveBeenCalledTimes(1);
  });

  it("changes only advertised model and access choices through the desktop owner", async () => {
    const { bridge, owner, session, input } = fixture();
    session.model = "legacy-model";
    owner.configuration = () => ({
      models: [{ harness: "codex", id: "test-model", label: "Test model" }],
      accessModes: [{ id: "auto", label: "Auto" }],
    });
    owner.configure = vi.fn();

    await bridge.handle("configure", "sessions.configure", {
      ...input(), runtimeMode: "auto",
    });
    expect(owner.configure).toHaveBeenCalledExactlyOnceWith(session.id, {
      harness: undefined,
      model: undefined,
      runtimeMode: "auto",
    });
    await expect(bridge.handle("bad-model", "sessions.configure", {
      ...input(), harness: "claude", model: "claude:missing",
    })).rejects.toThrow("unavailable");
    session.blocks.push({ id: "draft", role: "user", text: "Unsent", draft: true });
    await expect(bridge.handle("draft", "sessions.configure", {
      ...input(), runtimeMode: "auto",
    })).rejects.toThrow("no draft");
  });

  it("allows a pending provider switch to send, but not while its handoff is preparing", async () => {
    const { bridge, owner, session, input } = fixture();
    owner.configuration = () => ({
      models: [
        { harness: "codex", id: "test-model", label: "Test model" },
        { harness: "claude", id: "claude:test", label: "Claude test" },
      ],
      accessModes: [{ id: "auto", label: "Auto" }],
    });
    owner.configure = vi.fn((_id, change) => {
      session.harness = "claude";
      session.model = change.model!;
      session.pendingSwitch = {
        from: "codex",
        fromModel: "test-model",
        fromSettings: {},
      };
    });

    await bridge.handle("switch", "sessions.configure", {
      ...input(), harness: "claude", model: "claude:test",
    });
    await expect(bridge.handle("after-switch", "sessions.send", {
      ...input(), text: "Continue after switching providers",
    })).resolves.toMatchObject({ accepted: true });
    expect(owner.send).toHaveBeenCalledOnce();

    const blocked = fixture();
    blocked.session.blocks.push({
      id: "handoff",
      role: "handoff",
      text: "Preparing handoff",
      handoff: { from: "codex", to: "claude", status: "preparing" },
    });
    await expect(blocked.bridge.handle("preparing", "sessions.configure", {
      ...blocked.input(), runtimeMode: "auto",
    })).rejects.toThrow("changing its provider");
    expect(blocked.owner.configure).toBeUndefined();
  });

  it("dispatches a follow-up once even when concurrent clients retry the same command", async () => {
    const { bridge, owner, input } = fixture();
    const command = { ...input(), text: "Continue" };
    const [first, second] = await Promise.all([
      bridge.handle("same-command", "sessions.send", command),
      bridge.handle("same-command", "sessions.send", command),
    ]);
    expect(first).toEqual(second);
    expect(owner.send).toHaveBeenCalledExactlyOnceWith("test-session", "Continue", "companion:test-epoch:same-command");
    await expect(bridge.handle("same-command", "sessions.send", { ...command, text: "Different" })).rejects.toThrow("different input");
  });

  it("rejects a stale turn and an epoch from before a renderer restart", async () => {
    const { bridge, owner, input } = fixture();
    await expect(bridge.handle("stale", "sessions.stop", { ...input(), turn: 0 })).rejects.toThrow("turn changed");
    await expect(bridge.handle("old", "sessions.send", { ...input(), epoch: "old", text: "No" })).rejects.toThrow("connection changed");
    expect(owner.send).not.toHaveBeenCalled();
    expect(owner.stop).not.toHaveBeenCalled();
  });

  it("allows only one approval decision even before the desktop reducer settles", async () => {
    const { session, bridge, owner, input } = fixture();
    session.busy = true;
    session.blocks.push({ id: "approval", role: "approval", text: "Run test?", approval: { requestId: 9 } });
    const command = { ...input(), blockId: "approval", decision: "allow" };
    await bridge.handle("allow", "sessions.approve", command);
    await expect(bridge.handle("deny", "sessions.approve", { ...command, decision: "deny" })).rejects.toThrow("no longer pending");
    expect(owner.approve).toHaveBeenCalledExactlyOnceWith(session.id, 9, "allow");
  });

  it("rejects a desktop-resolved approval", async () => {
    const { session, bridge, owner, input } = fixture();
    session.busy = true;
    session.blocks.push({ id: "approval", role: "approval", text: "Done", approval: { requestId: 9, decided: "deny" } });
    await expect(bridge.handle("allow", "sessions.approve", { ...input(), blockId: "approval", decision: "allow" })).rejects.toThrow("no longer pending");
    expect(owner.approve).not.toHaveBeenCalled();
  });

  it("leaves Mono habit approvals on the Mac", async () => {
    const { session, bridge, owner, input } = fixture();
    session.busy = true;
    session.blocks.push({
      id: "habit-approval",
      role: "approval",
      text: "Habit needs approval",
      approval: { requestId: 10 },
      monoHabit: { id: "daily", name: "Daily", at: 1 },
    });
    await expect(bridge.handle("habit", "sessions.approve", {
      ...input(), blockId: "habit-approval", decision: "allow",
    })).rejects.toThrow("habit approvals");
    expect(owner.approve).not.toHaveBeenCalled();
  });

  it("retains a failed mutation receipt rather than replaying an uncertain action", async () => {
    const { bridge, owner, input } = fixture();
    owner.send = vi.fn(async () => { throw new Error("Lost acceptance response"); });
    const command = { ...input(), text: "Continue" };
    await expect(bridge.handle("uncertain", "sessions.send", command)).rejects.toThrow("Lost acceptance");
    await expect(bridge.handle("uncertain", "sessions.send", command)).rejects.toMatchObject({ outcomeUnknown: true });
    expect(owner.send).toHaveBeenCalledTimes(1);
  });

  it("does not send over existing drafts or stop an idle session", async () => {
    const { bridge, session, owner, input } = fixture();
    session.blocks.push({ id: "draft", role: "user", text: "Unsent", draft: true });
    await expect(bridge.handle("send", "sessions.send", { ...input(), text: "Continue" })).rejects.toThrow("draft");
    await expect(bridge.handle("stop", "sessions.stop", input())).rejects.toThrow("not running");
    expect(owner.send).not.toHaveBeenCalled();
    expect(owner.stop).not.toHaveBeenCalled();
  });

  it("stops the owner's active turn and deduplicates the receipt", async () => {
    const { bridge, session, owner, input } = fixture();
    session.busy = true;
    const command = input();
    await bridge.handle("stop", "sessions.stop", command);
    await bridge.handle("stop", "sessions.stop", command);
    expect(owner.stop).toHaveBeenCalledExactlyOnceWith(session.id);
    expect(session.busy).toBe(false);
  });

  it("bounds transcript reads and marks truncation with an older-page cursor", async () => {
    const { bridge, session } = fixture();
    session.blocks = Array.from({ length: 130 }, (_, i) => ({ id: String(i), role: "assistant", text: "x".repeat(9000) }));
    const result = await bridge.handle("read", "sessions.read", { sessionId: session.id }) as { blocks: { text: string; truncated: boolean }[]; nextBefore: number };
    expect(result.blocks).toHaveLength(100);
    expect(result.blocks[0].text).toHaveLength(8192);
    expect(result.blocks[0].truncated).toBe(true);
    expect(result.nextBefore).toBe(30);
  });

  it("excludes unsupported sessions and denies arbitrary actions and extra fields", async () => {
    const { bridge, owner, session, input } = fixture();
    owner.eligible = () => false;
    await expect(bridge.handle("read", "sessions.read", { sessionId: session.id })).rejects.toThrow("not available");
    expect(await bridge.handle("list", "sessions.list", {})).toMatchObject({ sessions: [] });
    await expect(bridge.handle("shell", "harness_spawn", {})).rejects.toThrow("Unsupported");
    owner.eligible = () => true;
    await expect(bridge.handle("send", "sessions.send", { ...input(), text: "Continue", shell: "bad" })).rejects.toThrow("Unsupported input");
    expect(owner.send).not.toHaveBeenCalled();
  });
});
