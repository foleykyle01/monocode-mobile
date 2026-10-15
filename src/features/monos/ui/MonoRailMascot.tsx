import { PixelMascot } from "../../projects/ui/PixelMascot";
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
        color={color}
        className="-top-0.5 -right-0.5 size-1.5"
      />
    </span>
  );
}

/** A status circle, with an optional unread count inside it. */
export function MonoStatusDot({
  status,
  color,
  className,
  count = 0,
}: {
  status: MonoStatus;
  color: string;
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
    <span
      role="img"
      aria-label={label}
      title={label}
      data-mono-status-dot={completed ? "done" : status}
      data-mono-unread={count || undefined}
      className={`absolute rounded-full ring-1 ring-background-base ${className} ${
        status === "working"
          ? count
            ? "bg-blue-400 text-blue-950"
            : "motion-safe:animate-pulse"
          : status === "needs-you"
            ? count
              ? "bg-amber-400 text-amber-950"
              : "bg-accent"
            : completed
              ? "bg-emerald-400 text-emerald-950"
              : "bg-content/30"
      }`}
      style={status === "working" && !count ? { backgroundColor: color } : undefined}
    >
      {count ? (count > 99 ? "99+" : count) : null}
    </span>
  );
}
