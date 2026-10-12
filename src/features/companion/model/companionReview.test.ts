import { beforeEach, expect, it, vi } from "vitest";
const checkpoint = vi.hoisted(() => ({ sessionCheckpointStatus: vi.fn(), sessionCheckpointFileDiff: vi.fn() }));
vi.mock("../../sessions/model/checkpoint", () => checkpoint);
import { companionReview } from "./companionReview";
beforeEach(() => {
  vi.clearAllMocks();
  checkpoint.sessionCheckpointStatus.mockResolvedValue({ files: [{ relative: "a.ts", additions: 1, deletions: 2, exact: true }] });
  checkpoint.sessionCheckpointFileDiff.mockResolvedValue({ original: "before", current: "after", binary: false, tooLarge: false });
});
it("lists recorded deltas without reading file contents, and preserves Mono scope", async () => {
  expect(await companionReview("s", "/repo", undefined, ["a.ts"])).toMatchObject({ total: 1, additions: 1, deletions: 2 });
  expect(checkpoint.sessionCheckpointStatus).toHaveBeenCalledWith("s", "/repo", ["a.ts"]);
  expect(checkpoint.sessionCheckpointFileDiff).not.toHaveBeenCalled();
});
it.each(["../secret", "/secret", "a/../secret", "a\\secret", "a\0secret", "missing.ts"])("rejects unauthorized file %s", async relative => {
  await expect(companionReview("s", "/repo", relative)).rejects.toThrow();
  expect(checkpoint.sessionCheckpointFileDiff).not.toHaveBeenCalled();
});
it("bounds file lists and omits oversized/binary diff bodies", async () => {
  checkpoint.sessionCheckpointStatus.mockResolvedValueOnce({ files: Array.from({ length: 220 }, (_, i) => ({ relative: `${i}.ts`, additions: 1, deletions: 0, exact: true })) });
  const list = await companionReview("s", "/repo");
  expect(list).toMatchObject({ total: 220, additions: 220, truncated: true });
  expect("files" in list && list.files.length).toBe(200);
  checkpoint.sessionCheckpointFileDiff.mockResolvedValueOnce({ original: "a".repeat(65_537), current: "", binary: false, tooLarge: false });
  expect(await companionReview("s", "/repo", "a.ts")).toEqual({ relative: "a.ts", original: "", current: "", unavailable: true });
});
it("does not infer a diff when the checkpoint has no recorded original", async () => {
  checkpoint.sessionCheckpointStatus.mockResolvedValueOnce({ files: [{ relative: "a.ts", additions: 0, deletions: 0, exact: false }] });
  expect(await companionReview("s", "/repo", "a.ts")).toMatchObject({ unavailable: true });
  expect(checkpoint.sessionCheckpointFileDiff).not.toHaveBeenCalled();
});
