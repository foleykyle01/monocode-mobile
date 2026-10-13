import type { PhoneNotificationPreferences, usePhoneNotifications } from "./phoneNotifications";

export function NotificationSettings({ notifications, demo }: { notifications: ReturnType<typeof usePhoneNotifications>; demo: boolean }) {
  const { state, saving, error, save, openSettings } = notifications;
  const toggle = (key: keyof PhoneNotificationPreferences, label: string, description: string, disabled = false) => (
    <label className="notification-setting" key={key}>
      <span><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" role="switch" aria-label={label} checked={state.preferences[key]} disabled={saving || disabled} onChange={event => void save({ ...state.preferences, [key]: event.target.checked })} />
    </label>
  );
  return <section className="workspace-settings__section" aria-label="Notifications">
    <h3>Notifications</h3>
    {toggle("enabled", "Notify this iPhone", "Updates from your paired Mac, even when the app is closed.", !state.configured || state.permission === "unsupported")}
    {state.permission === "denied" ? <div className="notification-permission"><p className="settings-note">Notifications are blocked in iPhone Settings.</p><button type="button" className="button button--quiet" onClick={() => void openSettings()}>Open iPhone Settings</button></div> : null}
    {!state.configured ? <p className="settings-note" role="status">Notifications are not available in this build yet.</p> : null}
    {toggle("finished", "Session finished", "An agent has completed its response.", !state.preferences.enabled)}
    {toggle("approval", "Needs approval", "An agent needs your permission to continue.", !state.preferences.enabled)}
    {toggle("question", "Questions", "An agent needs an answer from you.", !state.preferences.enabled)}
    {toggle("sound", "Sound", "Play a sound with notifications.", !state.preferences.enabled)}
    <p className="settings-note">Message text stays on your Mac. Tap an alert to open the conversation. Project notification preferences still apply.</p>
    <p className="settings-note" role="status">{saving ? "Saving…" : demo ? "Preview only · no notifications are sent." : state.registered && state.preferences.enabled ? "Notifications are on for this iPhone. Your Mac must be awake with remote access on." : state.preferences.enabled && !state.error ? "Finishing notification setup…" : ""}</p>
    {error || state.error ? <p className="error-copy" role="alert">{error || state.error}</p> : null}
  </section>;
}
