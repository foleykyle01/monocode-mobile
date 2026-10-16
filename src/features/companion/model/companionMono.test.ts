import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { createCompanionMonoReader } from "./companionMono";

const readAgentFile = vi.hoisted(() => vi.fn());
const getMonoTranscriptPage = vi.hoisted(() => vi.fn());
vi.mock("../../monos/model/monoFiles", () => ({
  readAgentFile,
  defaultSoul: (instructions?: string) => `# Soul\n\n## Standing instructions\n${instructions?.trim() || "- (Add anything it should always keep in mind.)"}\n`,
}));
vi.mock("../../sessions/data/sessionStore", () => ({ getMonoTranscriptPage }));

const session = {
  id: "mono-session",
  cwd: "/work/app",
  busy: true,
  harness: "claude",
  model: "opus",
  modelSettings: { effort: "high" },
  runtimeMode: "supervised",
  title: "Scout",
  blocks: [{ id: "approval", role: "approval", text: "Approve", approval: { requestId: 1 } }],
} as Session;

const mono = {
  id: "mono-1",
  name: "Scout",
  mascot: "ghost",
  color: "#fff",
  projects: ["/work/app", "/private/hidden"],
  sessionId: session.id,
};

function reader(
  currentMono = mono,
  currentSession = session,
  activityState?: NonNullable<Parameters<typeof createCompanionMonoReader>[0]>["activityState"],
  options: {
    sessions?: Session[];
    canChat?: (entry: Session) => boolean;
    listable?: (entry: Session) => boolean;
  } = {},
) {
  return createCompanionMonoReader({
    monos: () => [currentMono],
    sessions: () => options.sessions ?? [currentSession],
    navigation: () => ({ projects: [{ id: "/work/app", name: "App", path: "/work/app/" }] }),
    canChat: options.canChat,
    listable: options.listable,
    activityState,
    configuration: () => ({
      models: [{ harness: "claude", id: "opus", label: "Opus" }],
      accessModes: [{ id: "supervised", label: "Supervised", description: "Ask first" }],
    }),
  });
}

beforeEach(() => {
  readAgentFile.mockClear();
  getMonoTranscriptPage.mockReset().mockResolvedValue({ blocks: [], before: null, hasNewer: false });
  readAgentFile.mockImplementation(async (_id: string, path: string) => {
    if (path === "SOUL.md") return { text: [...Array.from({ length: 121 }, (_, index) => `line ${index}`), "token=ghp_12345678901234567890"].join("\n") };
    if (path === "MEMORY.md") return { text: "# Memory\n- user likes tests\n" };
    return { text: JSON.stringify(Array.from({ length: 21 }, (_, index) => ({
      id: `habit-${index}`, name: `Habit ${index}`, instructions: "Check the project", enabled: true,
      schedule: { scheduleKind: "daily", minute: 0, time: "09:00", dayOfWeek: 1 }, createdAt: 1, nextRunAt: 2,
    }))) };
  });
});

describe("companion Mono read projection", () => {
  it("returns real state, scope, model/access, and bounded paged details without paths", async () => {
    const result = await reader().read({ monoId: "mono-1", section: "soul" });
    expect(result.mono).toMatchObject({
      id: "mono-1", status: "needs-you", statusLabel: "Needs you", activity: "Waiting for approval",
      canChat: true, busy: false, needsApproval: true,
    });
    expect(result.scope).toEqual({ projects: [{ id: "/work/app", name: "App" }] });
    expect(result.model).toEqual({ harness: "claude", id: "opus", label: "Opus", settings: { effort: "high" } });
    expect(result.access).toEqual({ id: "supervised", label: "Supervised", description: "Ask first" });
    expect(result.soul?.offset).toBe(0);
    expect(result.soul?.nextOffset).toBe(120);
    expect(result.soul?.truncated).toBe(true);
    expect(result.soul?.text).not.toContain("ghp_");
    expect(JSON.stringify(result)).not.toContain("/private/hidden");
  });

  it("pages habits and memory from the requested offset", async () => {
    const result = await reader().read({ monoId: "mono-1", section: "habits", offset: 0 });
    expect(result.habits?.items).toHaveLength(5);
    expect(result.habits?.nextOffset).toBe(5);
    expect(result.habits?.total).toBe(21);
    const memory = await reader().read({ monoId: "mono-1", section: "memory" });
    expect(memory.memory?.text).toContain("user likes tests");
    expect(memory.soul).toBeUndefined();
    expect(memory.habits).toBeUndefined();
  });

  it("uses shared child activity as presentation without inventing a parent approval", async () => {
    const idleParent = { ...session, busy: false, blocks: [] };
    const result = await reader(
      mono,
      idleParent,
      () => ({ status: "needs-you", activity: "Child task" }),
    ).read({ monoId: mono.id, section: "memory" });

    expect(result.mono).toMatchObject({
      status: "needs-you",
      statusLabel: "Needs you",
      busy: false,
      needsApproval: false,
    });
    expect(result.mono).not.toHaveProperty("activity");
  });

  it("pages only eligible linked sessions from the full Mono history with live states", async () => {
    const launch = (id: string, title: string) => ({ sessionId: id, cwd: "/work/app", title, harness: "claude" as const, model: "opus" });
    const historical = launch("working", "Historical working review");
    const input = { ...session, id: "input", title: "Needs an answer", blocks: [{ id: "approval", role: "tool" as const, text: "Approve", approval: { requestId: 2 } }] };
    const working = { ...session, id: "working", title: "Historical working review", busy: true, blocks: [] };
    const done = { ...session, id: "done", title: "Completed check", busy: false, blocks: [{ id: "done-prompt", role: "user" as const, text: "Run", durationMs: 4 }] };
    const unavailable = { ...session, id: "unavailable", title: "Private", busy: true, blocks: [] };
    const internal = { ...session, id: "internal", title: "Mono child", busy: true, blocks: [] };
    const parent = {
      ...session,
      busy: false,
      monoTranscript: { before: 7, firstBlockId: "tail" },
      blocks: [{ id: "tail", role: "user" as const, text: "Launch", monoSpawnedSessions: [launch(input.id, input.title), launch(done.id, done.title), launch(unavailable.id, unavailable.title), launch(internal.id, internal.title)] }],
    };
    getMonoTranscriptPage.mockResolvedValueOnce({ blocks: [{ id: "old", role: "user", text: "Launch", monoSpawnedSessions: [historical] }], before: null, hasNewer: false });
    const all = [parent, working, input, done, unavailable, internal] as Session[];
    const source = reader(mono, parent, undefined, {
      sessions: all,
      canChat: entry => entry.id !== unavailable.id,
      listable: entry => entry.id !== internal.id,
    });

    const first = await source.read({ monoId: mono.id, section: "sessions" });
    expect(getMonoTranscriptPage).toHaveBeenCalledWith(parent.id, { before: 7 });
    expect(first.sessions?.items).toEqual([
      { id: working.id, title: working.title, state: "working", statusLabel: "Working" },
      { id: input.id, title: input.title, state: "input", statusLabel: "Needs input" },
      { id: done.id, title: done.title, state: "done", statusLabel: "Done" },
    ]);
    expect(JSON.stringify(first.sessions)).not.toMatch(/Private|Mono child/);

    input.busy = false;
    input.blocks = [{ id: "input-done", role: "user", text: "Answer", durationMs: 3 }];
    const settled = await source.read({ monoId: mono.id, section: "sessions" });
    expect(settled.sessions?.items.find(item => item.id === input.id)?.state).toBe("done");
    all.splice(all.findIndex(entry => entry.id === working.id), 1);
    const removed = await source.read({ monoId: mono.id, section: "sessions" });
    expect(removed.sessions?.items.map(item => item.id)).not.toContain(working.id);
  });

  it("paginates linked sessions without falling back to the workspace-wide list", async () => {
    const parent = {
      ...session,
      busy: false,
      blocks: Array.from({ length: 51 }, (_, index) => ({
        id: `launch-${index}`, role: "user" as const, text: "Launch",
        monoSpawnedSessions: [{ sessionId: `child-${index}`, cwd: "/work/app", title: `Child ${index}`, harness: "claude" as const, model: "opus" }],
      })),
    };
    const children = Array.from({ length: 51 }, (_, index) => ({
      ...session, id: `child-${index}`, title: `Child ${index}`, busy: false,
      blocks: [{ id: `prompt-${index}`, role: "user" as const, text: "Run", durationMs: 1 }],
    }));
    const source = reader(mono, parent, undefined, { sessions: [parent, ...children] as Session[] });
    const first = await source.read({ monoId: mono.id, section: "sessions" });
    expect(first.sessions).toMatchObject({ offset: 0, total: 51, nextOffset: 50, truncated: true });
    expect(first.sessions?.items).toHaveLength(50);
    const last = await source.read({ monoId: mono.id, section: "sessions", offset: 50 });
    expect(last.sessions).toMatchObject({ offset: 50, total: 51, truncated: false });
    expect(last.sessions?.items).toEqual([{ id: "child-50", title: "Child 50", state: "done", statusLabel: "Done" }]);
  });

  it("marks oversized lines as content-truncated while keeping the response bounded", async () => {
    readAgentFile.mockImplementation(async (_id: string, path: string) => ({
      text: path === "SOUL.md" ? "x".repeat(30_000) : "",
      hash: "hash",
    }));
    const result = await reader().read({ monoId: "mono-1", section: "soul" });
    expect(result.soul).toMatchObject({ contentTruncated: true, truncated: true });
    expect(new TextEncoder().encode(result.soul?.text ?? "").length).toBeLessThanOrEqual(24 * 1024);
  });

  it("matches desktop Soul fallback without changing explicit empty files", async () => {
    const configuredMono = { ...mono, instructions: "Keep the release notes concise." };
    readAgentFile.mockImplementation(async (_id: string, path: string) => ({
      text: path === "SOUL.md" ? null : "",
      hash: "hash",
    }));
    const missing = await reader(configuredMono).read({ monoId: mono.id, section: "soul" });
    expect(missing.soul?.text).toContain("# Soul\n\n## Standing instructions\nKeep the release notes concise.");

    readAgentFile.mockImplementation(async (_id: string, path: string) => ({
      text: path === "SOUL.md" ? "" : "",
      hash: "hash",
    }));
    const empty = await reader(configuredMono).read({ monoId: mono.id, section: "soul" });
    expect(empty.soul?.text).toBe("");
  });

  it("rejects malformed or unknown Mono IDs before reading files", async () => {
    await expect(reader().read({ monoId: "../mono", section: "memory" })).rejects.toThrow("Invalid Mono ID");
    await expect(reader().read({ monoId: "missing", section: "memory" })).rejects.toThrow("not available");
    expect(readAgentFile).not.toHaveBeenCalled();
  });
});
