import { useEffect, useRef, useState } from "react";
import { HarnessIcon, HARNESS_ICONS } from "../../src/features/sessions/ui/HarnessIcon";
import type { HarnessId } from "../../src/features/sessions/model/session";
import type { CompanionSession, SessionConfiguration } from "./types";

type SettingsChange = { harness?: string; model?: string; runtimeMode?: string };
const providerName = (id: string) => id === "opencode" ? "OpenCode" : id.charAt(0).toUpperCase() + id.slice(1);
const Check = () => <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>;
const Chevron = () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>;

export function SessionSettings({ session, configuration, disabled, onApply }: {
  session: CompanionSession; configuration?: SessionConfiguration; disabled: boolean;
  onApply: (change: SettingsChange) => Promise<void>;
}) {
  const [open, setOpen] = useState<"model" | "access">();
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const applying = useRef(false);
  const restoreFocusPending = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const models = configuration?.models || [];
  const modes = configuration?.accessModes || [];
  const activeModel = models.find(model => model.harness === session.harness && model.id === session.model);
  const activeMode = modes.find(mode => mode.id === session.runtimeMode);
  const blocked = disabled || session.busy || !configuration || saving;
  const filtered = models.filter(model => `${model.label} ${model.id} ${providerName(model.harness)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const providers = [...new Set(filtered.map(model => model.harness))];

  function close(restoreFocus = false) {
    setOpen(undefined);
    if (restoreFocus) restoreFocusPending.current = true;
  }
  useEffect(() => {
    if (open || saving || !restoreFocusPending.current) return;
    restoreFocusPending.current = false;
    trigger.current?.focus({ preventScroll: true });
  }, [open, saving]);
  useEffect(() => {
    if (!open) return;
    if (open === "model") {
      const pointerFine = !window.matchMedia || window.matchMedia("(pointer: fine)").matches;
      if (!pointerFine) return;
      root.current?.querySelector<HTMLInputElement>('[aria-label="Search models"]')?.focus({ preventScroll: true });
      return;
    }
    const rows = root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)');
    const current = root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]:not(:disabled)');
    (current || rows?.[0])?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function show(kind: "model" | "access", button: HTMLButtonElement) {
    trigger.current = button;
    setQuery("");
    setError(undefined);
    setOpen(previous => previous === kind ? undefined : kind);
  }
  async function choose(change: SettingsChange, current: boolean) {
    if (blocked || applying.current) return;
    if (current) { close(true); return; }
    applying.current = true;
    setSaving(true);
    setError(undefined);
    try { await onApply(change); close(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change this setting"); }
    finally { applying.current = false; setSaving(false); }
  }

  return <div ref={root} className="session-settings" onKeyDown={event => {
    if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const rows = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)')];
      if (!rows.length) return;
      const index = rows.indexOf(document.activeElement as HTMLButtonElement);
      const next = index < 0 ? (event.key === "ArrowDown" ? 0 : rows.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      rows[next]?.focus();
    }
  }}>
    <button type="button" className="setting-trigger" onClick={event => show("model", event.currentTarget)} aria-expanded={open === "model"} aria-haspopup="dialog" disabled={blocked} title={!configuration ? "Update the Mac host to change settings" : session.busy ? "Change model when the agent is ready" : "Change model"}><span>{activeModel?.label || session.model}</span><Chevron /></button>
    <button type="button" className="setting-trigger setting-trigger--access" onClick={event => show("access", event.currentTarget)} aria-expanded={open === "access"} aria-haspopup="dialog" disabled={blocked} title="Change access mode"><svg width="12" height="14" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M6 1 11 3v4c0 3-5 6-5 6S1 10 1 7V3Z" /></svg><span>{activeMode?.label || session.runtimeMode || "Access"}</span><Chevron /></button>
    {open ? <section className="settings-picker" role="dialog" aria-label={open === "model" ? "Change model" : "Change access"} aria-busy={saving}>
      <div className="settings-picker__header">
        {open === "model" ? <label className="settings-picker__search"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input type="search" aria-label="Search models" placeholder="Search models…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} /></label> : <h3>Access</h3>}
        <button type="button" className="settings-picker__close" aria-label="Close settings" onClick={() => close(true)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
      </div>
      <div className="settings-picker__choices" role="menu" aria-label={open === "model" ? "Models" : "Access modes"}>
        {open === "model" ? providers.map(provider => <div role="group" aria-label={providerName(provider)} key={provider}>
          <div className="settings-picker__provider">{provider in HARNESS_ICONS ? <HarnessIcon harness={provider as HarnessId} className="picker-provider-icon" /> : null}{providerName(provider)}</div>
          {filtered.filter(model => model.harness === provider).map(model => {
            const current = model.harness === session.harness && model.id === session.model;
            return <button type="button" role="menuitemradio" aria-checked={current} className="settings-picker__option" key={model.id} disabled={blocked} onClick={() => void choose({ harness: model.harness, model: model.id }, current)}><span>{model.label}</span><span className="settings-picker__check">{current ? <Check /> : null}</span></button>;
          })}
        </div>) : modes.map(mode => {
          const current = mode.id === session.runtimeMode;
          return <button type="button" role="menuitemradio" aria-checked={current} className="settings-picker__option settings-picker__option--access" key={mode.id} disabled={blocked} onClick={() => void choose({ runtimeMode: mode.id }, current)}><span><strong>{mode.label}</strong>{mode.description ? <small>{mode.description}</small> : null}</span><span className="settings-picker__check">{current ? <Check /> : null}</span></button>;
        })}
        {open === "model" && !filtered.length ? <p className="settings-picker__empty">No matching models</p> : null}
      </div>
      {error ? <p className="settings-picker__error" role="alert">{error}</p> : null}
    </section> : null}
  </div>;
}
