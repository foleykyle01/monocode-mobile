// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionChanges } from "./SessionChanges";
import type { CompanionClient } from "./client";

it("shows recorded totals, loads only the chosen diff, and never offers Keep/Undo", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = {
    reviewList: vi.fn(async () => ({ epoch: "e", turn: 1, files: [{ relative: "a.ts", additions: 1, deletions: 1, exact: true }], total: 1, additions: 1, deletions: 1, truncated: false })),
    reviewRead: vi.fn(async () => ({ epoch: "e", turn: 1, relative: "a.ts", original: "old\n", current: "new\n", unavailable: false })),
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  const props = { client: client as unknown as CompanionClient, sessionId: "s", epoch: "e", turn: 1, busy: false, offline: false };
  try {
    await act(async () => root.render(createElement(SessionChanges, props)));
    expect(container.textContent).toContain("Changed 1 file");
    expect(container.textContent).not.toMatch(/Keep|Undo/);
    expect(client.reviewRead).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>(".session-changes header button")!.click());
    expect(client.reviewRead).toHaveBeenCalledExactlyOnceWith("s", "a.ts");
    expect(container.querySelector(".changes-diff")?.textContent).toContain("new");
    const card = container.querySelector(".session-changes");
    const diff = container.querySelector(".changes-diff");
    await act(async () => root.render(createElement(SessionChanges, { ...props, offline: true })));
    expect(container.querySelector(".session-changes")).toBe(card);
    expect(container.querySelector(".changes-diff")).toBe(diff);
    expect(container.querySelector<HTMLButtonElement>(".session-changes header button")?.disabled).toBe(true);
    expect(client.reviewList).toHaveBeenCalledTimes(1);
    let finish!: (value: Awaited<ReturnType<typeof client.reviewList>>) => void;
    client.reviewList.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => root.render(createElement(SessionChanges, props)));
    expect(container.querySelector(".changes-diff")).toBe(diff);
    expect(container.textContent).not.toContain("Loading diff");
    await act(async () => finish({ epoch: "e", turn: 1, files: [{ relative: "a.ts", additions: 1, deletions: 1, exact: true }], total: 1, additions: 1, deletions: 1, truncated: false }));
    expect(container.querySelector(".changes-diff")).toBe(diff);
    await act(async () => root.render(createElement(SessionChanges, { ...props, busy: true })));
    expect(container.querySelector(".session-changes")).toBeNull();
    expect(client.reviewList).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
