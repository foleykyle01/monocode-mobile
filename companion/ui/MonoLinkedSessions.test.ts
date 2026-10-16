// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoLinkedSessions } from "./MonoLinkedSessions";
import type { CompanionClient } from "./client";
import type { CompanionMono, CompanionMonoLinkedSession } from "./types";

const mono: CompanionMono = {
  id: "scout", name: "Scout", mascot: "ghost", color: "#fff", projectIds: ["/app"],
  busy: false, needsApproval: false, canChat: true,
};

function sessions(count: number): CompanionMonoLinkedSession[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `child-${index}`, title: `Child ${index}`, state: "done" as const, statusLabel: "Done",
  }));
}

function result(items: readonly CompanionMonoLinkedSession[], requested = 0) {
  const offset = Math.min(requested, items.length);
  const end = Math.min(offset + 50, items.length);
  return { sessions: {
    items: items.slice(offset, end), offset, total: items.length,
    ...(end < items.length ? { nextOffset: end } : {}), truncated: end < items.length,
  } };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps every loaded page while refresh reorders and removes linked sessions", async () => {
  let values = sessions(55);
  const client = { monoRead: vi.fn(async (_id: string, _section?: string, offset = 0) => result(values, offset)) } as unknown as CompanionClient;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(MonoLinkedSessions, { client, mono, refreshToken: 0, onOpen: vi.fn(), onClose: vi.fn() })));
    await flush();
    expect(container.querySelectorAll(".mono-linked-sessions__body li")).toHaveLength(50);
    await act(async () => container.querySelector<HTMLButtonElement>(".mono-linked-sessions__more")!.click());
    await flush();
    expect(container.querySelectorAll(".mono-linked-sessions__body li")).toHaveLength(55);

    values = [{ ...values[52], state: "working", statusLabel: "Working" }, ...values.filter(item => item.id !== "child-52" && item.id !== "child-3")];
    await act(async () => root.render(createElement(MonoLinkedSessions, { client, mono, refreshToken: 1, onOpen: vi.fn(), onClose: vi.fn() })));
    await flush();
    const rows = [...container.querySelectorAll<HTMLButtonElement>(".mono-linked-sessions__body li > button")];
    expect(rows).toHaveLength(54);
    expect(rows[0].textContent).toBe("Child 52Working");
    expect(new Set(rows.map(row => row.getAttribute("aria-label"))).size).toBe(54);
    expect(rows.some(row => row.getAttribute("aria-label")?.startsWith("Open Child 3 ·"))).toBe(false);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it("queues a refresh behind Show more and recovers a server-clamped page", async () => {
  const initial = sessions(55);
  let values = initial;
  let resolveAppend!: (value: ReturnType<typeof result>) => void;
  const client = { monoRead: vi.fn((_id: string, _section?: string, offset = 0) => {
    if (offset === 50 && values === initial) return new Promise<ReturnType<typeof result>>(resolve => { resolveAppend = resolve; });
    return Promise.resolve(result(values, offset));
  }) } as unknown as CompanionClient;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(MonoLinkedSessions, { client, mono, refreshToken: 0, onOpen: vi.fn(), onClose: vi.fn() })));
    await flush();
    await act(async () => container.querySelector<HTMLButtonElement>(".mono-linked-sessions__more")!.click());
    values = initial.slice(0, 45);
    await act(async () => root.render(createElement(MonoLinkedSessions, { client, mono, refreshToken: 1, onOpen: vi.fn(), onClose: vi.fn() })));
    await act(async () => resolveAppend(result(values, 50)));
    await flush();
    const rows = [...container.querySelectorAll<HTMLButtonElement>(".mono-linked-sessions__body li > button")];
    expect(rows).toHaveLength(45);
    expect(new Set(rows.map(row => row.getAttribute("aria-label"))).size).toBe(45);
    expect(container.querySelector(".error-copy")).toBeNull();
    expect((client.monoRead as ReturnType<typeof vi.fn>).mock.calls.map((call: unknown[]) => call[2])).toEqual(expect.arrayContaining([0, 50]));
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it("explains when an older host omits the sessions projection", async () => {
  const client = { monoRead: vi.fn(async () => ({ mono, scope: { projects: [] } })) } as unknown as CompanionClient;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(MonoLinkedSessions, { client, mono, refreshToken: 0, onOpen: vi.fn(), onClose: vi.fn() })));
    await flush();
    expect(container.querySelector(".error-copy")?.textContent).toContain("Update MonoCode on your Mac");
  } finally { await act(async () => root.unmount()); container.remove(); }
});
