// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxItem } from "../../inbox/model/githubTasks";

const mocks = vi.hoisted(() => ({
  listInboxItems: vi.fn(),
  githubWorkItemDetails: vi.fn(),
  githubWorkItemThread: vi.fn(),
  githubPrDiff: vi.fn(),
  inboxTrackerDescription: vi.fn(),
  gitlabWorkItemDetails: vi.fn(),
  azureDevOpsWorkItemDetails: vi.fn(),
}));

vi.mock("../../inbox/model/githubTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../inbox/model/githubTasks")>()),
  listInboxItems: mocks.listInboxItems,
  githubWorkItemDetails: mocks.githubWorkItemDetails,
  githubWorkItemThread: mocks.githubWorkItemThread,
  githubPrDiff: mocks.githubPrDiff,
}));
vi.mock("../../inbox/model/inboxContext", () => ({
  inboxTrackerDescription: mocks.inboxTrackerDescription,
}));
vi.mock("../../inbox/model/gitlab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../inbox/model/gitlab")>()),
  gitlabWorkItemDetails: mocks.gitlabWorkItemDetails,
}));
vi.mock("../../inbox/model/azureDevOps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../inbox/model/azureDevOps")>()),
  azureDevOpsWorkItemDetails: mocks.azureDevOpsWorkItemDetails,
}));

import { createCompanionInbox, type CompanionInboxComment } from "./companionInbox";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    provider: "github",
    kind: "issue",
    number: 17,
    title: "Fix phone navigation",
    url: "https://github.com/acme/phone/issues/17",
    state: "open",
    updatedAt: "2026-10-11T12:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
    repo: "acme/phone",
    projectPath: "/work/phone",
    ...overrides,
  };
}

describe("companion inbox projection", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.listInboxItems.mockReset();
    mocks.githubWorkItemDetails.mockReset();
    mocks.githubWorkItemThread.mockReset().mockResolvedValue({
      comments: [],
      truncated: false,
      reviewDecision: "",
      baseRefName: "",
      headRefName: "",
    });
    mocks.githubPrDiff.mockReset().mockResolvedValue({
      additions: 0,
      deletions: 0,
      files: [],
      patch: "",
      truncated: false,
    });
    mocks.inboxTrackerDescription.mockReset();
    mocks.gitlabWorkItemDetails.mockReset();
    mocks.azureDevOpsWorkItemDetails.mockReset();
  });

  it("projects the desktop Inbox with its saved filters and bounds provider errors", async () => {
    localStorage.setItem(
      "monocode.inboxFilters",
      JSON.stringify({
        assignedToMe: true,
        hiddenKinds: ["issue"],
        status: { open: false, draft: false, closed: false, merged: false },
      }),
    );
    mocks.listInboxItems.mockResolvedValue({
      items: [
        item(),
        item({ kind: "pr", number: 18, title: "Review companion" }),
      ],
      errors: { github: "x".repeat(500) },
    });
    const inbox = createCompanionInbox(() => [
      { id: "phone", path: "/work/phone", name: "Phone" },
    ]);

    await expect(inbox.list()).resolves.toEqual({
      items: [
        expect.objectContaining({
          key: "github:acme/phone:pr:18",
          projectId: "phone",
          reference: "#18",
        }),
      ],
      errors: [expect.stringMatching(/^x+…$/)],
      truncated: false,
    });
    expect(mocks.listInboxItems).toHaveBeenCalledWith(
      [{ id: "phone", path: "/work/phone", name: "Phone" }],
      expect.objectContaining({ assignedToMe: true, state: "all" }),
    );
  });

  it("reads only an advertised item and pages a cached provider description", async () => {
    mocks.listInboxItems.mockResolvedValue({ items: [item()], errors: {} });
    mocks.githubWorkItemDetails.mockResolvedValue({ body: "x".repeat(20_000) });
    const inbox = createCompanionInbox(() => [
      { id: "phone", path: "/work/phone", name: "Phone" },
    ]);

    await expect(inbox.read("github:acme/phone:issue:17")).rejects.toThrow(
      "no longer available",
    );
    await inbox.list();
    const first = await inbox.read("github:acme/phone:issue:17");
    const second = await inbox.read(
      "github:acme/phone:issue:17",
      first.nextOffset!,
    );

    expect(first).toMatchObject({ truncated: true, nextOffset: 16_384 });
    expect(first.body).toHaveLength(16_384);
    expect(second).toMatchObject({ truncated: false });
    expect(second.body).toHaveLength(3_616);
    expect(mocks.githubWorkItemDetails).toHaveBeenCalledExactlyOnceWith(
      "/work/phone",
      "acme/phone",
      "issue",
      17,
    );
  });

  it("includes bounded desktop discussion and pull-request file summaries", async () => {
    const pullRequest = item({ kind: "pr", number: 18 });
    mocks.listInboxItems.mockResolvedValue({ items: [pullRequest], errors: {} });
    mocks.githubWorkItemDetails.mockResolvedValue({ body: "Summary" });
    mocks.githubWorkItemThread.mockResolvedValue({
      comments: [{
        id: "comment-1",
        author: "Riley",
        body: "x".repeat(9_000),
        createdAt: "2026-10-11T12:00:00Z",
        url: "",
        state: "",
        path: "",
        line: null,
        resolved: false,
        replies: [],
      }],
      truncated: false,
      reviewDecision: "APPROVED",
      baseRefName: "main",
      headRefName: "phone-summary",
    });
    mocks.githubPrDiff.mockResolvedValue({
      additions: 8,
      deletions: 2,
      files: [{ path: "companion/ui/InboxView.tsx", additions: 8, deletions: 2 }],
      patch: "",
      truncated: false,
    });
    const inbox = createCompanionInbox(() => [
      { id: "phone", path: "/work/phone", name: "Phone" },
    ]);

    await inbox.list();
    await expect(inbox.read("github:acme/phone:pr:18")).resolves.toMatchObject({
      thread: {
        truncated: true,
        reviewDecision: "APPROVED",
        comments: [{ body: expect.stringMatching(/^x+…$/) }],
      },
      changes: {
        additions: 8,
        files: [{ path: "companion/ui/InboxView.tsx" }],
      },
    });
  });

  it("bounds the total nested discussion payload and marks omitted replies", async () => {
    mocks.listInboxItems.mockResolvedValue({ items: [item()], errors: {} });
    mocks.githubWorkItemDetails.mockResolvedValue({ body: "Summary" });
    mocks.githubWorkItemThread.mockResolvedValue({
      comments: [{
        id: "root".repeat(200),
        author: "a".repeat(400),
        authorAvatarUrl: "https://example.test/" + "a".repeat(3_000),
        body: "Root",
        createdAt: "2026-10-11T12:00:00Z",
        url: "https://example.test/" + "u".repeat(3_000),
        state: "open".repeat(100),
        path: "src/" + "p".repeat(2_000),
        line: null,
        resolved: false,
        replies: Array.from({ length: 80 }, (_, index) => ({
          id: `reply-${index}`,
          author: "Riley",
          body: "reply",
          createdAt: "2026-10-11T12:00:00Z",
          url: "",
          state: "",
          path: "",
          line: null,
          resolved: false,
          replies: [],
        })),
      }],
      truncated: false,
      reviewDecision: "",
      baseRefName: "",
      headRefName: "",
    });
    const inbox = createCompanionInbox(() => [
      { id: "phone", path: "/work/phone", name: "Phone" },
    ]);

    await inbox.list();
    const result = await inbox.read("github:acme/phone:issue:17");
    const root = result.thread!.comments[0]!;
    const count = (comments: CompanionInboxComment[]): number =>
      comments.reduce((total, comment) => total + 1 + count(comment.replies), 0);

    expect(result.thread).toMatchObject({ truncated: true });
    expect(count(result.thread!.comments)).toBeLessThanOrEqual(50);
    expect(root.id).toHaveLength(512);
    expect(root.author).toHaveLength(256);
    expect(root.authorAvatarUrl).toHaveLength(2_048);
    expect(root.url).toHaveLength(2_048);
    expect(root.state).toHaveLength(128);
    expect(root.path).toHaveLength(1_024);
    expect(root.replies).toHaveLength(49);
  });
});
