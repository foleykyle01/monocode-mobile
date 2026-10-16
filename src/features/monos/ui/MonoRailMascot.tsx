import { PixelMascot } from "../../projects/ui/PixelMascot";
import { ActivityDot } from "../../projects/ui/ProjectActivityBadge";
import { MONO_STATUS_LABEL, type MonoStatus } from "../model/mono";

/** The rail mascot and its status circle, shared by both rail layouts. */
export function MonoRailMascot({
  name,
  color,
  status = "idle",
  className = "size-4 shrink-0",
}: {
  name: string;
  color: string;
  status?: MonoStatus;
  className?: string;
}) {
  return (
    <span className={`relative grid place-items-center ${className}`}>
      <PixelMascot
        name={name}
        color={color}
        status={status}
        still={status === "idle"}
        className="size-full"
      />
      <MonoStatusDot
        status={status}
        className="-top-0.5 -right-0.5 size-1.5"
      />
    </span>
  );
}

/** Matches project dots; unread counts remain in the accessible label. */
export function MonoStatusDot({
  status,
  className,
  count = 0,
}: {
  status: MonoStatus;
  className: string;
  count?: number;
}) {
  const completed = status === "idle" && count > 0;
  const label = [
    completed ? "Done" : MONO_STATUS_LABEL[status],
    count ? `${count} new ${count === 1 ? "reply" : "replies"}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <ActivityDot
      label={label}
      state={status === "working" ? "running" : status === "needs-you" ? "attention" : completed ? "done" : "idle"}
      data-mono-status-dot={completed ? "done" : status}
      data-mono-unread={count || undefined}
      className={`absolute ${className}`}
    />
  );
}
