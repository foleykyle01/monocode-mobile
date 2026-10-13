// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { NotificationSettings } from "./NotificationSettings";
import { DEFAULT_PHONE_NOTIFICATIONS, usePhoneNotifications } from "./phoneNotifications";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./features", () => ({ PHONE_NOTIFICATIONS_ENABLED: true }));

it("retains a cold-launch notification until the paired host loads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const target = { hostId: "host", sessionId: "session", eventId: "event" };
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === "companion_push_target") return target as never;
    if (command === "companion_notification_status") return { preferences: DEFAULT_PHONE_NOTIFICATIONS, permission: "granted", configured: true, registered: true } as never;
    return undefined as never;
  });
  const onTarget = vi.fn();
  const root = createRoot(document.createElement("div"));
  function Native({ hostId }: { hostId?: string }) { usePhoneNotifications(false, hostId, undefined, onTarget); return null; }
  try {
    await act(async () => root.render(createElement(Native)));
    expect(onTarget).not.toHaveBeenCalled();
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "companion_push_clear_target")).toBe(false);
    await act(async () => root.render(createElement(Native, { hostId: "host" })));
    expect(onTarget).toHaveBeenCalledWith(target);
    expect(invoke).toHaveBeenCalledWith("companion_push_clear_target", { eventId: "event" });
  } finally { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.mocked(invoke).mockReset(); }
});

it("keeps category preferences across opt-out and opt-in in the preview", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  function Preview() { return createElement(NotificationSettings, { notifications: usePhoneNotifications(true, "host", undefined, () => {}), demo: true }); }
  const toggle = (name: string) => container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!;
  try {
    await act(async () => root.render(createElement(Preview)));
    expect(toggle("Session finished").disabled).toBe(true);
    await act(async () => toggle("Notify this iPhone").click());
    expect(toggle("Session finished").disabled).toBe(false);
    await act(async () => toggle("Session finished").click());
    await act(async () => toggle("Notify this iPhone").click());
    await act(async () => toggle("Notify this iPhone").click());
    expect(toggle("Session finished").checked).toBe(false);
    expect(toggle("Needs approval").checked).toBe(true);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("does not pretend notification setup is ready or permission has been granted", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const openSettings = vi.fn(async () => {});
  try {
    await act(async () => root.render(createElement(NotificationSettings, { demo: false, notifications: {
      state: { preferences: DEFAULT_PHONE_NOTIFICATIONS, permission: "denied", configured: false, registered: false },
      saving: false, error: undefined, save: vi.fn(), openSettings,
    } })));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Notify this iPhone"]')!.disabled).toBe(true);
    expect(container.textContent).toContain("not available in this build");
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(openSettings).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
