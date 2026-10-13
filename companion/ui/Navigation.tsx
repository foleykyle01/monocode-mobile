import { useMemo, useState } from "react";
import { projectMascot } from "../../src/features/projects/model/projectMascots";
import { HarnessIcon, HARNESS_ICONS } from "../../src/features/sessions/ui/HarnessIcon";
import type { HarnessId } from "../../src/features/sessions/model/session";
import { CircleHelp, ChevronRight, Plus, FileDiff } from "../../src/shared/ui/icons";
import type { CompanionMono, CompanionNavigation, CompanionProject, CompanionSession } from "./types";

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;
export const activityLabel = (item: { busy: boolean; needsApproval: boolean; needsQuestion?: boolean }) => item.needsQuestion ? "Needs an answer" : item.needsApproval ? "Needs approval" : item.busy ? "Working" : "Ready";
export const monoStatusLabel = (mono: CompanionMono) => mono.statusLabel || activityLabel(mono);
const Chevron = ({ expanded }: { expanded: boolean }) => <ChevronRight className="nav-chevron" data-expanded={expanded} size={12} aria-hidden="true" />;

export function MonoMascot({ mono }: { mono: CompanionMono }) {
  const mascot = projectMascot(mono.id, mono.mascot);
  return <svg className="mono-mascot" viewBox="0 0 8 8" aria-hidden="true" style={{ color: mono.color }}><path fill="currentColor" d={mascot.restPath} /></svg>;
}
export function ProjectIcon({ project }: { project: Pick<CompanionProject, "id" | "mascot" | "color" | "logo"> }) {
  const [failedLogo, setFailedLogo] = useState<string>();
  if (project.logo && failedLogo !== project.logo) return <img className="project-icon" src={project.logo} alt="" onError={() => setFailedLogo(project.logo)} />;
  const mascot = projectMascot(project.id, project.mascot);
  return <svg className="project-icon" viewBox="0 0 8 8" aria-hidden="true" style={{ color: project.color || "var(--companion-muted)" }}><path fill="currentColor" d={mascot.restPath} /></svg>;
}

/** Preserve desktop order and identity; older hosts fall back to cwd projects. */
export function navigationProjects(sessions: CompanionSession[], navigation?: CompanionNavigation) {
  const projects = (navigation?.projects || []).map(project => ({ ...project, sessions: [] as CompanionSession[] }));
  const byId = new Map(projects.map(project => [project.id, project]));
  const monoSessions = new Set(navigation?.monos.flatMap(mono => mono.sessionId ? [mono.sessionId] : []));
  for (const session of sessions) {
    if (monoSessions.has(session.id)) continue;
    let project = byId.get(session.projectId || session.cwd);
    if (!project) {
      if (navigation) continue;
      project = { id: session.projectId || session.cwd, path: session.cwd, name: basename(session.cwd), sessions: [] };
      projects.push(project);
      byId.set(project.id, project);
    }
    project.sessions.push(session);
  }
  const assigned = new Set<string>();
  const groups = (navigation?.groups || []).map(group => ({ ...group, projects: group.projectIds.flatMap(id => {
    const project = byId.get(id);
    if (!project || assigned.has(id)) return [];
    assigned.add(id);
    return [project];
  }) }));
  const ungrouped = projects.filter(project => !assigned.has(project.id));
  if (ungrouped.length) groups.push({ id: "companion-ungrouped", name: groups.length ? "Ungrouped" : "Projects", projectIds: ungrouped.map(p => p.id), projects: ungrouped });
  return groups;
}

function ProjectActivity({ sessions, unread }: { sessions: CompanionSession[]; unread?: ReadonlySet<string> }) {
  const counts = { running: 0, attention: 0, done: 0 };
  for (const session of sessions) {
    if (session.needsApproval) counts.attention++;
    else if (session.busy) counts.running++;
    else if (unread?.has(session.id)) counts.done++;
  }
  const badges = ([
    [counts.attention, "awaiting input", "attention"],
    [counts.running, "running", "running"],
    [counts.done, "completed, unread", "done"],
  ] as const).filter(([count]) => count > 0);
  if (!badges.length) return null;
  const label = badges.map(([count, text]) => `${count} ${text}`).join("; ");
  const status = counts.attention ? "attention" : counts.running ? "running" : "done";
  return <span className={`project-activity project-activity--${status}`} role="img" aria-label={label} title={label} />;
}

type Props = {
  sessions: CompanionSession[]; navigation?: CompanionNavigation; query: string; filter: string;
  selectedId?: string; selectedMonoId?: string;
  unreadSessionIds?: ReadonlySet<string>;
  monosExpanded?: boolean;
  onSession: (id: string) => void; onMono: (id: string) => void;
  onMonoDetails?: (id: string) => void;
  onCreate?: (project: CompanionProject) => void;
  onChanges?: (project: CompanionProject) => void;
  createDisabled?: boolean;
};

export function Navigation({ sessions, navigation, query, filter, selectedId, selectedMonoId, unreadSessionIds, onSession, onMono, onMonoDetails, onCreate, onChanges, createDisabled, monosExpanded = true }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => navigationProjects(sessions, navigation), [sessions, navigation]);
  const term = query.trim().toLowerCase();
  const matchesActivity = (item: { busy: boolean; needsApproval: boolean }) => filter === "all" || (filter === "attention" ? item.needsApproval : item.busy);
  const matchesText = (text: string) => text.toLowerCase().includes(term);
  const projectNames = new Map(navigation?.projects.map(project => [project.id, project.name]));
  const monos = navigation?.monos.filter(mono => matchesActivity(mono) && matchesText(`${mono.name} ${mono.projectIds.map(id => projectNames.get(id) || id).join(" ")}`)) || [];
  const visibleGroups = groups.map(group => ({ ...group, projects: group.projects.map(project => ({
    ...project, activitySessions: project.sessions, sessions: project.sessions.filter(session => matchesActivity(session) && matchesText(`${group.name} ${project.name} ${project.path} ${session.title} ${session.harness} ${session.model}`)),
  })).filter(project => project.sessions.length || (filter === "all" && matchesText(`${group.name} ${project.name} ${project.path}`))) })).filter(group => group.projects.length);
  const expanded = (id: string) => !!term || filter !== "all" || !collapsed.has(id);
  const toggle = (id: string) => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <nav className="workspace-navigation" aria-label="Monos and projects">
    {navigation && (!term && filter === "all" || monos.length > 0) ? <section id="companion-monos" className="mono-section" aria-label="Monos" hidden={!monosExpanded}>
      {monos.length ? <div className="mono-roster">{monos.map(mono => <div key={mono.id} className={`mono-card ${selectedMonoId === mono.id ? "mono-card--selected" : ""}`} style={{ "--mono-color": mono.color } as React.CSSProperties}>
        <button type="button" className={`mono-row ${selectedMonoId === mono.id ? "mono-row--selected" : ""}`} aria-current={selectedMonoId === mono.id ? "true" : undefined} onClick={() => onMono(mono.id)}>
          <MonoMascot mono={mono} /><span className="mono-row__body"><strong>{mono.name}</strong><small>{monoStatusLabel(mono)} · {mono.activity || `${mono.projectIds.length} ${mono.projectIds.length === 1 ? "project" : "projects"}`}</small></span>
        </button>
        {onMonoDetails ? <button className="mono-details-button" type="button" aria-label={`Details for ${mono.name}`} title={`Details for ${mono.name}`} onClick={() => onMonoDetails(mono.id)}><CircleHelp size={17} aria-hidden="true" /></button> : null}
      </div>)}</div> : <p className="nav-note">Your Monos will appear here when you add them on this Mac.</p>}
    </section> : null}
    {visibleGroups.map(group => <section className="project-group" key={group.id}>
      <button type="button" className="group-toggle" aria-expanded={expanded(`g:${group.id}`)} onClick={() => toggle(`g:${group.id}`)}><Chevron expanded={expanded(`g:${group.id}`)} />{group.mascot ? <ProjectIcon project={group} /> : null}<strong>{group.name}</strong>{!expanded(`g:${group.id}`) ? <ProjectActivity sessions={group.projects.flatMap(project => project.activitySessions)} unread={unreadSessionIds} /> : null}</button>
      {expanded(`g:${group.id}`) ? <div className="project-group__children">{group.projects.map(project => <section className="nav-project" key={project.id}>
        <div className="project-heading"><button type="button" className="project-toggle" aria-expanded={expanded(`p:${project.id}`)} onClick={() => toggle(`p:${project.id}`)} title={project.path}><Chevron expanded={expanded(`p:${project.id}`)} /><ProjectIcon project={project} /><strong>{project.name}</strong><ProjectActivity sessions={project.activitySessions} unread={unreadSessionIds} /></button>
          {onCreate && navigation?.projects.some(entry => entry.id === project.id) ? <button className="new-session-button" type="button" aria-label={`New session in ${project.name}`} title={`New session in ${project.name}`} disabled={createDisabled} onClick={() => { setCollapsed(previous => { const next = new Set(previous); next.delete(`p:${project.id}`); return next; }); onCreate(project); }}><Plus size={16} aria-hidden="true" /></button> : null}
          {onChanges && navigation?.projects.some(entry => entry.id === project.id) ? <button className="new-session-button" type="button" aria-label={`Changes in ${project.name}`} title={`Changes in ${project.name}`} onClick={() => onChanges(project)}><FileDiff size={16} aria-hidden="true" /></button> : null}
        </div>
        {expanded(`p:${project.id}`) ? <div className="project-sessions">{project.sessions.map(session => <button type="button" key={session.id} className={`session-row ${!selectedMonoId && selectedId === session.id ? "session-row--selected" : ""}`} aria-current={!selectedMonoId && selectedId === session.id ? "true" : undefined} onClick={() => onSession(session.id)}>
          <span className="session-row__provider" aria-hidden="true">{Object.prototype.hasOwnProperty.call(HARNESS_ICONS, session.harness) ? <HarnessIcon harness={session.harness as HarnessId} className="picker-provider-icon" /> : <span className="status-dot" />}</span><span className="session-row__body"><strong>{session.title || "Untitled session"}</strong><span className="session-row__metadata"><span>{session.model}</span></span></span><ProjectActivity sessions={[session]} unread={unreadSessionIds} />
        </button>)}{project.sessions.length === 0 ? <p className="nav-note">No available sessions</p> : null}</div> : null}
      </section>)}</div> : null}
    </section>)}
    {!visibleGroups.length && !monos.length && (term || filter !== "all") ? <p className="empty-panel">No Monos or sessions match this search or filter.</p> : null}
    {navigation?.truncated ? <p className="nav-note">Showing part of this Mac’s workspace.</p> : null}
  </nav>;
}
