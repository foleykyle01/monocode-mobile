import { pathKey } from "../../../shared/lib/paths";
import { isInFlightSession } from "../../sessions/model/inFlight";
import { isLiveAgentSession } from "../../sessions/model/liveAgents";
import { sessionNeedsInput, type Session } from "../../sessions/model/session";

export type ProjectActivity = { running: number; attention: number; done: number };
export type ProjectActivities = ReadonlyMap<string, ProjectActivity>;

export function projectActivityFromSessions(
  sessions: readonly Session[],
  unseenFinishedIds: ReadonlySet<string>,
  excludedIds: ReadonlySet<string>,
): ProjectActivities {
  const projects = new Map<string, ProjectActivity>();
  for (const session of sessions) {
    if (!session.cwd || session.cwd === "~" || session.ephemeral || session.worktreeRemoved || excludedIds.has(session.id) || !isLiveAgentSession(session)) continue;
    const state = isInFlightSession(session)
      ? sessionNeedsInput(session) ? "attention" : "running"
      : unseenFinishedIds.has(session.id) ? "done" : undefined;
    if (!state) continue;
    const key = pathKey(session.cwd);
    const counts = projects.get(key) ?? { running: 0, attention: 0, done: 0 };
    counts[state] += 1;
    projects.set(key, counts);
  }
  return projects;
}

export function projectActivityLabel(activity?: ProjectActivity): string {
  if (!activity) return "";
  return [
    activity.attention ? `${activity.attention} awaiting input` : "",
    activity.running ? `${activity.running} running` : "",
    activity.done ? `${activity.done} completed, unread` : "",
  ].filter(Boolean).join("; ");
}
