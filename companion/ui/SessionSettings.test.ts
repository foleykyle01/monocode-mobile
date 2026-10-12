// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionSettings } from "./SessionSettings";
import type { CompanionSession, SessionConfiguration } from "./types";

it("groups and filters models, applies a row directly, and blocks configuration during a turn", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onApply = vi.fn(async () => {});
  const session: CompanionSession = { id: "mono", title: "Scout", cwd: "/app", harness: "claude", model: "opus", runtimeMode: "supervised", busy: false, needsApproval: false, turn: 1 };
  const configuration: SessionConfiguration = { models: [{ harness: "claude", id: "opus", label: "Opus" }, { harness: "codex", id: "gpt", label: "GPT" }], accessModes: [{ id: "supervised", label: "Supervised" }, { id: "autonomous", label: "Autonomous", description: "May edit files without asking." }] };
  const render = async (busy = false) => act(async () => root.render(createElement(SessionSettings, { session: { ...session, busy }, configuration, disabled: false, onApply })));
  const option = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent?.startsWith(label))!;
  try {
    await render();
    const modelTrigger = container.querySelector<HTMLButtonElement>(".setting-trigger")!;
    await act(async () => modelTrigger.click());
    expect(option("Opus").getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[role="group"][aria-label="Codex"]')).not.toBeNull();
    const search = container.querySelector<HTMLInputElement>('[aria-label="Search models"]')!;
    expect(document.activeElement).toBe(search);
    await act(async () => search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(document.activeElement).toBe(option("GPT"));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "codex");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(option("Opus")).toBeUndefined();
    expect(onApply).not.toHaveBeenCalled();
    await act(async () => option("GPT").click());
    expect(onApply).toHaveBeenCalledWith({ harness: "codex", model: "gpt" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(modelTrigger);
    const accessTrigger = container.querySelector<HTMLButtonElement>(".setting-trigger--access")!;
    await act(async () => accessTrigger.click());
    expect(document.activeElement).toBe(option("Supervised"));
    expect(container.textContent).toContain("May edit files without asking.");
    await render(true);
    expect(option("Autonomous").disabled).toBe(true);
    await act(async () => option("Autonomous").click());
    expect(onApply).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});

it("keeps a failed change open, ignores duplicate clicks, and restores focus only for intentional dismissal", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const outside = document.createElement("button");
  document.body.append(container, outside);
  const root = createRoot(container);
  let rejectApply!: (reason?: unknown) => void;
  const onApply = vi.fn(() => new Promise<void>((_, reject) => { rejectApply = reject; }));
  const session: CompanionSession = { id: "mono", title: "Scout", cwd: "/app", harness: "claude", model: "opus", runtimeMode: "supervised", busy: false, needsApproval: false, turn: 1 };
  const configuration: SessionConfiguration = { models: [{ harness: "claude", id: "opus", label: "Opus" }, { harness: "codex", id: "gpt", label: "GPT" }], accessModes: [{ id: "supervised", label: "Supervised" }] };
  try {
    await act(async () => root.render(createElement(SessionSettings, { session, configuration, disabled: false, onApply })));
    const trigger = container.querySelector<HTMLButtonElement>(".setting-trigger")!;
    await act(async () => trigger.click());
    const gpt = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent?.startsWith("GPT"))!;
    await act(async () => { gpt.click(); gpt.click(); });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => rejectApply(new Error("Host rejected the change")));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Host rejected the change");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLDivElement>(".session-settings")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    outside.focus();
    await act(async () => outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
  } finally { await act(async () => root.unmount()); container.remove(); outside.remove(); vi.unstubAllGlobals(); }
});
