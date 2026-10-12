import { useRef } from "react";
import type { CompanionSession } from "./types";

type TurnState = Pick<CompanionSession, "turn" | "busy" | "needsApproval">;
type Activity = { epoch?: string; sessions: Map<string, TurnState>; unread: Set<string> };

export function nextSessionActivity(previous: Activity | undefined, sessions: CompanionSession[], epoch?: string, viewed?: CompanionSession): Activity {
  const sameHost = previous?.epoch === epoch;
  const unread = new Set<string>();
  const snapshots = new Map<string, TurnState>();
  for (const session of sessions) {
    const old = sameHost ? previous?.sessions.get(session.id) : undefined;
    const working = session.busy || session.needsApproval;
    const finished = old && (old.busy || old.needsApproval || session.turn > old.turn);
    const seen = viewed?.id === session.id && viewed.turn >= session.turn && !viewed.busy && !viewed.needsApproval;
    if (!working && !seen && (finished || sameHost && previous?.unread.has(session.id))) unread.add(session.id);
    snapshots.set(session.id, { turn: session.turn, busy: session.busy, needsApproval: session.needsApproval });
  }
  return { epoch, sessions: snapshots, unread };
}

export function useSessionActivity(sessions: CompanionSession[], epoch?: string, viewed?: CompanionSession) {
  const activity = useRef<Activity | undefined>(undefined);
  activity.current = nextSessionActivity(activity.current, sessions, epoch, viewed);
  return activity.current.unread;
}
