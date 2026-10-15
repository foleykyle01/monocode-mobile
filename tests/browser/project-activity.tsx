import { createRoot } from "react-dom/client";
import { useState } from "react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { ProjectRail } from "../../src/app/shell/ProjectRail";
import { ProjectActivityContext } from "../../src/features/projects/ui/ProjectActivityBadge";
import { saveProjectGroups, saveProjectGroupAssignments } from "../../src/features/projects/model/projectGroups";
import { createMono, type MonoState } from "../../src/features/monos/model/mono";
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
const monos = [0, 1, 12, 120].map(count => ({ mono: createMono(), count }));
const states = new Map<string, MonoState>(monos.map(({ mono }, index) => [mono.id, { status: index === 2 ? "needs-you" : index === 3 ? "working" : "idle" }]));
function Fixture() {
  const [activeId, setActiveId] = useState<string>();
  return (
  <ProjectActivityContext.Provider value={new Map([
    ["/work/working", { running: 1, attention: 0, done: 0 }],
    ["/work/done", { running: 0, attention: 0, done: 1 }],
    ["/work/attention", { running: 0, attention: 1, done: 0 }],
    ["/work/ungrouped", { running: 0, attention: 0, done: 1 }],
  ])}>
    <ProjectRail cwd="/work/done" recents={["working", "done", "attention", "ungrouped"].map((name, index) => ({ path: `/work/${name}`, openedAt: index }))} onSelectProject={() => {}} onOpenProject={() => {}} monos={{ activeId, states, unseenCounts: new Map(monos.map(({ mono, count }) => [mono.id, count])), onOpen: setActiveId, onCreate: () => {}, onDelete: () => {} }} />
  </ProjectActivityContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
