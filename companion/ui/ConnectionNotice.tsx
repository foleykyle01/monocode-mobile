export function connectionMessage(online: boolean, reconnecting: boolean) {
  if (!online) return { title: "This device is offline", detail: "Connect to Wi-Fi or cellular. Your Mac pairing is saved." };
  if (reconnecting) return { title: "Reconnecting to your Mac", detail: "Restoring the connection and refreshing your sessions. Your pairing is saved." };
  return { title: "Can’t reach your Mac", detail: "Keep your Mac awake, MonoCode Companion Dev open, and Phone companion access on. Also check the internet connection on both devices." };
}

export function ConnectionNotice({ online, reconnecting, lastSeen, error, onReconnect }: { online: boolean; reconnecting: boolean; lastSeen?: number; error?: string; onReconnect: () => void }) {
  const message = connectionMessage(online, reconnecting);
  return <section className="connection-notice" aria-label="Connection recovery">
    <div role="status"><strong>{message.title}</strong><p>{message.detail}</p>{lastSeen ? <small>Last reached at {new Date(lastSeen).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Showing the last received workspace.</small> : null}</div>
    <button type="button" className="button button--quiet button--small" disabled={reconnecting || !online} onClick={onReconnect}>{reconnecting ? "Reconnecting…" : "Reconnect"}</button>
    {error ? <details><summary>Connection details</summary><p>{error}</p></details> : null}
  </section>;
}
