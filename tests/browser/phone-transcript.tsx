import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Transcript } from "../../companion/ui/Transcript";
import type { CompanionBlock } from "../../companion/ui/types";
import "../../companion/ui/companion.css";

function Fixture() {
  const [complete, setComplete] = useState(false);
  const [chunks, setChunks] = useState(0);
  const blocks: CompanionBlock[] = [
    { id: "read", role: "tool", text: "Reviewing the project", activity: { kind: "read", label: "Read project", state: complete ? "accepted" : "pending" } },
    { id: "reply", role: "assistant", text: Array.from({ length: 60 + chunks }, (_, i) => `Paragraph ${i + 1}. Keep this reading position as the response grows.`).join("\n\n") },
  ];
  return <main className="companion-shell" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
    <header style={{ display: "flex", gap: 8, padding: 8 }}><button className="button" onClick={() => setChunks(value => value + 1)}>Stream chunk</button><button className="button" onClick={() => setComplete(true)}>Complete activity</button></header>
    <Transcript blocks={blocks} loading={false} busy={!complete} approvalBusy={false} mutationsDisabled onApprove={() => {}} queuedMessages={chunks ? [{ id: "follow-up", text: "Review accessibility next", state: "queued" }] : []} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
