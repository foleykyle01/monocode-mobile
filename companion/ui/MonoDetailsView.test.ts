// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MonoDetailsView } from "./MonoDetailsView";
import type { CompanionClient } from "./client";
import type { CompanionMono, CompanionMonoRead, CompanionProject } from "./types";

const projects: CompanionProject[] = [
  { id: "app", name: "Companion", path: "/work/companion" },
  { id: "web", name: "Website", path: "/work/website" },
];
const mono: CompanionMono = {
  id: "scout", name: "Scout", mascot: "ghost", color: "#459bf7", projectIds: ["app"],
  status: "working", statusLabel: "Working", activity: "Reviewing companion changes",
  busy: true, needsApproval: false,
};
const first: CompanionMonoRead & { epoch: string } = {
  epoch: "one", mono, scope: { projects: [{ id: "app", name: "Companion" }] },
  model: { harness: "claude", id: "opus", label: "Claude Opus", settings: { thinking: "high" } },
  access: { id: "supervised", label: "Supervised" },
  soul: { text: "# Soul\n\nKeep the project tidy.", offset: 0, totalLines: 4, nextOffset: 4, truncated: true },
  memory: { text: "- Changes stay read-only.", offset: 0, totalLines: 1, truncated: false },
  habits: { items: [{ id: "morning", name: "Morning review", instructions: "Check open pull requests.", schedule: { scheduleKind: "daily", minute: 0, time: "09:00", dayOfWeek: 1 }, enabled: true, createdAt: 1, nextRunAt: 2, lastRunAt: 1, lastOutcome: "posted", runs: [{ at: 1, durationMs: 2_000, outcome: "posted", report: "No regressions found." }] }], offset: 0, total: 1, truncated: false },
};

function client(read: ReturnType<typeof vi.fn>) {
  return { monoRead: read } as unknown as CompanionClient;
}

describe("MonoDetailsView", () => {
  it("loads the desktop Mono state, scope, configuration, and read-only content", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const read = vi.fn(async () => first);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(MonoDetailsView, { client: client(read), mono, projects, onBack: vi.fn() })));
      expect(read).toHaveBeenCalledWith("scout");
      expect(container.textContent).toContain("Working");
      expect(container.textContent).toContain("Reviewing companion changes");
      expect(container.textContent).toContain("Companion");
      expect(container.textContent).not.toContain("Website");
      expect(container.textContent).toContain("Claude Opus");
      expect(container.textContent).toContain("thinking");
      expect(container.textContent).toContain("high");
      expect(container.textContent).toContain("Supervised");
      expect(container.textContent).toContain("Morning review");
      expect(container.textContent).toContain("Keep the project tidy.");
      expect(container.querySelector("textarea")).toBeNull();
    } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
  });

  it("appends paged Soul content and keeps a compact back button", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const read = vi.fn(async (_id: string, section?: string) => section === "soul"
      ? { ...first, soul: { text: "More standing context.", offset: 4, totalLines: 5, truncated: false } }
      : first);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onBack = vi.fn();
    try {
      await act(async () => root.render(createElement(MonoDetailsView, { client: client(read), mono, projects, onBack })));
      await act(async () => container.querySelector<HTMLButtonElement>(".mono-details-more")!.click());
      expect(read).toHaveBeenLastCalledWith("scout", "soul", 4);
      expect(container.textContent).toContain("More standing context.");
      const back = container.querySelector<HTMLButtonElement>(".back-button")!;
      expect(back.getAttribute("aria-label")).toBe("Back to workspace");
      await act(async () => back.click());
      expect(onBack).toHaveBeenCalledOnce();
    } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
  });

  it("does not merge a page from a changed desktop epoch", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const read = vi.fn(async (_id: string, section?: string) => section === "soul"
      ? { ...first, epoch: "two", soul: { text: "Stale content.", offset: 4, totalLines: 5, truncated: false } }
      : first);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(MonoDetailsView, { client: client(read), mono, projects, onBack: vi.fn() })));
      await act(async () => container.querySelector<HTMLButtonElement>(".mono-details-more")!.click());
      expect(container.textContent).not.toContain("Stale content.");
      expect(container.textContent).toContain("Mono changed on your Mac");
    } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
  });
});
