import { expect, it } from "vitest";
import { mergeLatest, prependHistory } from "./history";
import type { SessionRead } from "./types";

const read = (ids: number[], nextBefore: number | null, totalBlocks = 6): SessionRead => ({ epoch: "e", session: { id: "s", title: "Session", cwd: "/app", harness: "claude", model: "opus", busy: false, turn: 0, needsApproval: false }, blocks: ids.map(id => ({ id: String(id), role: "assistant", text: String(id) })), nextBefore, totalBlocks });

it("preserves loaded history while replacing live text and approval state", () => {
  const previous = read([1, 2, 3, 4], null, 4);
  const latest = read([3, 4, 5, 6], 2);
  latest.blocks[1].text = "Updated";
  expect(mergeLatest(previous, latest)).toMatchObject({ nextBefore: null, totalBlocks: 6, blocks: [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4", text: "Updated" }, { id: "5" }, { id: "6" }] });
});

it("drops stale history on an epoch change, shrink, or gap", () => {
  const previous = read([1, 2], null, 2);
  const latest = read([5, 6], 4);
  expect(mergeLatest(previous, latest)).toBe(latest);
  expect(mergeLatest({ ...latest, epoch: "old" }, latest)).toBe(latest);
  expect(mergeLatest({ ...latest, totalBlocks: 8 }, latest)).toBe(latest);
});

it("prepends one cursor page without duplicates or overwriting live session state", () => {
  const current = read([5, 6], 4);
  const earlier = read([3, 4], 2);
  expect(prependHistory(current, earlier, 4).blocks.map(block => block.id)).toEqual(["3", "4", "5", "6"]);
  expect(prependHistory(current, { ...earlier, epoch: "old" }, 4)).toBe(current);
  expect(prependHistory(current, earlier, 2)).toBe(current);
});
