import type { Session } from "../../sessions/model/session";

// The desktop store accepts only path-safe IDs, unlike bridge receipt keys.
export const companionQueueId = (requestId: string) => requestId.replace(/:/g, "_");

export function shouldSteerCompanionFollowUp(session: Session, behavior: "queue" | "steer"): boolean {
  return !!session.queuedMessages?.[0]?.id.startsWith("companion_") &&
    (behavior === "steer" || !!session.backgroundTasks?.length);
}

/** Use the desktop outbox; never replace its head, pause state, or local draft. */
export function queueCompanionFollowUp(session: Session, text: string, requestId: string): Session {
  const id = companionQueueId(requestId);
  if (session.queuedMessages?.some(message => message.id === id)) return session;
  return {
    ...session,
    queuedMessages: [...(session.queuedMessages ?? []), { id, text, attachments: [] }],
    queueStatus: session.queueStatus ?? "active",
  };
}
