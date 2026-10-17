import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Transcript } from "../../companion/ui/Transcript";
import type { CompanionBlock } from "../../companion/ui/types";
import "../../companion/ui/companion.css";

type Chat = "a" | "b" | "child";

function reply(id: string, label: string, paragraphs: number): CompanionBlock {
  return { id, role: "assistant", text: Array.from({ length: paragraphs }, (_, index) => `${label} paragraph ${index + 1}. Keep this reading position as the response grows.`).join("\n\n") };
}

function Fixture() {
  const [complete, setComplete] = useState(false);
  const [chunks, setChunks] = useState(0);
  const [active, setActive] = useState<Chat>("a");
  const [hydrated, setHydrated] = useState(false);
  const [older, setOlder] = useState(false);
  const [lateLayout, setLateLayout] = useState(false);
  const [reflowHeight, setReflowHeight] = useState(0);
  const blocks: CompanionBlock[] = hydrated ? [
    ...(active === "a" && older ? [reply("a-earlier", "Older A", 20)] : []),
    { id: `${active}-read`, role: "tool", text: "Reviewing the project", activity: { kind: "read", label: "Read project", state: complete ? "accepted" : "pending" } },
    reply(`${active}-reply`, active === "a" ? "Chat A" : active === "b" ? "Chat B" : "Linked project", 60 + chunks),
    ...(active === "a" ? [{ id: "linked-project", role: "assistant" as const, text: "A linked project is ready.", spawnedSessions: [{ id: "child", title: "Linked project", cwd: "/repo", harness: "codex", model: "model", busy: false, turn: 0, needsApproval: false }] }] : []),
    ...(lateLayout ? [reply(`${active}-late`, "Late layout", 24)] : []),
  ] : [];
  return <main className="companion-shell" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
    <header style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 8 }}>
      <button className="button" onClick={() => setHydrated(true)}>Hydrate transcript</button>
      <button className="button" onClick={() => setActive("a")}>Open chat A</button>
      <button className="button" onClick={() => setActive("b")}>Open chat B</button>
      {active === "child" ? <button className="button" onClick={() => setActive("a")}>Back to parent</button> : null}
      <button className="button" onClick={() => setLateLayout(true)}>Add late layout</button>
      <button className="button" onClick={() => setReflowHeight(height => height + 240)}>Grow rendered content</button>
      <button className="button" onClick={() => setChunks(value => value + 1)}>Stream chunk</button>
      <button className="button" onClick={() => setComplete(true)}>Complete activity</button>
    </header>
    <Transcript key={active} blocks={blocks} loading={!hydrated} busy={!complete} approvalBusy={false} mutationsDisabled={false} onApprove={() => {}}
      onLoadEarlier={hydrated && active === "a" ? () => setOlder(true) : undefined}
      onOpenSession={active === "a" ? session => setActive(session.id as Chat) : undefined}
      changes={reflowHeight ? <div data-testid="late-reflow" style={{ height: reflowHeight }} /> : undefined}
      queuedMessages={chunks ? [{ id: "follow-up", text: "Review accessibility next", state: "queued" }] : []} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
