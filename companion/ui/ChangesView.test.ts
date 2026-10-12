// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { CompanionClient } from "./client";
import { ChangesView } from "./ChangesView";

const project = { id: "project", name: "Phone", path: "/work/phone" };
const sessions = [{
  id: "session", title: "Build companion", cwd: "/work/phone",
  harness: "codex", model: "gpt", busy: false, needsApproval: false, turn: 0,
}];

function list() {
  return {
    epoch: "epoch-1", branch: "main", head: "head", additions: 1, deletions: 0,
    revision: "revision-1",
    files: [{ relative: "src/app.ts", status: "modified", additions: 1, deletions: 0, staged: false, unstaged: true }],
  };
}

function read(revision = "revision-1") {
  return {
    epoch: "epoch-1", revision, relative: "src/app.ts", kind: "unstaged" as const, status: "modified",
    original: "before\n", current: "after\n", binary: false, tooLarge: false, truncated: false,
  };
}

describe("ChangesView", () => {
  it.each(["button", "swipe"])("lists project changes, reads a unified file diff, and returns with %s", async navigation => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const onBack = vi.fn();
    const client = {
      changesList: vi.fn(async () => list()),
      changesRead: vi.fn(async () => read()),
    } as unknown as CompanionClient;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(ChangesView, {
        client, project, sessions, sessionId: "session", disabled: false, onBack,
      })));
      await act(async () => {});
      expect(container.textContent).toContain("Changes1");
      await act(async () => container.querySelector<HTMLButtonElement>(".changed-file")!.click());
      expect(client.changesRead).toHaveBeenCalledWith({ projectId: "project", sessionId: "session" }, "src/app.ts", "unstaged");
      expect(container.querySelector(".changes-diff")?.textContent).toContain("before");
      expect(container.querySelector(".changes-file-action")).toBeNull();
      expect(container.querySelector(".changes-commit")).toBeNull();
      await act(async () => {
        if (navigation === "button") container.querySelector<HTMLButtonElement>('[aria-label="Back to changes"]')!.click();
        else for (const [type, x] of [["touchstart", 8], ["touchmove", 130], ["touchend", 150]] as const) {
          const point = { identifier: 1, clientX: x, clientY: 200 };
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : [point] }, changedTouches: { value: [point] } });
          container.querySelector(".changes-diff")!.dispatchEvent(event);
        }
      });
      expect(container.querySelector(".changed-file")).not.toBeNull();
      expect(onBack).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it("shows the current selected diff when unrelated workspace changes update the list revision", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const client = {
      changesList: vi.fn(async () => list()),
      changesRead: vi.fn(async () => read("new-revision")),
    } as unknown as CompanionClient;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(ChangesView, {
        client, project, sessions, disabled: false, onBack: vi.fn(),
      })));
      await act(async () => {});
      await act(async () => container.querySelector<HTMLButtonElement>(".changed-file")!.click());
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.querySelector(".changes-diff")?.textContent).toContain("before");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("drops a file response from a previous desktop epoch", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const client = {
      changesList: vi.fn(async () => list()),
      changesRead: vi.fn(async () => ({ ...read(), epoch: "epoch-2" })),
    } as unknown as CompanionClient;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(ChangesView, {
        client, project, sessions, disabled: false, onBack: vi.fn(),
      })));
      await act(async () => {});
      await act(async () => container.querySelector<HTMLButtonElement>(".changed-file")!.click());
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Changes changed on your Mac");
      expect(container.querySelector(".changes-diff")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("shows the offline read-only state without enabling remote reads", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const client = {
      changesList: vi.fn(async () => list()),
      changesRead: vi.fn(async () => read()),
    } as unknown as CompanionClient;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(ChangesView, {
        client, project, sessions, disabled: true, onBack: vi.fn(),
      })));
      await act(async () => {});
      const file = container.querySelector<HTMLButtonElement>(".changed-file")!;
      expect(file.disabled).toBe(true);
      await act(async () => file.click());
      expect(client.changesRead).not.toHaveBeenCalled();
      expect(container.textContent).toContain("Reconnect to refresh these changes.");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
