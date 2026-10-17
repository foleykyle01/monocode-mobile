import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../../src/app/shell/Sidebar";
import {
  createMono,
  removeMono,
  saveMonoName,
} from "../../src/features/monos/model/mono";
import "../../src/styles/index.css";

const LONG_NAME =
  "VeryLongUnbrokenMonoNameThatMustRemainReadableAtTheMinimumRailWidth";

function seedMonos() {
  localStorage.removeItem("monocode:mono-roster");
  localStorage.removeItem("monocode.projectRailView");
  return Array.from({ length: 11 }, (_, index) => {
    const mono = createMono();
    saveMonoName(
      mono.id,
      index === 0 ? LONG_NAME : `Mono ${String(index + 1).padStart(2, "0")}`,
    );
    return mono.id;
  });
}

function Fixture() {
  const [seed] = useState(seedMonos);
  const [opened, setOpened] = useState(seed[0]);
  const [projectRailOpen, setProjectRailOpen] = useState(true);
  const [light, setLight] = useState(false);
  const [rosterRevision, setRosterRevision] = useState(0);
  const [destination, setDestination] = useState("Workspace");

  useEffect(() => {
    document.documentElement.classList.toggle("theme-light", light);
    return () => document.documentElement.classList.remove("theme-light");
  }, [light]);

  return (
    <main className="flex h-full bg-background-base text-content">
      <Sidebar
        cwd="/fixture/mono-workspace"
        open={false}
        tab="sessions"
        onTabChange={() => setDestination("Workspace")}
        filesSearchOpen={false}
        onFilesSearchOpenChange={() => {}}
        sessions={[]}
        busySessionIds={new Set()}
        approvalSessionIds={new Set()}
        status="idle"
        pending={false}
        onSelectSession={() => {}}
        onOpenFile={() => {}}
        recents={[{ path: "/fixture/mono-workspace", openedAt: 1 }]}
        onSelectProject={() => setDestination("Project")}
        onOpenProject={() => setDestination("New project")}
        projectRailOpen={projectRailOpen}
        compactProjectRail
        onToggleProjectRail={() => setProjectRailOpen((current) => !current)}
        onOpenInbox={() => setDestination("Inbox")}
        onOpenNotes={() => setDestination("Notes")}
        onOpenAutomations={() => setDestination("Automations")}
        monos={{
          activeId: opened,
          states: new Map(),
          onOpen: (id) => {
            setOpened(id);
            setDestination("Mono conversation");
          },
          onCreate: () => {
            const mono = createMono();
            saveMonoName(mono.id, `Mono ${rosterRevision + 12}`);
            setOpened(mono.id);
            setRosterRevision((current) => current + 1);
          },
          onDelete: (id) => {
            removeMono(id);
            setOpened((current) => (current === id ? "" : current));
            setRosterRevision((current) => current + 1);
          },
        }}
      />
      <section className="min-w-0 flex-1 p-8">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setLight((current) => !current)}>
            Toggle theme
          </button>
          <button type="button" onClick={() => setProjectRailOpen(false)}>
            Collapse rail
          </button>
        </div>
        <p data-fixture-destination>{destination}</p>
        <h1 className="mt-4 text-xl font-semibold">
          {opened || "No Mono selected"}
        </h1>
        <p className="mt-2 text-content/60">
          The main area only changes when the existing Mono open callback runs.
        </p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
