import { describe, expect, it } from "vitest";
import { newSession } from "../../sessions/model/session";
import { monoModelRestartDisabledReason } from "./monoModelRestart";

describe("Mono model-session restart", () => {
  it("blocks the Mono's own busy reply without inspecting child activity", () => {
    const session = {
      ...newSession("claude", "/repo"),
      busy: true,
      blocks: [{ id: "user", role: "user" as const, text: "Review this" }],
    };

    expect(monoModelRestartDisabledReason(session)).toBe(
      "Finish the current reply first.",
    );
  });

  it("keeps unresolved input and handoff states safe", () => {
    const question = {
      ...newSession("claude", "/repo"),
      pendingQuestion: {
        requestId: 1,
        questions: [
          {
            id: "scope",
            prompt: "Which project?",
            options: [],
            multiSelect: false,
            allowCustom: true,
          },
        ],
      },
    };
    const handoff = {
      ...newSession("claude", "/repo"),
      blocks: [
        {
          id: "handoff",
          role: "handoff" as const,
          text: "Preparing handoff",
          handoff: {
            from: "claude" as const,
            to: "codex" as const,
            status: "preparing" as const,
          },
        },
      ],
    };

    expect(monoModelRestartDisabledReason(question)).toBe(
      "Answer the pending question first.",
    );
    expect(monoModelRestartDisabledReason(handoff)).toBe(
      "Finish the handoff first.",
    );
  });
});
