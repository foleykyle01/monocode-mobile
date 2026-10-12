import { pathKey, projectName } from "../../../shared/lib/paths";
import { isLocalProject } from "../../projects/model/recents";
import type { ProjectGroup } from "../../projects/model/projectGroups";
import { projectGroupColor } from "../../projects/model/projectGroups";
import {
  loadTabGroupLabels,
  resolveTabGroupLabel,
} from "../../workspace/model/tabGroups";
import { MONO_STATUS_LABEL, monoLook, monoState, type Mono } from "../../monos/model/mono";
import type { Session } from "../../sessions/model/session";
import { companionProjectAppearance } from "./companionProjectAppearance";
import type { CompanionMonoSummary } from "./companionMono";

const PROJECT_LIMIT = 200;
const GROUP_LIMIT = 100;
const MONO_LIMIT = 100;

export type CompanionNavigation = {
  groups: {
    id: string;
    name: string;
    projectIds: string[];
    mascot?: string;
    color?: string;
  }[];
  projects: {
    id: string;
    name: string;
    path: string;
    groupId?: string;
    mascot?: string;
    color?: string;
    logo?: string;
  }[];
  monos: CompanionMonoSummary[];
  truncated?: boolean;
};

type NavigationSource = {
  projectPaths: readonly string[];
  groups: readonly ProjectGroup[];
  assignments: Readonly<Record<string, string>>;
  monos: readonly Mono[];
  sessions: readonly Session[];
  canChat?(session: Session): boolean;
};

/** Projects use the desktop's stable path key; a worktree session keeps its
 * project cwd, so this is intentionally an exact lookup rather than a prefix. */
export function companionProjectId(
  path: string,
  navigation: CompanionNavigation,
): string | undefined {
  const id = pathKey(path);
  return navigation.projects.some((project) => project.id === id)
    ? id
    : undefined;
}

/** A bounded, local-only view of the existing project rail and Mono roster. */
export function buildCompanionNavigation(
  source: NavigationSource,
): CompanionNavigation {
  const labels = loadTabGroupLabels();
  const visibleGroups = source.groups.slice(0, GROUP_LIMIT);
  const groupById = new Map(visibleGroups.map((group) => [group.id, group]));
  const projects = [] as CompanionNavigation["projects"];
  const projectIds = new Set<string>();
  let truncated =
    source.groups.length > GROUP_LIMIT || source.monos.length > MONO_LIMIT;

  for (const path of source.projectPaths) {
    if (!isLocalProject(path)) continue;
    const id = pathKey(path);
    if (projectIds.has(id)) continue;
    if (projects.length >= PROJECT_LIMIT) {
      truncated = true;
      continue;
    }
    projectIds.add(id);
    const groupId = source.assignments[id];
    projects.push({
      id,
      path,
      name: resolveTabGroupLabel(id, labels, projectName(path)).slice(0, 300),
      ...companionProjectAppearance(path),
      ...(groupId && groupById.has(groupId) ? { groupId } : {}),
    });
  }

  const groups = visibleGroups.map((group) => ({
    id: group.id,
    name: group.name.slice(0, 300),
    ...(group.mascot ? { mascot: group.mascot } : {}),
    color: projectGroupColor(group),
    projectIds: projects
      .filter((project) => project.groupId === group.id)
      .map((project) => project.id),
  }));
  const sessionById = new Map(
    source.sessions.map((session) => [session.id, session]),
  );
  const monos = source.monos.slice(0, MONO_LIMIT).map((mono) => {
    const foundSession = mono.sessionId
      ? sessionById.get(mono.sessionId)
      : undefined;
    const canChat = !!foundSession && (source.canChat?.(foundSession) ?? true);
    const session = canChat ? foundSession : undefined;
    const look = monoLook(mono);
    const state = foundSession ? monoState(foundSession) : undefined;
    return {
      id: mono.id,
      name: look.name.slice(0, 300),
      mascot: look.mascot,
      color: look.color,
      projectIds: mono.projects.map(pathKey).filter((id) => projectIds.has(id)),
      ...(session ? { sessionId: session.id } : {}),
      canChat,
      status: state?.status ?? "idle",
      statusLabel: MONO_STATUS_LABEL[state?.status ?? "idle"],
      ...(state?.activity ? { activity: state.activity.slice(0, 300) } : {}),
      busy: state?.status === "working",
      needsApproval: state?.status === "needs-you",
    };
  });

  return { groups, projects, monos, ...(truncated ? { truncated: true } : {}) };
}
