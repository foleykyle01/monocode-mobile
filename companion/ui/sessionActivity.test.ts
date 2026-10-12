import { expect, it } from "vitest";
import { nextSessionActivity } from "./sessionActivity";
import type { CompanionSession } from "./types";

const chat: CompanionSession = { id: "chat", title: "Chat", cwd: "/repo", model: "opus", harness: "claude", busy: false, needsApproval: false, turn: 1 };

it("shows nothing for old idle chats, tracks finished turns, and clears only after the completed transcript is viewed", () => {
  let state = nextSessionActivity(undefined, [chat], "host");
  expect(state.unread.size).toBe(0);
  const running = { ...chat, busy: true, turn: 2 };
  state = nextSessionActivity(state, [running], "host");
  const done = { ...running, busy: false };
  state = nextSessionActivity(state, [done], "host", chat);
  expect(state.unread.has(chat.id)).toBe(true);
  state = nextSessionActivity(state, [done], "host", running);
  expect(state.unread.has(chat.id)).toBe(true);
  state = nextSessionActivity(state, [done], "host", done);
  expect(state.unread.size).toBe(0);
});

it("detects a complete turn between polls and across reconnect, without inventing completions after host restart", () => {
  let state = nextSessionActivity(undefined, [chat], "host");
  state = nextSessionActivity(state, [{ ...chat, turn: 2 }], "host");
  expect(state.unread.has(chat.id)).toBe(true);
  state = nextSessionActivity(state, [chat], "new-host");
  expect(state.unread.size).toBe(0);
});

it("keeps input separate from completion and drops removed or restarted chats", () => {
  let state = nextSessionActivity(undefined, [{ ...chat, busy: true }], "host");
  state = nextSessionActivity(state, [{ ...chat, needsApproval: true }], "host");
  expect(state.unread.size).toBe(0);
  state = nextSessionActivity(state, [chat], "host");
  expect(state.unread.size).toBe(1);
  state = nextSessionActivity(state, [{ ...chat, busy: true, turn: 2 }], "host");
  expect(state.unread.size).toBe(0);
  expect(nextSessionActivity(state, [], "host").sessions.size).toBe(0);
});
