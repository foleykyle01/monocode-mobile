// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import { getMonoTranscriptPage } from "../../sessions/data/sessionStore";
import { createMono, monosSnapshot, saveMonoSessionId } from "../model/mono";
import { monoActivitySessions } from "../model/monoActivityState";
import { MonoRailSection } from "../../../app/shell/MonoRailSection";
import { useMonoActivityStates } from "./useMonoActivityStates";

const native = vi.hoisted(() => ({
  emit: vi.fn(),
  listen: vi.fn(),
  windows: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: native.emit,
  listen: native.listen,
  TauriEvent: { WINDOW_DESTROYED: "destroyed" },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
  getAllWindows: native.windows,
}));
vi.mock("../../sessions/data/sessionStore", () => ({
  getMonoTranscriptPage: vi.fn(),
}));

let root: Root;
let container: HTMLElement;
let callbacks: Map<string, (event: { payload: unknown }) => void>;
let parent: Session;
let child: Session;
let roster: string;
function Harness({ sessions }: { sessions: Session[] }) {
  const states = useMonoActivityStates(sessions, roster);
  return createElement(MonoRailSection, {
    states,
    onOpen: () => {},
    onCreate: () => {},
    onDelete: () => {},
  });
}
const status = () =>
  container
    .querySelector("[data-mono-status]")
    ?.getAttribute("data-mono-status");
const render = async (sessions: Session[]) => {
  await act(async () => root.render(createElement(Harness, { sessions })));
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const mono = createMono();
  saveMonoSessionId(mono.id, "parent");
  roster = monosSnapshot();
  child = { ...newSession("codex", "/repo", "gpt-6"), id: "child", busy: true };
  parent = {
    ...newSession("codex", "/repo"),
    id: "parent",
    blocks: [
      {
        id: "turn",
        role: "user",
        text: "Work",
        monoSpawnedSessions: [
          {
            sessionId: child.id,
            cwd: child.cwd,
            title: child.title,
            harness: child.harness,
            model: child.model,
          },
        ],
      },
    ],
  };
  callbacks = new Map();
  native.emit.mockReset().mockResolvedValue(undefined);
  native.listen.mockReset().mockImplementation(async (name, callback) => {
    callbacks.set(name, callback);
    return () => callbacks.delete(name);
  });
  native.windows
    .mockReset()
    .mockResolvedValue([{ label: "main" }, { label: "other" }]);
  vi.mocked(getMonoTranscriptPage)
    .mockReset()
    .mockResolvedValue({ blocks: [], before: null, hasNewer: false });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("updates an unselected Mono from child commits without opening details or changing parent busy", async () => {
  await render([parent, child]);
  expect(status()).toBe("working");
  expect(container.querySelector('[aria-current="true"]')).toBeNull();
  expect(container.querySelector('[aria-label*="Working"]')).not.toBeNull();
  expect(
    container.querySelector(".motion-safe\\:animate-pulse"),
  ).not.toBeNull();
  await render([
    parent,
    { ...child, pendingQuestion: { requestId: 4, questions: [] } },
  ]);
  expect(status()).toBe("needs-you");
  await render([parent, { ...child, busy: false }]);
  expect(status()).toBe("idle");
  await render([parent, child]);
  await render([parent]);
  expect(status()).toBe("idle");
  expect(parent.busy).toBeUndefined();
  expect(getMonoTranscriptPage).not.toHaveBeenCalled();
});

it("recovers paged associations once while another project is open", async () => {
  vi.mocked(getMonoTranscriptPage)
    .mockResolvedValueOnce({ blocks: [], before: 5, hasNewer: true })
    .mockResolvedValueOnce({
      blocks: parent.blocks,
      before: null,
      hasNewer: true,
    });
  const paged = {
    ...parent,
    blocks: [],
    monoTranscript: { before: 15, firstBlockId: "latest" },
  };
  await render([paged, child]);
  expect(status()).toBe("working");
  expect(getMonoTranscriptPage).toHaveBeenNthCalledWith(1, "parent", {
    before: 15,
  });
  expect(getMonoTranscriptPage).toHaveBeenNthCalledWith(2, "parent", {
    before: 5,
  });
  native.emit.mockClear();
  await render([
    paged,
    {
      ...child,
      blocks: [
        { id: "reply", role: "assistant", text: "Streaming", streaming: true },
      ],
    },
  ]);
  native.emit.mockClear();
  await render([
    paged,
    {
      ...child,
      blocks: [
        {
          id: "reply",
          role: "assistant",
          text: "Streaming more",
          streaming: true,
        },
      ],
    },
  ]);
  expect(getMonoTranscriptPage).toHaveBeenCalledTimes(2);
  expect(native.emit).not.toHaveBeenCalled();
  expect(status()).toBe("working");
});

it("uses saved links for an unopened parent and live child state from another owner", async () => {
  vi.mocked(getMonoTranscriptPage).mockResolvedValue({
    blocks: parent.blocks,
    before: null,
    hasNewer: false,
  });
  await render([]);
  expect(status()).toBe("idle");
  const remote = (sessions: Session[]) =>
    callbacks.get("mono_activity_changed")!({
      payload: {
        owner: "other",
        snapshot: { sessions: monoActivitySessions(sessions), children: {} },
      },
    });
  await act(async () => remote([child]));
  expect(status()).toBe("working");
  await act(async () => remote([{ ...child, busy: false, usageLimit: {} }]));
  expect(status()).toBe("needs-you");
  await act(async () => remote([]));
  expect(status()).toBe("idle");
  await act(async () => remote([child]));
  native.windows.mockResolvedValue([{ label: "main" }]);
  await act(async () => callbacks.get("destroyed")!({ payload: undefined }));
  expect(status()).toBe("idle");
});

it("keeps current links usable when old history is unavailable", async () => {
  vi.mocked(getMonoTranscriptPage).mockRejectedValue(new Error("Unavailable"));
  await render([
    { ...parent, monoTranscript: { before: 10, firstBlockId: "turn" } },
    child,
  ]);
  expect(status()).toBe("working");
});
