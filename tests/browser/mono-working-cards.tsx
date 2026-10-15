import { createRoot } from "react-dom/client";
import { Transcript } from "../../companion/ui/Transcript";
import "../../companion/ui/companion.css";

createRoot(document.getElementById("root")!).render(
  <div className="companion-shell"><Transcript mono loading={false} approvalBusy={false} mutationsDisabled={false} onApprove={() => {}} blocks={[{
    id: "launched", role: "assistant", text: "Working on your projects.",
    spawnedSessions: [{ id: "child", title: "Review the changes", cwd: "/work/app", harness: "codex", model: "model", busy: true, needsApproval: false, turn: 1 }],
  }]} onOpenSession={() => {}} /></div>,
);
