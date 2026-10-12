import { sessionCheckpointStatus, sessionCheckpointFileDiff } from "../../sessions/model/checkpoint";

export type CompanionReview = {
  files: { relative: string; additions: number; deletions: number; exact: boolean }[];
  total: number;
  additions: number;
  deletions: number;
  truncated: boolean;
};
export type CompanionReviewDiff = { relative: string; original: string; current: string; unavailable: boolean };

function validPath(relative: string) {
  return relative.length > 0 && relative.length <= 1024 && !/[\\\0]/.test(relative)
    && relative.split("/").every(part => !!part && part !== "." && part !== "..");
}

/** Recorded session deltas only. Never expose checkpoint Keep/Undo commands. */
export async function companionReview(sessionId: string, cwd: string, relative?: string, editedPaths?: readonly string[]): Promise<CompanionReview | CompanionReviewDiff> {
  if (relative !== undefined && !validPath(relative)) throw new Error("Invalid review path");
  const { files } = await sessionCheckpointStatus(sessionId, cwd, editedPaths);
  if (relative !== undefined) {
    const file = files.find(entry => entry.relative === relative);
    if (!file) throw new Error("File is no longer available in this session review");
    if (!file.exact) return { relative, original: "", current: "", unavailable: true };
    const diff = await sessionCheckpointFileDiff(sessionId, cwd, relative);
    const unavailable = diff.binary || diff.tooLarge || diff.original.length + diff.current.length > 65_536;
    return { relative, original: unavailable ? "" : diff.original, current: unavailable ? "" : diff.current, unavailable };
  }
  const visible = files.slice(0, 200).filter(file => validPath(file.relative));
  return {
    files: visible.map(({ relative, additions, deletions, exact }) => ({ relative, additions, deletions, exact })),
    total: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    truncated: visible.length !== files.length,
  };
}
