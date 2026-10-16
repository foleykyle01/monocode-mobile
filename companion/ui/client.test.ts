import { describe, expect, it } from "vitest";
import { createCompanionClient, CompanionRequestError } from "./client";

describe("companion client mutation recovery", () => {
  it("keeps nested question answers immutable for an uncertain retry", async () => {
    const calls: Record<string, unknown>[] = [];
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command !== "companion_request") throw new Error("Unexpected command");
      if (args?.action === "sessions.list") return { ok: true, result: { epoch: "e", sessions: [] } } as T;
      calls.push(args!);
      if (calls.length === 1) return { ok: false, error: "timeout", outcomeUnknown: true } as T;
      return { ok: true, result: { epoch: "e", accepted: true } } as T;
    }, { native: true });
    await client.sessionsList();
    const reply = { kind: "answered" as const, answers: { q: ["one"] } };
    await expect(client.mutate("sessions.answer", { epoch: "e", sessionId: "s", turn: 1, questionId: 2, reply })).rejects.toMatchObject({ uncertain: true });
    reply.answers.q[0] = "two";
    await client.retry(client.pendingMutations()[0]);
    expect(calls[1].requestId).toBe(calls[0].requestId);
    expect(calls[1].input).toMatchObject({ reply: { answers: { q: ["one"] } } });
  });
  it("routes Inbox and Changes reads through the native request boundary", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command !== "companion_request") throw new Error(`Unexpected ${command}`);
      requests.push(args ?? {});
      const action = args?.action;
      if (action === "inbox.list") return { ok: true, result: { items: [], errors: [], truncated: false, epoch: "e1" } } as T;
      if (action === "inbox.read") return { ok: true, result: { item: { key: "github:item" }, body: "Issue", truncated: false, epoch: "e1" } } as T;
      if (action === "monos.read") return { ok: true, result: { mono: { id: "mono-1" }, scope: { projects: [] }, memory: { text: "facts", offset: 20, totalLines: 1, truncated: false }, epoch: "e1" } } as T;
      if (action === "changes.list") return { ok: true, result: { files: [], additions: 0, deletions: 0, revision: "rev", epoch: "e1" } } as T;
      if (action === "changes.read") return { ok: true, result: { relative: "src/main.ts", kind: "unstaged", original: "", current: "", binary: false, tooLarge: false, truncated: false, revision: "rev", epoch: "e1" } } as T;
      throw new Error(`Unexpected action ${String(action)}`);
    }, { native: true });

    await client.inboxList();
    await client.inboxRead("github:item", 40);
    await client.monoRead("mono-1", "memory", 20);
    await client.changesList({ projectId: "/work/app" });
    await client.changesRead({ projectId: "/work/app" }, "src/main.ts", "unstaged");

    expect(requests.map(({ action, input }) => ({ action, input }))).toEqual([
      { action: "inbox.list", input: {} },
      { action: "inbox.read", input: { key: "github:item", offset: 40 } },
      { action: "monos.read", input: { monoId: "mono-1", section: "memory", offset: 20 } },
      { action: "changes.list", input: { projectId: "/work/app" } },
      { action: "changes.read", input: { projectId: "/work/app", relative: "src/main.ts", kind: "unstaged" } },
    ]);
  });

  it("restores creation without a session turn and retries the same project and session ID", async () => {
    const saved = { requestId: "create-once", action: "sessions.create", input: { epoch: "e1", projectId: "/app", sessionId: "new-session" }, error: "Awaiting confirmation" };
    const creates: unknown[] = [];
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === "companion_status") return { paired: true } as T;
      if (command === "companion_pending") return [saved] as T;
      if (args?.action === "sessions.list") return { ok: true, result: { epoch: "e1", sessions: [] } } as T;
      if (args?.action === "sessions.create") { creates.push(args); return { ok: true, result: { accepted: true, sessionId: saved.input.sessionId } } as T; }
      throw new Error(`Unexpected ${command}`);
    }, { native: true });
    await client.status();
    expect(creates).toHaveLength(0);
    await client.sessionsList();
    await expect(client.mutate("sessions.create", { ...saved.input, sessionId: "duplicate" })).rejects.toThrow("pending command");
    await client.retry(client.pendingMutations()[0]);
    expect(creates).toEqual([{ requestId: saved.requestId, action: saved.action, input: saved.input }]);
    expect(client.pendingMutations()).toEqual([]);
  });

  it("restores a saved command on launch, blocks new commands, and explicitly retries the original", async () => {
    const saved = { requestId: "saved-id", action: "sessions.send", input: { epoch: "e1", sessionId: "s1", turn: 3, text: "once" }, error: "Awaiting confirmation" };
    const sends: Record<string, unknown>[] = [];
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === "companion_status") return { paired: true, hostId: "host" } as T;
      if (command === "companion_pending") return [saved] as T;
      if (args?.action === "sessions.list") return { ok: true, result: { epoch: "e1", sessions: [] } } as T;
      if (args?.action === "sessions.send") { sends.push(args); return { ok: true, result: { accepted: true } } as T; }
      throw new Error(`Unexpected ${command}`);
    }, { native: true });
    await client.status();
    expect(sends).toHaveLength(0);
    expect(client.pendingMutations()).toEqual([saved]);
    await client.sessionsList();
    await expect(client.mutate("sessions.send", { ...saved.input, text: "duplicate" })).rejects.toThrow("pending command");
    expect(sends).toHaveLength(0);
    await client.retry(client.pendingMutations()[0]);
    expect(sends).toEqual([{ requestId: saved.requestId, action: saved.action, input: saved.input }]);
    expect(client.pendingMutations()).toHaveLength(0);
  });

  it("keeps recovery blocked if the durable record cannot be dismissed", async () => {
    const saved = { requestId: "saved-id", action: "sessions.stop", input: { epoch: "old", sessionId: "s1", turn: 3 }, error: "Awaiting confirmation" };
    const client = createCompanionClient(async <T,>(command: string) => {
      if (command === "companion_status") return { paired: true } as T;
      if (command === "companion_pending") return [saved] as T;
      if (command === "companion_dismiss_pending") throw new Error("Unlock the device");
      throw new Error(`Unexpected ${command}`);
    }, { native: true });
    await client.status();
    await expect(client.dismissPending(saved.requestId)).rejects.toThrow("Unlock");
    expect(client.pendingMutations()).toEqual([saved]);
  });

  it("reconnects without forgetting pairing or replaying an uncertain command", async () => {
    const calls: string[] = [];
    const requestIds: unknown[] = [];
    let attempts = 0;
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push(command);
      if (command === "companion_reconnect") return undefined as T;
      if (command === "companion_pending") return [pending] as T;
      if (args?.action === "sessions.list") return { ok: true, result: { epoch: "same-epoch", sessions: [] } } as T;
      if (args?.action === "sessions.send") {
        requestIds.push(args.requestId);
        return (attempts++ === 0
          ? { ok: false, error: "Connection interrupted", outcomeUnknown: true }
          : { ok: true, result: { accepted: true } }) as T;
      }
      throw new Error(`Unexpected ${command}`);
    }, { native: true });
    await client.sessionsList();
    await expect(client.mutate("sessions.send", { epoch: "same-epoch", sessionId: "s1", turn: 0, text: "Once only" })).rejects.toMatchObject({ uncertain: true });
    const pending = client.pendingMutations()[0];
    await client.reconnect();
    expect(calls).toContain("companion_reconnect");
    expect(calls).toContain("companion_pending");
    expect(calls).not.toContain("companion_forget");
    expect(requestIds).toHaveLength(1);
    expect(client.pendingMutations()).toEqual([pending]);
    await client.sessionsList();
    await client.retry(pending);
    expect(requestIds).toEqual([pending.requestId, pending.requestId]);
  });

  it("coalesces concurrent reconnects and restores a durable uncertain command", async () => {
    let reconnects = 0;
    let pendingReads = 0;
    const saved = { requestId: "saved-id", action: "sessions.stop", input: { epoch: "e1", sessionId: "s1", turn: 3 }, error: "Review it" };
    const client = createCompanionClient(async <T,>(command: string) => {
      if (command === "companion_reconnect") {
        reconnects += 1;
        await Promise.resolve();
        return undefined as T;
      }
      if (command === "companion_pending") {
        pendingReads += 1;
        return [saved] as T;
      }
      throw new Error(`Unexpected ${command}`);
    }, { native: true });

    await Promise.all([client.reconnect(), client.reconnect(), client.reconnect()]);
    expect(reconnects).toBe(1);
    expect(pendingReads).toBe(1);
    expect(client.pendingMutations()).toEqual([saved]);
  });

  it("does not create a recovery command for a definitive native rejection", async () => {
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command !== "companion_request") throw new Error(`Unexpected ${command}`);
      if (args?.action === "sessions.list") return { ok: true, result: { epoch: "epoch-1", sessions: [], truncated: false } } as T;
      return { ok: false, error: "The session turn changed; refresh before acting", outcomeUnknown: false } as T;
    }, { native: true });

    await client.sessionsList();
    await expect(client.mutate("sessions.stop", { epoch: "epoch-1", sessionId: "session-1", turn: 4 })).rejects.toMatchObject({ uncertain: false });
    expect(client.pendingMutations()).toEqual([]);
  });

  it("honors an explicit definitive response even when its error text mentions a timeout", async () => {
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command !== "companion_request") throw new Error(`Unexpected ${command}`);
      if (args?.action === "sessions.list") return { ok: true, result: { epoch: "epoch-1", sessions: [], truncated: false } } as T;
      return { ok: false, error: "Request timed out before this turn could start", outcomeUnknown: false } as T;
    }, { native: true });

    await client.sessionsList();
    await expect(client.mutate("sessions.stop", { epoch: "epoch-1", sessionId: "session-1", turn: 4 })).rejects.toMatchObject({ uncertain: false });
    expect(client.pendingMutations()).toEqual([]);
  });

  it("keeps a recovery command when an ok response lacks accepted:true", async () => {
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command !== "companion_request") throw new Error(`Unexpected ${command}`);
      if (args?.action === "sessions.list") return { ok: true, result: { epoch: "epoch-1", sessions: [], truncated: false } } as T;
      return { ok: true, result: { accepted: false } } as T;
    }, { native: true });

    await client.sessionsList();
    await expect(client.mutate("sessions.stop", { epoch: "epoch-1", sessionId: "session-1", turn: 4 })).rejects.toMatchObject({ uncertain: true });
    expect(client.pendingMutations()).toHaveLength(1);
  });

  it("keeps an existing recovery command after its retry is definitively rejected", async () => {
    const saved = { requestId: "saved-id", action: "sessions.stop", input: { epoch: "epoch-1", sessionId: "s1", turn: 3 }, error: "Review it" };
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === "companion_status") return { paired: true } as T;
      if (command === "companion_pending") return [saved] as T;
      if (command === "companion_request") {
        if (args?.action === "sessions.list") return { ok: true, result: { epoch: "epoch-1", sessions: [], truncated: false } } as T;
        return { ok: false, error: "The session turn changed; refresh before acting", outcomeUnknown: false } as T;
      }
      throw new Error(`Unexpected ${command}`);
    }, { native: true });

    await client.status();
    await client.sessionsList();
    await expect(client.retry(saved)).rejects.toMatchObject({ uncertain: false });
    expect(client.pendingMutations()).toEqual([saved]);
  });

  it("retries an uncertain mutation with the same request ID and payload", async () => {
    const calls: Array<{ requestId: string; action: string; input: Record<string, unknown> }> = [];
    let sendAttempts = 0;
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === "companion_request") {
        const requestId = String(args?.requestId);
        const action = String(args?.action);
        const input = (args?.input || {}) as Record<string, unknown>;
        calls.push({ requestId, action, input });
        if (action === "sessions.list") return { ok: true, result: { epoch: "epoch-1", sessions: [], truncated: false } } as T;
        if (action === "sessions.send" && sendAttempts++ === 0) return { ok: false, error: "desktop timed out", outcomeUnknown: true } as T;
        return { ok: true, result: { epoch: "epoch-1", accepted: true } } as T;
      }
      throw new Error(`Unexpected ${command}`);
    }, { native: true });

    await client.sessionsList();
    const input = { epoch: "epoch-1", sessionId: "session-1", turn: 4, text: "same exact prompt" } as const;
    await expect(client.mutate("sessions.send", input)).rejects.toMatchObject({ uncertain: true });
    const pending = client.pendingMutations()[0];
    expect(pending).toBeDefined();
    await client.retry(pending);

    const sends = calls.filter((call) => call.action === "sessions.send");
    expect(sends).toHaveLength(2);
    expect(sends[1].requestId).toBe(sends[0].requestId);
    expect(sends[1].input).toEqual(input);
    expect(client.pendingMutations()).toHaveLength(0);
  });

  it("fails closed when a request ID is reused with changed input", async () => {
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === "companion_request") {
        if (args?.action === "sessions.list") return { ok: true, result: { epoch: "epoch-1", sessions: [], truncated: false } } as T;
        return { ok: false, error: "desktop timed out", outcomeUnknown: true } as T;
      }
      throw new Error(`Unexpected ${command}`);
    }, { native: true });

    await client.sessionsList();
    const first = { epoch: "epoch-1", sessionId: "session-1", turn: 4, text: "first" } as const;
    await expect(client.mutate("sessions.send", first)).rejects.toBeInstanceOf(CompanionRequestError);
    const pending = client.pendingMutations()[0];
    await expect(client.retry({ ...pending, input: { ...pending.input, text: "changed" } })).rejects.toMatchObject({ uncertain: false });
  });

  it("stages image bytes privately, then retries the same metadata-only send", async () => {
    const staged: unknown[] = [];
    const sends: Record<string, unknown>[] = [];
    let attempt = 0;
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === "companion_stage_attachment") {
        staged.push(args?.image);
        const { data: _data, ...reference } = args?.image as Record<string, unknown>;
        return reference as T;
      }
      if (command === "companion_request") {
        if (args?.action === "sessions.list") return { ok: true, result: { epoch: "epoch-1", sessions: [], truncated: false } } as T;
        sends.push(args!);
        return (attempt++ === 0
          ? { ok: false, error: "Connection interrupted", outcomeUnknown: true }
          : { ok: true, result: { accepted: true } }) as T;
      }
      throw new Error(`Unexpected ${command}`);
    }, { native: true });

    await client.sessionsList();
    const image = { id: "screen", name: "Screen.png", mimeType: "image/png", size: 5, width: 2, height: 2, data: "aGVsbG8=", previewUrl: "blob:phone-preview" };
    const { previewUrl: _previewUrl, ...nativeImage } = image;
    const { data: _data, ...reference } = nativeImage;
    await expect(client.send({ epoch: "epoch-1", sessionId: "session", turn: 1, text: "Read this" }, [image]))
      .rejects.toMatchObject({ uncertain: true });
    expect(staged).toEqual([nativeImage]);
    expect(sends[0].input).toEqual({ epoch: "epoch-1", sessionId: "session", turn: 1, text: "Read this", attachments: [reference] });
    expect(JSON.stringify(sends[0].input)).not.toContain("aGVsbG8=");
    await client.retry(client.pendingMutations()[0]);
    expect(staged).toHaveLength(1);
    expect(sends[1].requestId).toBe(sends[0].requestId);
    expect(sends[1].input).toEqual(sends[0].input);
  });

  it("uses the native staging schema and discards partial staging by references", async () => {
    const discarded: unknown[] = [];
    let staged = 0;
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === "companion_stage_attachment") {
        if (staged++) throw new Error("disk full");
        const { data: _data, ...reference } = args?.image as Record<string, unknown>;
        return reference as T;
      }
      if (command === "companion_discard_staged_attachments") { discarded.push(args); return undefined as T; }
      if (command === "companion_request" && args?.action === "sessions.list") return { ok: true, result: { epoch: "e", sessions: [] } } as T;
      throw new Error(`Unexpected ${command}`);
    }, { native: true });
    await client.sessionsList();
    const image = (id: string) => ({ id, name: "Screen.png", mimeType: "image/png", size: 5, width: 1, height: 1, data: "aGVsbG8=", previewUrl: "blob:private" });
    await expect(client.send({ epoch: "e", sessionId: "s", turn: 1, text: "Images" }, [image("one"), image("two")])).rejects.toThrow("disk full");
    expect(discarded).toEqual([{ references: [{ id: "one", name: "Screen.png", mimeType: "image/png", size: 5, width: 1, height: 1 }] }]);
  });

  it("clears staged bytes after a definite preflight rejection but retains uncertain retries", async () => {
    const discarded: unknown[] = [];
    const client = createCompanionClient(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === "companion_stage_attachment") {
        const { data: _data, ...reference } = args?.image as Record<string, unknown>;
        return reference as T;
      }
      if (command === "companion_discard_staged_attachments") { discarded.push(args); return undefined as T; }
      if (command === "companion_request" && args?.action === "sessions.list") return { ok: true, result: { epoch: "e", sessions: [] } } as T;
      if (command === "companion_request") return { ok: false, error: "The session turn changed; refresh before acting", outcomeUnknown: false } as T;
      throw new Error(`Unexpected ${command}`);
    }, { native: true });
    await client.sessionsList();
    const image = { id: "one", name: "Screen.png", mimeType: "image/png", size: 5, width: 1, height: 1, data: "aGVsbG8=" };
    const { data: _data, ...reference } = image;
    await expect(client.send({ epoch: "e", sessionId: "s", turn: 1, text: "Image" }, [image])).rejects.toMatchObject({ uncertain: false });
    expect(discarded).toEqual([{ references: [reference] }]);
  });
});
