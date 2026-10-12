import { createContext, useContext } from "react";
import { pathKey } from "../../../shared/lib/paths";
import { projectActivityLabel, type ProjectActivities } from "../model/projectActivity";

export const ProjectActivityContext = createContext<ProjectActivities>(new Map());
export function useProjectActivity(path: string | readonly string[]) {
  const projects = useContext(ProjectActivityContext);
  if (typeof path === "string") return projects.get(pathKey(path));
  const combined = { running: 0, attention: 0, done: 0 };
  for (const item of path) {
    const activity = projects.get(pathKey(item));
    if (!activity) continue;
    combined.running += activity.running;
    combined.attention += activity.attention;
    combined.done += activity.done;
  }
  return combined;
}

export function ProjectActivityBadge({ path, compact = false }: { path: string | readonly string[]; compact?: boolean }) {
  const activity = useProjectActivity(path);
  if (!activity) return null;
  const label = projectActivityLabel(activity);
  if (!label) return null;
  return <span role="img" aria-label={label} title={label} className={`pointer-events-none size-2 shrink-0 rounded-full ${compact ? "absolute right-0 top-0 ring-2 ring-background-base" : "ml-auto"} ${activity.attention ? "bg-amber-400" : activity.running ? "bg-blue-400" : "bg-emerald-400"}`} />;
}
