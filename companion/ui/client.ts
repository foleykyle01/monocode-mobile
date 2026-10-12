import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  CompanionAction,
  CompanionDesktopResponse,
  CompanionMutationAction,
  CompanionStatus,
  InvokeLike,
  MutationInput,
  PendingMutation,
  SessionRead,
  SessionsList,
  CompanionInboxList, CompanionInboxRead, CompanionChangesTarget, CompanionChangesList, CompanionChangeRead,
  CompanionMonoRead, CompanionMonoReadSection,
} from "./types";

export const DEMO_QUERY = "demo";

function makeRequestId() {
  return crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class CompanionRequestError extends Error {
  readonly uncertain: boolean;
  readonly requestId?: string;

  constructor(message: string, uncertain = false, requestId?: string) {
    super(message);
    this.name = "CompanionRequestError";
    this.uncertain = uncertain;
    this.requestId = requestId;
  }
}

export type CompanionClient = ReturnType<typeof createCompanionClient>;

export function createCompanionClient(
  invoke: InvokeLike = tauriInvoke as InvokeLike,
  options: { native?: boolean } = {},
) {
  const native = options.native ?? isTauriRuntime();
  const pending = new Map<string, PendingMutation>();
  let epoch: string | undefined;
  let restoreInFlight: Promise<void> | undefined;
  let reconnectInFlight: Promise<void> | undefined;

  async function call<T>(command: string, args: Record<string, unknown> = {}) {
    if (!native) throw new CompanionRequestError("Desktop pairing is only available in the MonoCode app");
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw new CompanionRequestError(errorText(error), true);
    }
  }

  async function request<T>(action: CompanionAction, input: Record<string, unknown> = {}, requestId = makeRequestId()) {
    const response = await call<CompanionDesktopResponse<T>>("companion_request", {
      requestId,
      action,
      input,
    });
    if (!response?.ok) {
      const message = response?.error || "Desktop rejected the request";
      const outcomeUnknown =
        typeof response?.outcomeUnknown === "boolean"
          ? response.outcomeUnknown
          : /unknown|timed? ?out|timeout/i.test(message);
      throw new CompanionRequestError(
        message,
        outcomeUnknown,
        requestId,
      );
    }
    return response.result as T;
  }

  async function status() {
    const result = await call<CompanionStatus>("companion_status");
    if (result.paired) await restorePending();
    return result;
  }

  async function pair(ticket: string) {
    if (!ticket.trim()) throw new CompanionRequestError("Paste the pairing ticket first");
    const result = await call<CompanionStatus>("companion_pair", { ticket: ticket.trim() });
    await restorePending();
    return result;
  }

  async function restorePending() {
    if (restoreInFlight) return restoreInFlight;
    const task = (async () => {
      const saved = await call<PendingMutation[]>("companion_pending");
      if (!Array.isArray(saved) || saved.length > 1) throw new CompanionRequestError("Saved command recovery is unavailable");
      for (const item of saved) {
        if (!item || typeof item.requestId !== "string" || !["sessions.send", "sessions.approve", "sessions.stop", "sessions.configure", "sessions.create"].includes(item.action) || typeof item.input?.sessionId !== "string" || (item.action === "sessions.create" && typeof item.input.projectId !== "string")) {
          throw new CompanionRequestError("Saved command recovery is invalid");
        }
      }
      pending.clear();
      for (const item of saved) pending.set(item.requestId, item);
    })();
    restoreInFlight = task;
    try {
      await task;
    } finally {
      if (restoreInFlight === task) restoreInFlight = undefined;
    }
  }

  async function dismissPending(requestId: string) {
    await call("companion_dismiss_pending", { requestId });
    pending.delete(requestId);
  }

  async function forget() {
    await call("companion_forget");
    pending.clear();
    epoch = undefined;
  }

  async function reconnect() {
    // Transport recovery must never forget identity or replay pending mutations.
    if (reconnectInFlight) return reconnectInFlight;
    const task = (async () => {
      await call("companion_reconnect");
      await restorePending();
    })();
    reconnectInFlight = task;
    try {
      await task;
    } finally {
      if (reconnectInFlight === task) reconnectInFlight = undefined;
    }
  }

  async function sessionsList() {
    const result = await request<SessionsList>("sessions.list");
    epoch = result.epoch;
    return result;
  }

  async function sessionRead(sessionId: string, before?: number) {
    const result = await request<SessionRead>("sessions.read", {
      sessionId,
      ...(before === undefined ? {} : { before }),
    });
    epoch = result.epoch;
    return result;
  }

  function mutationInput(input: MutationInput) {
    if (!epoch || input.epoch !== epoch) {
      throw new CompanionRequestError("Desktop connection changed; refresh before acting");
    }
    // Mutation receipts compare the exact payload. Copy the shallow command
    // object so a caller changing a draft cannot alter a pending retry.
    return { ...input };
  }

  function isKnownRejection(message: string) {
    return /(?:busy|turn changed|refresh|pending|available|accepted|changing|invalid|unsupported|resolve)/i.test(message);
  }

  async function mutate(action: CompanionMutationAction, input: MutationInput, sameRequestId?: string) {
    if (pending.size && (!sameRequestId || !pending.has(sameRequestId))) {
      throw new CompanionRequestError("Review the pending command before sending another");
    }
    const safeInput = mutationInput(input);
    const requestId = sameRequestId ?? makeRequestId();
    const existing = pending.get(requestId);
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(safeInput) || existing.action !== action) {
        throw new CompanionRequestError("This request ID is already tied to a different command", false, requestId);
      }
    }
    try {
      const result = await request<{ accepted: boolean }>(action, safeInput, requestId);
      if (result?.accepted !== true) {
        throw new CompanionRequestError(
          "Desktop did not confirm this command; keep the same request ID when retrying",
          true,
          requestId,
        );
      }
      pending.delete(requestId);
      return result;
    } catch (error) {
      const message = errorText(error);
      const uncertain = error instanceof CompanionRequestError ? error.uncertain : !isKnownRejection(message);
      if (uncertain) {
        pending.set(requestId, { requestId, action, input: safeInput, error: message });
      }
      throw new CompanionRequestError(message, uncertain, requestId);
    }
  }

  async function retry(mutation: PendingMutation) {
    return mutate(mutation.action, mutation.input, mutation.requestId);
  }

  return {
    native,
    status,
    pair,
    forget,
    reconnect,
    sessionsList,
    sessionRead,
    inboxList: () => request<CompanionInboxList & { epoch: string }>("inbox.list"),
    inboxRead: (key: string, offset?: number) => request<CompanionInboxRead & { epoch: string }>("inbox.read", {
      key,
      ...(offset === undefined ? {} : { offset }),
    }),
    monoRead: (monoId: string, section?: CompanionMonoReadSection, offset?: number) => request<CompanionMonoRead & { epoch: string }>("monos.read", {
      monoId,
      ...(section === undefined ? {} : { section }),
      ...(offset === undefined ? {} : { offset }),
    }),
    changesList: (target: CompanionChangesTarget) => request<CompanionChangesList & { epoch: string }>("changes.list", target),
    changesRead: (target: CompanionChangesTarget, relative: string, kind: "staged" | "unstaged") => request<CompanionChangeRead & { epoch: string }>("changes.read", { ...target, relative, kind }),
    mutate,
    retry,
    pendingMutations: () => [...pending.values()],
    dismissPending,
    currentEpoch: () => epoch,
  };
}
