import { hasPendingApproval, type Session } from "../../sessions/model/session";
import { isPreparingHandoff } from "../../sessions/model/handoff";

/** Why this Mono cannot safely discard its current provider runtime yet. */
export function monoModelRestartDisabledReason(
  session: Session,
  restarting = false,
): string | undefined {
  if (restarting) return "Restarting model session…";
  if (session.pendingQuestion) return "Answer the pending question first.";
  if (hasPendingApproval(session.blocks))
    return "Respond to the pending approval first.";
  if (session.busy) return "Finish the current reply first.";
  if (session.pendingSwitch) return "Finish the model switch first.";
  if (isPreparingHandoff(session)) return "Finish the handoff first.";
  if (session.worktreePreparing) return "Finish preparing the workspace first.";
  if (session.worktreeRemoved) return "Choose a working copy first.";
  if (session.queuedMessages?.length)
    return "Send or remove queued messages first.";
  return undefined;
}
