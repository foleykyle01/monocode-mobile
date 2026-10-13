import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { PHONE_NOTIFICATIONS_ENABLED } from "./features";

export type PhoneNotificationPreferences = { enabled: boolean; finished: boolean; approval: boolean; question: boolean; sound: boolean };
export type PhoneNotificationState = {
  preferences: PhoneNotificationPreferences;
  permission: "prompt" | "granted" | "denied" | "unsupported";
  configured: boolean;
  registered: boolean;
  error?: string;
};
export type NotificationTarget = { hostId: string; sessionId: string; eventId: string };
export const DEFAULT_PHONE_NOTIFICATIONS: PhoneNotificationPreferences = { enabled: false, finished: true, approval: true, question: true, sound: true };

export function usePhoneNotifications(demo: boolean, hostId: string | undefined, visibleSession: string | undefined, onTarget: (target: NotificationTarget) => void) {
  const [state, setState] = useState<PhoneNotificationState>({ preferences: DEFAULT_PHONE_NOTIFICATIONS, permission: demo ? "prompt" : "unsupported", configured: demo, registered: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const savingRef = useRef(false);
  const saveVersion = useRef(0);
  const targetCallback = useRef(onTarget);
  targetCallback.current = onTarget;
  const previewState = useRef(state);
  previewState.current = state;

  useEffect(() => {
    if (!PHONE_NOTIFICATIONS_ENABLED || demo || !("__TAURI_INTERNALS__" in window)) return;
    let live = true;
    let running = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || savingRef.current || running) return;
      running = true;
      const version = saveVersion.current;
      try {
        const next = await invoke<PhoneNotificationState>("companion_notification_status");
        if (live && !savingRef.current && saveVersion.current === version) setState(next);
        const target = await invoke<NotificationTarget | null>("companion_push_target");
        if (live && target && hostId) {
          // On cold launch the pairing loads after this hook. Retain the tap until it does.
          // A notification from a forgotten Mac must never navigate the current pairing.
          if (target.hostId === hostId) targetCallback.current(target);
          await invoke("companion_push_clear_target", { eventId: target.eventId });
        }
      } catch (reason) {
        if (live) setError(typeof reason === "string" ? reason : "Could not check notifications. Try again in Settings.");
      } finally { running = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => { live = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [demo, hostId]);

  useEffect(() => {
    if (!PHONE_NOTIFICATIONS_ENABLED || demo || !("__TAURI_INTERNALS__" in window)) return;
    const update = () => { void invoke("companion_push_visible", { hostId, sessionId: document.visibilityState === "visible" ? visibleSession : null }).catch(() => {}); };
    update();
    document.addEventListener("visibilitychange", update);
    return () => { document.removeEventListener("visibilitychange", update); };
  }, [demo, hostId, visibleSession]);

  const save = useCallback(async (preferences: PhoneNotificationPreferences) => {
    if (!PHONE_NOTIFICATIONS_ENABLED || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(undefined);
    ++saveVersion.current;
    try {
      const next = demo ? { ...previewState.current, preferences, permission: "granted" as const, registered: preferences.enabled } : await invoke<PhoneNotificationState>("companion_notification_save", { preferences });
      setState(next);
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "Could not save notification settings. Try again.");
    } finally { savingRef.current = false; setSaving(false); }
  }, [demo]);

  const openSettings = async () => {
    if (!PHONE_NOTIFICATIONS_ENABLED) return;
    try { await invoke("companion_push_open_settings"); }
    catch { setError("Open iPhone Settings → Notifications → MonoCode Companion."); }
  };
  return { state, saving, error, save, openSettings };
}
