import { ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader, RefreshCw, Trash2 } from "../../../shared/ui/icons";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";

export const COMPANION_SPIKE_BUILD =
  import.meta.env.VITE_MONOCODE_COMPANION_SPIKE === "1";

type Device = { id: string };
type Invitation = { expiresAt: number };
type Status = {
  available: boolean;
  running: boolean;
  hostId?: string;
  devices: Device[];
  invitation?: Invitation;
};

type Invite = Status & { qrDataUrl: string; expiresAt: number };

const primary =
  "rounded-lg bg-selection px-3 py-2 text-[12px] font-medium text-content hover:bg-selection-hover disabled:cursor-default disabled:opacity-40";

function readableError(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function until(expiresAt: number, now: number) {
  const seconds = Math.max(0, Math.ceil(expiresAt - now / 1000));
  if (!seconds) return "Expired";
  return `Expires in ${Math.ceil(seconds / 60)} min`;
}

/** Shown only by the isolated companion development build. */
export function CompanionSettings() {
  const alive = useRef(true);
  const [status, setStatus] = useState<Status>();
  const [qrDataUrl, setQrDataUrl] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const busyRef = useRef(false);
  const refreshRequest = useRef<Promise<void> | undefined>(undefined);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    if (refreshRequest.current) return refreshRequest.current;
    const expectedRevision = revision.current;
    const request = invoke<Status>("companion_network_status")
      .then((next) => {
        if (!alive.current || revision.current !== expectedRevision) return;
        setStatus(next);
        if (!next.invitation) setQrDataUrl(undefined);
      })
      .catch((reason) => {
        if (alive.current && revision.current === expectedRevision)
          setError(readableError(reason));
      })
      .finally(() => {
        if (refreshRequest.current === request)
          refreshRequest.current = undefined;
      });
    refreshRequest.current = request;
    return request;
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!status?.invitation) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [refresh, status?.invitation]);

  const request = async <T,>(command: string, args?: Record<string, unknown>) => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    revision.current += 1;
    setBusy(true);
    setError("");
    try {
      return await invoke<T>(command, args);
    } catch (reason) {
      if (alive.current) setError(readableError(reason));
      return undefined;
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const toggle = async () => {
    if (status?.running) {
      const next = await request<Status>("companion_network_stop");
      if (next) {
        setStatus(next);
        setQrDataUrl(undefined);
      }
      return;
    }
    const next = await request<Status>("companion_network_start");
    if (next) setStatus(next);
  };

  const invite = async () => {
    const next = await request<Invite>("companion_network_invite");
    if (!next) return;
    setStatus(next);
    setQrDataUrl(next.qrDataUrl);
    setNow(Date.now());
  };

  const cancelInvite = async () => {
    const next = await request<Status>("companion_network_cancel_invite");
    if (next) {
      setStatus(next);
      setQrDataUrl(undefined);
    }
  };

  const revoke = async (device: Device) => {
    const accepted = await ask(
      "This phone will lose access immediately. You can pair it again later.",
      { title: "Revoke this phone?", kind: "warning", okLabel: "Revoke" },
    );
    if (!accepted) return;
    const next = await request<Status>("companion_network_revoke", {
      deviceId: device.id,
    });
    if (next) setStatus(next);
  };

  // Ordinary MonoCode builds deliberately have no discoverable companion UI.
  if (status && !status.available) return null;
  if (!status) {
    return (
      <section data-setting-id="companion-access" className="pt-8">
        <div className="overflow-hidden rounded-xl border border-content/10 bg-content/3 px-4 py-4">
          {error ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p role="alert" className="text-[12px] text-red-300">{error}</p>
              <SecondaryButton onClick={() => void refresh()}>Try again</SecondaryButton>
            </div>
          ) : (
            <span className="flex items-center gap-2 text-[12px] text-content/45">
              <Loader className="size-3.5 animate-spin" /> Checking phone companion…
            </span>
          )}
        </div>
      </section>
    );
  }

  const expiry = status.invitation?.expiresAt;
  return (
    <section id="setting-companion-access" data-setting-id="companion-access" className="pt-8">
      <div className="flex items-end gap-4 pb-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-content">Phone companion</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            Pair your iPhone to view and control the sessions already open on this Mac.
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh phone companion status"
          disabled={busy}
          onClick={() => void refresh()}
          className="rounded-md p-1.5 text-content/50 hover:bg-content/10 hover:text-content disabled:opacity-40"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-content/10 bg-content/3">
        <div className="settings-row flex items-start gap-6 border-b border-content/5 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-content">Remote access</div>
            <p className="mt-1 text-[12px] leading-relaxed text-content/45">
              {status.running
                ? "Your paired phones can reach this MonoCode instance while it stays open."
                : "Off. No phone can reach this Mac until you turn it on. Turn it on to manage paired phones."}
            </p>
          </div>
          <div className="settings-row-control flex shrink-0 items-center">
            <button
              type="button"
              role="switch"
              aria-label="Remote phone access"
              aria-checked={status.running}
              disabled={busy}
              onClick={() => void toggle()}
              className={`relative h-5 w-9 rounded-full transition-colors disabled:cursor-default disabled:opacity-40 ${
                status.running ? "bg-accent" : "bg-content/20"
              }`}
            >
              <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${status.running ? "left-4.5" : "left-0.5"}`} />
            </button>
          </div>
        </div>

        {status.running ? (
          <div className="border-b border-content/5 px-4 py-4 last:border-b-0">
            {qrDataUrl && expiry ? (
              <div className="flex flex-wrap items-center gap-4">
                <img
                  src={qrDataUrl}
                  alt="Scan this QR code in MonoCode Companion to pair this phone"
                  className="size-60 rounded-lg border border-content/10 bg-white p-2"
                />
                <div className="min-w-48 flex-1">
                  <div className="text-[13px] font-medium text-content">Ready to pair</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-content/45">
                    Open MonoCode Companion on your phone, choose Scan QR ticket, and scan this code. {until(expiry, now)}.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <SecondaryButton disabled={busy} onClick={() => void invite()}>
                      <RefreshCw className="size-3.5" /> Regenerate
                    </SecondaryButton>
                    <SecondaryButton danger disabled={busy} onClick={() => void cancelInvite()}>
                      Cancel
                    </SecondaryButton>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-content">Pair a phone</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-content/45">
                    Create a five-minute QR code for MonoCode Companion.
                  </p>
                </div>
                <button className={primary} disabled={busy} onClick={() => void invite()}>
                  {busy ? <Loader className="mr-1 inline size-3.5 animate-spin" /> : null}
                  Show QR code
                </button>
              </div>
            )}
          </div>
        ) : null}

        {status.running && status.devices.length ? (
          <div className="divide-y divide-content/5">
            <div className="px-4 py-2.5 text-[12px] font-medium text-content/60">Paired phones</div>
            {status.devices.map((device) => (
              <div key={device.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-content">Paired phone</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-content/40">{device.id}</div>
                </div>
                <SecondaryButton danger disabled={busy} onClick={() => void revoke(device)}>
                  <Trash2 className="size-3.5" /> Revoke
                </SecondaryButton>
              </div>
            ))}
          </div>
        ) : null}
        {error ? <p role="alert" className="border-t border-red-400/20 bg-red-400/5 px-4 py-3 text-[12px] text-red-300">{error}</p> : null}
      </div>
    </section>
  );
}
