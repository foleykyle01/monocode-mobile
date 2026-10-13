// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_PHONE_NOTIFICATIONS, usePhoneNotifications } from "./phoneNotifications";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("does not call native notification commands while the release flag is off", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  vi.useFakeTimers();
  const root = createRoot(document.createElement("div"));
  let notifications: ReturnType<typeof usePhoneNotifications>;
  function Native() {
    notifications = usePhoneNotifications(false, "host", "session", vi.fn());
    return null;
  }
  try {
    await act(async () => root.render(createElement(Native)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
      document.dispatchEvent(new Event("visibilitychange"));
      await notifications.save({ ...DEFAULT_PHONE_NOTIFICATIONS, enabled: true });
      await notifications.openSettings();
    });
    expect(invoke).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks();
  }
});
