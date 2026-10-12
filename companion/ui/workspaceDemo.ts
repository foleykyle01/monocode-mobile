import type {
  CompanionChangeRead,
  CompanionChangesList,
  CompanionInboxItem,
  CompanionInboxRead,
} from "./types";

export const WORKSPACE_DEMO_INBOX_ITEMS: CompanionInboxItem[] = [
  {
    key: "github:hardbeat920/monocode:issue:241",
    title: "Keep companion navigation aligned with desktop",
    provider: "github",
    kind: "pr",
    reference: "#241",
    state: "Open",
    url: "https://github.com/hardbeat920/monocode/issues/241",
    projectId: "monocode",
    labels: [{ name: "companion", color: "5b8cff" }],
    assignees: [{ login: "kyle" }],
    updatedAt: "2026-10-11T15:10:00Z",
  },
  {
    key: "linear:mob-42",
    title: "Review companion lock and reconnect behavior",
    provider: "linear",
    kind: "linear",
    reference: "MOB-42",
    state: "Open",
    url: "https://linear.app/monocode/issue/MOB-42",
    labels: [{ name: "mobile", color: "7e57c2" }],
    teamName: "Mobile",
    updatedAt: "2026-10-11T13:30:00Z",
  },
];

const INBOX_BODIES: Record<string, string> = {
  "github:hardbeat920/monocode:issue:241": [
    "## Context",
    "",
    "Keep the phone workspace in the same **Monos → groups → projects → sessions** order as the Mac.",
    "",
    "- Retain project artwork and names.",
    "- Keep connection controls in Settings.",
    "- Confirm the compact chat header remains readable.",
  ].join("\n"),
  "linear:mob-42": [
    "## Reproduction",
    "",
    "Lock the phone during an active companion session, then reopen it after the network changes.",
    "",
    "The phone should reconnect to the same Mac-owned session without replaying a command.",
  ].join("\n"),
};

type DemoFile = CompanionChangesList["files"][number] & {
  original: string;
  current: string;
};

type DemoWorkspace = {
  version: number;
  head: string | null;
  files: DemoFile[];
};

function targetKey(input: Record<string, unknown>) {
  const projectId = input.projectId;
  if (typeof projectId !== "string" || !projectId) return undefined;
  const sessionId = input.sessionId;
  return typeof sessionId === "string" && sessionId
    ? `${projectId}:${sessionId}`
    : projectId;
}

function initialWorkspace(): DemoWorkspace {
  return {
    version: 1,
    head: "1c53269",
    files: [
      {
        relative: "companion/ui/InboxView.tsx",
        status: "modified",
        additions: 8,
        deletions: 2,
        staged: false,
        unstaged: true,
        original: "export function InboxView() {\n  return null;\n}\n",
        current:
          'export function InboxView() {\n  return <section aria-label="Inbox">Inbox</section>;\n}\n',
      },
      {
        relative: "companion/ui/companion.css",
        status: "modified",
        additions: 4,
        deletions: 0,
        staged: true,
        unstaged: false,
        original: ".session-detail { display: flex; }\n",
        current:
          ".session-detail { display: flex; }\n\n.inbox-row { min-height: 52px; }\n",
      },
    ],
  };
}

function revision(key: string, workspace: DemoWorkspace) {
  return `demo-${key}-${workspace.version}`;
}

function list(key: string, workspace: DemoWorkspace): CompanionChangesList {
  return {
    branch: "companion/mobile",
    head: workspace.head,
    files: workspace.files.map(
      ({ original: _original, current: _current, ...file }) => ({ ...file }),
    ),
    additions: workspace.files.reduce(
      (total, file) => total + file.additions,
      0,
    ),
    deletions: workspace.files.reduce(
      (total, file) => total + file.deletions,
      0,
    ),
    revision: revision(key, workspace),
  };
}

function response(result: unknown) {
  return { ok: true, result };
}

function rejection(error: string) {
  return { ok: false, error };
}

/** Sample-only workspace data for the Mac preview and iOS simulator. */
export function createWorkspaceDemo(epoch: string) {
  const workspaces = new Map<string, DemoWorkspace>();

  function workspace(input: Record<string, unknown>) {
    const key = targetKey(input);
    if (!key) return undefined;
    let current = workspaces.get(key);
    if (!current) {
      current = initialWorkspace();
      workspaces.set(key, current);
    }
    return { key, current };
  }

  return {
    request(
      action: string,
      input: Record<string, unknown>,
    ): unknown | undefined {
      if (action === "inbox.list") {
        return response({
          epoch,
          items: WORKSPACE_DEMO_INBOX_ITEMS.map((item) => ({ ...item })),
          errors: [],
          truncated: false,
        });
      }
      if (action === "inbox.read") {
        const key = input.key;
        const item =
          typeof key === "string"
            ? WORKSPACE_DEMO_INBOX_ITEMS.find((entry) => entry.key === key)
            : undefined;
        if (!item) return rejection("Sample Inbox item is unavailable");
        const result: CompanionInboxRead & { epoch: string } = {
          epoch,
          item: { ...item },
          body: INBOX_BODIES[item.key] || "",
          truncated: false,
          ...(item.kind === "pr"
            ? {
                changes: {
                  additions: 12,
                  deletions: 3,
                  files: [
                    { path: "companion/ui/InboxView.tsx", additions: 8, deletions: 2 },
                    { path: "companion/ui/inbox.css", additions: 4, deletions: 1 },
                  ],
                  truncated: false,
                },
                thread: {
                  comments: [{
                    id: "demo-review",
                    author: "Casey",
                    body: "The compact header now matches the workspace.",
                    createdAt: "2026-10-11T15:20:00Z",
                    url: item.url,
                    state: "",
                    path: "",
                    line: null,
                    resolved: false,
                    replies: [],
                  }],
                  truncated: false,
                  reviewDecision: "APPROVED",
                  baseRefName: "main",
                  headRefName: "companion/inbox-summary",
                },
              }
            : {}),
        };
        return response(result);
      }

      if (!action.startsWith("changes.")) return undefined;

      const target = workspace(input);
      if (!target) {
        return rejection("Sample project is unavailable");
      }
      const { key, current } = target;
      if (action === "changes.list") {
        return response({ epoch, ...list(key, current) });
      }
      if (action === "changes.read") {
        const relative = input.relative;
        const kind = input.kind;
        const file =
          typeof relative === "string"
            ? current.files.find(
                (entry) =>
                  entry.relative === relative &&
                  (kind === "staged"
                    ? entry.staged
                    : kind === "unstaged" && entry.unstaged),
              )
            : undefined;
        if (!file || (kind !== "staged" && kind !== "unstaged")) {
          return rejection("Sample changed file is unavailable");
        }
        const result: CompanionChangeRead & { epoch: string } = {
          epoch,
          relative: file.relative,
          kind,
          status: file.status,
          original: file.original,
          current: file.current,
          binary: false,
          tooLarge: false,
          truncated: false,
          revision: revision(key, current),
        };
        return response(result);
      }
      return undefined;
    },
  };
}
