import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { createCompanionMonoReader } from "./companionMono";

const readAgentFile = vi.hoisted(() => vi.fn());
vi.mock("../../monos/model/monoFiles", () => ({
  readAgentFile,
  defaultSoul: (instructions?: string) => `# Soul\n\n## Standing instructions\n${instructions?.trim() || "- (Add anything it should always keep in mind.)"}\n`,
}));

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
) {
  return createCompanionMonoReader({
    monos: () => [currentMono],
    sessions: () => [currentSession],
    navigation: () => ({ projects: [{ id: "/work/app", name: "App", path: "/work/app/" }] }),
    activityState,
    configuration: () => ({
      models: [{ harness: "claude", id: "opus", label: "Opus" }],
      accessModes: [{ id: "supervised", label: "Supervised", description: "Ask first" }],
    }),
  });
}

beforeEach(() => {
  readAgentFile.mockClear();
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
