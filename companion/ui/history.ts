import type { SessionRead } from "./types";

/** Keep loaded history only while the latest bounded snapshot still overlaps it. */
export function mergeLatest(previous: SessionRead | undefined, latest: SessionRead): SessionRead {
  if (!previous || previous.epoch !== latest.epoch || previous.session.id !== latest.session.id || previous.totalBlocks > latest.totalBlocks) return latest;
  const overlap = previous.blocks.findIndex(block => block.id === latest.blocks[0]?.id);
  if (overlap < 0) return latest;
  return { ...latest, blocks: [...previous.blocks.slice(0, overlap), ...latest.blocks], nextBefore: previous.nextBefore };
}

export function prependHistory(current: SessionRead, earlier: SessionRead, before: number): SessionRead {
  if (current.epoch !== earlier.epoch || current.session.id !== earlier.session.id || current.nextBefore !== before || earlier.totalBlocks > current.totalBlocks) return current;
  const existing = new Set(current.blocks.map(block => block.id));
  return { ...current, blocks: [...earlier.blocks.filter(block => !existing.has(block.id)), ...current.blocks], nextBefore: earlier.nextBefore };
}
