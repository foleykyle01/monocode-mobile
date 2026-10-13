import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Claim only after the control listener is ready; native code protects a live owner. */
export function registerCompanionOwner(controlReady: Promise<unknown>) {
  let disposed = false;
  const claim = () => {
    void controlReady.then(() => {
      if (!disposed) return invoke("companion_enable");
    }).catch(console.error);
  };
  const listening = listen("monocode-companion-owner-needed", claim);
  void listening.then(claim).catch(console.error);
  return () => {
    disposed = true;
    void listening.then(unlisten => unlisten()).catch(console.error);
  };
}
