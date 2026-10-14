import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { ProjectRail } from "../../src/app/shell/ProjectRail";
import { ProjectActivityContext } from "../../src/features/projects/ui/ProjectActivityBadge";
import { saveProjectGroups, saveProjectGroupAssignments } from "../../src/features/projects/model/projectGroups";
import "../../src/styles/index.css";

mockWindows("main");
mockIPC((command, args) => {
  if (command === "git_diff_stats") {
    return args.cwd === "/work/working"
      ? { files: 2, additions: 123, deletions: 4 }
      : { files: 1, additions: 0, deletions: 0 };
  }
  return null;
}, { shouldMockEvents: true });

localStorage.clear();
saveProjectGroups([{ id: "work", name: "Work", collapsed: false, colorIndex: 0 }]);
saveProjectGroupAssignments({ "/work/working": "work", "/work/done": "work", "/work/attention": "work" });
createRoot(document.getElementById("root")!).render(
  <ProjectActivityContext.Provider value={new Map([
    ["/work/working", { running: 1, attention: 0, done: 0 }],
    ["/work/done", { running: 0, attention: 0, done: 1 }],
    ["/work/attention", { running: 0, attention: 1, done: 0 }],
  ])}>
    <ProjectRail cwd="/work/done" recents={["working", "done", "attention"].map((name, index) => ({ path: `/work/${name}`, openedAt: index }))} onSelectProject={() => {}} onOpenProject={() => {}} />
  </ProjectActivityContext.Provider>,
);
