import { expect, it } from "vitest";
import { newSession } from "../../sessions/model/session";
import { canDispatchQueuedHead, canSteerQueuedHead, dequeueQueuedMessage } from "../../sessions/model/messageQueue";
import { queueCompanionFollowUp, shouldSteerCompanionFollowUp } from "./companionFollowUp";
import { sanitizeSessionForPersist } from "../../sessions/data/sessionStore";

it("appends rapid sends without replacing earlier work or the paused queue", () => {
  const original = { ...newSession("codex", "/repo"), busy: true, queueStatus: "paused" as const,
    queuedMessages: [{ id: "desktop", text: "First", attachments: [] }],
    blocks: [{ id: "draft", role: "user" as const, text: "Local draft", draft: true }] };
  const first = queueCompanionFollowUp(original, "Second", "companion:e:1");
  const second = queueCompanionFollowUp(first, "Third", "companion:e:2");
  expect(second.queuedMessages?.map(message => message.text)).toEqual(["First", "Second", "Third"]);
  expect(second.blocks).toBe(original.blocks);
  expect(second.queueStatus).toBe("paused");
  expect(second.busy).toBe(true);
  expect(queueCompanionFollowUp(second, "Second", "companion:e:1")).toBe(second);
  expect(original.queuedMessages).toHaveLength(1);
});

it("uses the existing dispatch/steer gates and survives a persisted round trip", () => {
  const busy = queueCompanionFollowUp({ ...newSession("codex", "/repo"), busy: true, blocks: [{ id: "prompt", role: "user", text: "Start" }] }, "Next", "companion:e:1");
  const persisted = sanitizeSessionForPersist(busy);
  expect(persisted.queuedMessages).toEqual([{ id: "companion_e_1", text: "Next", attachments: [] }]);
  const saved = { ...busy, queuedMessages: persisted.queuedMessages };
  expect(shouldSteerCompanionFollowUp(saved, "queue")).toBe(false);
  expect(shouldSteerCompanionFollowUp(saved, "steer")).toBe(true);
  expect(shouldSteerCompanionFollowUp({ ...saved, queuedMessages: [{ id: "desktop", text: "First", attachments: [] }, ...saved.queuedMessages!] }, "steer")).toBe(false);
  expect(canDispatchQueuedHead(saved)).toBe(false);
  expect(canSteerQueuedHead(saved)).toBe(false);
  expect(canSteerQueuedHead({ ...saved, turnReady: true })).toBe(true);
  expect(canSteerQueuedHead({ ...saved, turnReady: true, blocks: [{ id: "approval", role: "tool", text: "Allow?", approval: { requestId: 1 } }] })).toBe(false);
  expect(canSteerQueuedHead({ ...saved, turnReady: true, pendingQuestion: { requestId: 2, questions: [] } })).toBe(false);
  expect(canDispatchQueuedHead({ ...saved, busy: false })).toBe(true);
  expect(dequeueQueuedMessage(saved, "companion_e_1").queuedMessages).toBeUndefined();
});
