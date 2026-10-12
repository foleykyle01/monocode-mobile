// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { CompanionClient } from "./client";
import { InboxView } from "./InboxView";
import type { CompanionInboxItem, CompanionProject } from "./types";

const projects: CompanionProject[] = [
  { id: "phone", name: "Phone", path: "/work/phone" },
  { id: "site", name: "Site", path: "/work/site" },
];

const item = (
  key: string,
  title: string,
  projectId?: string,
): CompanionInboxItem => ({
  key,
  title,
  provider: "linear",
  kind: "linear",
  reference: key === "linear:eng-1" ? "ENG-1" : "ENG-2",
  state: "Open",
  url: "https://linear.app/acme/issue/ENG-1",
  labels: [{ name: "mobile", color: "7e57c2" }],
  assignees: [{ login: "sam" }],
  teamName: "Mobile",
  updatedAt: "2026-10-11T12:00:00Z",
  ...(projectId ? { projectId } : {}),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("InboxView", () => {
  it("lists Inbox items and shows a read-only detail with project metadata", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const client = {
      inboxList: vi.fn().mockResolvedValue({
        epoch: "epoch-1",
        items: [
          item("linear:eng-1", "Fix mobile reconnect"),
          item("linear:eng-2", "Review phone copy", "phone"),
        ],
        errors: ["GitHub needs attention"],
        truncated: false,
      }),
      inboxRead: vi.fn((_: string, offset?: number) =>
        Promise.resolve(
          offset
            ? {
                epoch: "epoch-2",
                item: item("linear:eng-1", "Fix mobile reconnect"),
                body: " The connection should return safely.",
                truncated: false,
              }
            : {
                epoch: "epoch-1",
                item: item("linear:eng-1", "Fix mobile reconnect"),
                body: "## Reproduction\n\nReconnect after a lock.",
                truncated: true,
                nextOffset: 42,
                thread: {
                  comments: [{
                    id: "comment-1",
                    author: "riley",
                    body: "I can reproduce this.",
                    createdAt: "2026-10-11T12:10:00Z",
                    url: "",
                    state: "",
                    path: "",
                    line: null,
                    resolved: false,
                    replies: [],
                  }],
                  truncated: false,
                },
              },
        ),
      ),
    } as unknown as CompanionClient;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(InboxView, {
            client,
            projects,
            onBack: vi.fn(),
          }),
        ),
      );
      await act(async () => {});
      expect(container.textContent).toContain("Fix mobile reconnect");
      expect(container.textContent).toContain("GitHub needs attention");
      await act(async () =>
        [
          ...container.querySelectorAll<HTMLButtonElement>(".inbox-row"),
        ][0]!.click(),
      );
      await act(async () => {});
      expect(container.textContent).toContain("Reconnect after a lock.");
      expect(container.textContent).toContain("Global Inbox item");
      expect(container.textContent).toContain("Mobile");
      expect(container.textContent).toContain("sam");
      expect(container.textContent).toContain("Reproduction");
      expect(container.textContent).toContain("I can reproduce this.");
      await act(async () =>
        [...container.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent === "Load more description",
        )!.click(),
      );
      await act(async () => {});
      expect(container.textContent).not.toContain("The connection should return safely.");
      expect(container.textContent).toContain(
        "Your Mac reconnected. Refresh this summary before loading more.",
      );
      expect(client.inboxRead).toHaveBeenLastCalledWith(
        "linear:eng-1",
        42,
      );
      expect(container.querySelector(".inbox-start")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("ignores a slow detail response after another item becomes selected", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const first = deferred<{
      epoch: string;
      item: CompanionInboxItem;
      body: string;
      truncated: boolean;
    }>();
    const second = deferred<{
      epoch: string;
      item: CompanionInboxItem;
      body: string;
      truncated: boolean;
    }>();
    const firstItem = item("linear:eng-1", "First item");
    const secondItem = item("linear:eng-2", "Second item", "phone");
    const client = {
      inboxList: vi.fn().mockResolvedValue({
        epoch: "epoch-1",
        items: [firstItem, secondItem],
        errors: [],
        truncated: false,
      }),
      inboxRead: vi.fn((key: string) =>
        key === firstItem.key ? first.promise : second.promise,
      ),
    } as unknown as CompanionClient;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(InboxView, {
            client,
            projects,
            onBack: vi.fn(),
          }),
        ),
      );
      await act(async () => {});
      await act(async () =>
        [
          ...container.querySelectorAll<HTMLButtonElement>(".inbox-row"),
        ][0]!.click(),
      );
      await act(async () =>
        container.querySelector<HTMLButtonElement>(".inbox-back")!.click(),
      );
      await act(async () =>
        [
          ...container.querySelectorAll<HTMLButtonElement>(".inbox-row"),
        ][1]!.click(),
      );
      await act(async () =>
        first.resolve({
          epoch: "epoch-1",
          item: firstItem,
          body: "Stale first body",
          truncated: false,
        }),
      );
      expect(container.textContent).not.toContain("Stale first body");
      await act(async () =>
        second.resolve({
          epoch: "epoch-1",
          item: secondItem,
          body: "Current second body",
          truncated: false,
        }),
      );
      expect(container.textContent).toContain("Current second body");
      expect(container.textContent).not.toContain("Stale first body");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
