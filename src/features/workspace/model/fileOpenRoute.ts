import type { EditorNavigation } from "../../search/model/search";
import { sameProjectPath } from "../../projects/model/recents";
import type { Session } from "../../sessions/model/session";
import {
  leafIds,
  newEditorWorkspaceTab,
  openEditorTab,
  openWorkspaceFile,
  type FilePaneTab,
  type WorkspaceTab,
} from "./layout";
import { workspaceTabCwd, workspaceTabWorktree } from "./workspaceTabGroups";

export type FileOpenRoute = {
  tabs: WorkspaceTab[];
  tabId: string;
  paneId?: string;
  navigation?: EditorNavigation & { path: string };
};

function sourceTab(
  tabs: WorkspaceTab[],
  sessions: Session[],
  activeTabId: string,
  sourceSessionId?: string,
  sourceCwd?: string,
): WorkspaceTab | undefined {
  if (sourceSessionId) {
    const sessionTab = tabs.find((tab) =>
      leafIds(tab.layout).includes(sourceSessionId),
    );
    if (sessionTab) return sessionTab;
  }
  if (sourceCwd) {
    const worktreeTab = tabs.find((tab) => {
      const worktree = workspaceTabWorktree(tab, sessions);
      return !!worktree && sameProjectPath(worktree, sourceCwd);
    });
    if (worktreeTab) return worktreeTab;
  }
  return sourceSessionId || sourceCwd
    ? undefined
    : tabs.find((tab) => tab.id === activeTabId);
}

/** Routes a transcript file to its originating workspace, never the active one. */
export function routeFileOpen({
  tabs,
  sessions,
  activeTabId,
  file,
  navigation,
  sourceSessionId,
  sourceCwd,
  sourceProjectCwd,
  workspaceMode,
  insert,
  pin = false,
}: {
  tabs: WorkspaceTab[];
  sessions: Session[];
  activeTabId: string;
  file: FilePaneTab;
  navigation?: EditorNavigation;
  sourceSessionId?: string;
  sourceCwd?: string;
  sourceProjectCwd?: string;
  workspaceMode: boolean;
  insert: (tabs: WorkspaceTab[], tab: WorkspaceTab) => WorkspaceTab[];
  pin?: boolean;
}): FileOpenRoute {
  const owner = sourceTab(
    tabs,
    sessions,
    activeTabId,
    sourceSessionId,
    sourceCwd,
  );
  const scoped =
    sourceSessionId || sourceCwd
      ? (tab: WorkspaceTab) => {
          if (tab.id === owner?.id) return true;
          const project = sourceProjectCwd ?? sourceCwd;
          const tabProject = workspaceTabCwd(tab, sessions);
          return (
            !!project && !!tabProject && sameProjectPath(tabProject, project)
          );
        }
      : undefined;
  const target = workspaceMode
    ? openWorkspaceFile(
        tabs,
        file,
        newEditorWorkspaceTab(pin ? file : { ...file, preview: true }),
        insert,
        pin,
        scoped,
      )
    : owner
      ? (() => {
          const next = tabs.map((tab) =>
            tab.id === owner.id ? openEditorTab(tab, file, { pin }) : tab,
          );
          return {
            tabs: next,
            tabId: owner.id,
            paneId: next.find((tab) => tab.id === owner.id)?.focusedId,
          };
        })()
      : (() => {
          const created = newEditorWorkspaceTab(
            pin ? file : { ...file, preview: true },
          );
          return {
            tabs: insert(tabs, created),
            tabId: created.id,
            paneId: created.focusedId,
          };
        })();
  const tab = target.tabs.find((entry) => entry.id === target.tabId);
  return {
    ...target,
    ...(tab ? { paneId: target.paneId ?? tab.focusedId } : {}),
    ...(navigation ? { navigation: { path: file.path, ...navigation } } : {}),
  };
}
