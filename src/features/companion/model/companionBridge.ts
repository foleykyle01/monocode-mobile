import type { Attachment, Block, Session } from "../../sessions/model/session";
import { sessionWorkCwd } from "../../sessions/model/session";
import { isPreparingHandoff } from "../../sessions/model/handoff";
import { MAX_PREVIEW_LINES } from "../../../integrations/harness/core/preview";
import type { CompanionNavigation } from "./companionNavigation";
import type { CompanionChatBackground } from "./companionChatBackground";
import type { CompanionMonoReadInput, CompanionMonoReadSection } from "./companionMono";
import type { createCompanionInbox } from "./companionInbox";
import type { createCompanionChanges } from "./companionChanges";
import { companionQuestion, validateQuestionReply } from "./companionQuestion";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import { toolCallLabel, toolCallState } from "../../sessions/model/transcriptActivity";
import { launchedSessionState, monoSpawnedSessions } from "../../monos/model/monoSpawnedSessions";
import {
  COMPANION_IMAGE_COUNT_LIMIT,
  COMPANION_IMAGE_TOTAL_BYTES_LIMIT,
  validCompanionImageAttachment,
  validateCompanionImages,
  type CompanionImageAttachment,
} from "./companionAttachments";
import { companionQueueId } from "./companionFollowUp";

export type CompanionConfiguration = {
  models: { harness: string; id: string; label: string }[];
  accessModes: { id: string; label: string; description?: string }[];
};

/** A narrow view of the existing desktop owner, not another session runtime. */
export type CompanionOwner = {
  flush(): void;
  sessions(): readonly Session[];
  eligible(session: Session): boolean;
  turn(sessionId: string): number;
  send(sessionId: string, text: string, attachments: Attachment[], requestId: string): Promise<boolean | "queued">;
  queuedFollowUps?: boolean;
  resumeQueue?(sessionId: string): boolean | void;
  approve(sessionId: string, requestId: number, decision: "allow" | "deny"): void;
  answer?(sessionId: string, requestId: number, reply: UserQuestionReply): void;
  keepQuestionOpen?(sessionId: string, requestId: number): void;
  stop(sessionId: string): Promise<void>;
  appearance?(): unknown;
  chatBackground?(session: Session): CompanionChatBackground | null;
  navigation?(): CompanionNavigation;
  projectId?(session: Session, navigation: CompanionNavigation): string | undefined;
  listable?(session: Session): boolean;
  configuration?(session: Session): CompanionConfiguration;
  configure?(sessionId: string, input: {
    harness?: string;
    model?: string;
    runtimeMode?: string;
  }): void;
  createSession?(projectId: string, sessionId: string): void;
  inbox?: ReturnType<typeof createCompanionInbox>;
  changes?: ReturnType<typeof createCompanionChanges>;
  review?(session: Session, relative?: string): Promise<import("./companionReview").CompanionReview | import("./companionReview").CompanionReviewDiff>;
  monoRead?(input: CompanionMonoReadInput): Promise<import("./companionMono").CompanionMonoRead>;
};

const READ_LIMIT = 100;
const TEXT_LIMIT = 8_192;
const RECEIPT_LIMIT = 512;
const SPAWNED_SESSION_LIMIT = 20;
const UPLOAD_TTL_MS = 10 * 60_000;
const UPLOAD_BYTES_LIMIT = COMPANION_IMAGE_TOTAL_BYTES_LIMIT * 2;
const MUTATIONS = new Set([
  "sessions.send",
  "sessions.queue.resume",
  "sessions.approve",
  "sessions.answer",
  "sessions.question.keepOpen",
  "sessions.stop",
  "sessions.configure",
  "sessions.create",
]);

function snapshotBlock(block: Block) {
  const preview = block.tool?.preview;
  const parts = [block.text, block.tool?.detail];
  if (preview) {
    parts.push(preview.path || preview.fileName, preview.query);
    if (preview.lines?.length) parts.push(preview.lines.map(line =>
      `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`).join("\n"));
    parts.push(preview.output);
  }
  const fullText = [...new Set(parts.filter((part): part is string => !!part))].join("\n\n");
  // Desktop previews can already be shortened before this snapshot is built.
  const previewIncomplete = !!preview && ((preview.lines?.length ?? 0) >= MAX_PREVIEW_LINES
    || !!preview.lines?.some(line => line.text.endsWith("…")));
  return {
    id: block.id, role: block.role, text: fullText.slice(0, TEXT_LIMIT),
    truncated: fullText.length > TEXT_LIMIT || previewIncomplete,
    approval: block.approval,
    ...(block.attachments?.length ? { attachments: block.attachments.slice(0, COMPANION_IMAGE_COUNT_LIMIT).map((file) => ({
      name: file.name.slice(0, 255), mimeType: file.mimeType, size: file.size,
    })) } : {}),
    ...((block.tool || block.role === "tool") ? { activity: {
      label: toolCallLabel(block).slice(0, 300), state: toolCallState(block),
      kind: block.tool?.kind?.slice(0, 80),
      ...(block.agentRun ? {
        name: block.agentRun.name.slice(0, 160),
        steps: block.agentRun.steps.slice(-20).map(step => ({
          id: step.id, label: step.text.slice(0, 512),
          state: toolCallState({ id: step.id, role: "tool", text: step.text, tool: { status: step.status } }),
        })),
        stepsTruncated: block.agentRun.steps.length > 20,
      } : {}),
    } } : {}),
  };
}

type UploadedImage = CompanionImageAttachment & {
  chunks: Map<number, Uint8Array>;
  received: number;
};

type ImageUpload = {
  sessionId: string;
  turn: number;
  expiresAt: number;
  images: Map<string, UploadedImage>;
};

/** Match the desktop transcript: app-authored turns and unsent drafts are
 * retained for the runtime, but are never phone-visible conversation rows. */
function visibleTranscriptBlock(block: Block) {
  return !block.internal && !block.draft;
}

export class CompanionCommandUncertain extends Error {
  readonly outcomeUnknown = true;
  constructor(reason: unknown) {
    super(`${reason instanceof Error ? reason.message : String(reason)}. Command outcome unknown; retry the same request ID or review the session.`);
    this.name = "CompanionCommandUncertain";
  }
}

function text(input: Record<string, unknown>, key: string, limit = 256): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Error(`Invalid ${key}`);
  return value;
}

function fields(input: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("Unsupported input field");
}

function pageOffset(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100_000)
    throw new Error("Invalid page offset");
  return value as number;
}

/** Receipts live for this renderer epoch. A reload changes the epoch, making
 * old commands invalid rather than guessing whether they executed. */
export function createCompanionBridge(owner: CompanionOwner, epoch: string = crypto.randomUUID()) {
  const receipts = new Map<string, { signature: string; result: Promise<unknown> }>();
  const answered = new Set<string>();
  const uploads = new Map<string, ImageUpload>();
  let queue = Promise.resolve();

  function cleanUploads() {
    const now = Date.now();
    for (const [key, upload] of uploads) if (upload.expiresAt <= now) uploads.delete(key);
  }

  function uploadScope(requestId: string, uploadId: string, chunk: boolean) {
    if (chunk
      ? !new RegExp(`^${uploadId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-u\\d+-\\d+$`).test(requestId)
      : requestId !== uploadId)
      throw new Error("Image upload is not bound to this request");
    return uploadId;
  }

  function decodedBytes(data: unknown) {
    if (typeof data !== "string" || data.length === 0 || data.length > 131_072)
      throw new Error("Invalid image chunk");
    try {
      const binary = atob(data);
      if (btoa(binary) !== data) throw new Error();
      return Uint8Array.from(binary, byte => byte.charCodeAt(0));
    } catch {
      throw new Error("Invalid image chunk");
    }
  }

  function imageBytes(image: UploadedImage) {
    const bytes = new Uint8Array(image.size);
    let offset = 0;
    for (const chunk of [...image.chunks.entries()].sort(([left], [right]) => left - right)) {
      bytes.set(chunk[1], offset);
      offset += chunk[1].length;
    }
    if (offset !== image.size) throw new Error("Image upload is incomplete. Send the message again.");
    return bytes;
  }

  function base64(bytes: Uint8Array) {
    let text = "";
    for (let index = 0; index < bytes.length; index += 0x8000)
      text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(text);
  }

  function imageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } {
    const fail = (): never => { throw new Error("Image data does not match its attachment metadata"); };
    const u16be = (offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
    const u32be = (offset: number) => ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
    if (mimeType === "image/png") {
      if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
        || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") fail();
      return { width: u32be(16), height: u32be(20) };
    }
    if (mimeType === "image/gif") {
      if (bytes.length < 10 || (String.fromCharCode(...bytes.subarray(0, 6)) !== "GIF87a" && String.fromCharCode(...bytes.subarray(0, 6)) !== "GIF89a")) fail();
      return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
    }
    if (mimeType === "image/jpeg") {
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail();
      for (let offset = 2; offset + 9 < bytes.length;) {
        if (bytes[offset++] !== 0xff) fail();
        while (bytes[offset] === 0xff) ++offset;
        const marker = bytes[offset++];
        if (marker === 0xd9 || marker === 0xda) break;
        if (offset + 1 >= bytes.length) fail();
        const length = u16be(offset);
        if (length < 2 || offset + length > bytes.length) fail();
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf))
          return { width: u16be(offset + 5), height: u16be(offset + 3) };
        offset += length;
      }
      fail();
    }
    if (mimeType === "image/webp") {
      if (bytes.length < 20 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP") fail();
      for (let offset = 12; offset + 8 <= bytes.length;) {
        const kind = String.fromCharCode(...bytes.subarray(offset, offset + 4));
        const size = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
        const data = offset + 8;
        if (size < 0 || data + size > bytes.length) fail();
        if (kind === "VP8X" && size >= 10) return { width: 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16), height: 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16) };
        if (kind === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
          const bits = bytes[data + 1] | (bytes[data + 2] << 8) | (bytes[data + 3] << 16) | (bytes[data + 4] << 24);
          return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
        }
        if (kind === "VP8 " && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a)
          return { width: u16be(data + 6) & 0x3fff, height: u16be(data + 8) & 0x3fff };
        offset = data + size + (size % 2);
      }
    }
    return fail();
  }

  function uploadedImages(input: Record<string, unknown>, requestId: string) {
    if (input.attachments === undefined) {
      if (input.uploadId !== undefined) throw new Error("Image upload is missing its attachments");
      return { images: [] as Attachment[] };
    }
    const images = validateCompanionImages(input.attachments);
    if (images.length === 0) {
      if (input.uploadId !== undefined) throw new Error("Image upload is missing its attachments");
      return { images: [] as Attachment[] };
    }
    const uploadId = text(input, "uploadId", 56);
    const scope = uploadScope(requestId, uploadId, false);
    cleanUploads();
    const upload = uploads.get(scope);
    if (!upload || upload.sessionId !== input.sessionId || upload.turn !== input.turn)
      throw new Error("Image upload expired. Send the message again.");
    const attachments = images.map((image) => {
      const received = upload.images.get(image.id);
      if (!received || received.received !== image.size || received.name !== image.name || received.mimeType !== image.mimeType || received.width !== image.width || received.height !== image.height)
        throw new Error("Image upload is incomplete. Send the message again.");
      const bytes = imageBytes(received);
      const dimensions = imageDimensions(bytes, image.mimeType);
      if (dimensions.width !== image.width || dimensions.height !== image.height)
        throw new Error("Image data does not match its attachment metadata");
      return { id: image.id, name: image.name, mimeType: image.mimeType, kind: "image" as const, size: image.size, data: base64(bytes) };
    });
    return { images: attachments, scope };
  }

  function uploadImage(requestId: string, input: Record<string, unknown>) {
    fields(input, ["epoch", "sessionId", "turn", "uploadId", "id", "name", "mimeType", "size", "width", "height", "offset", "data"]);
    if (input.epoch !== epoch) throw new Error("Desktop connection changed; refresh before attaching an image");
    const sessionId = text(input, "sessionId");
    if (!Number.isSafeInteger(input.turn) || input.turn !== owner.turn(sessionId))
      throw new Error("The session turn changed; refresh before attaching an image");
    current(sessionId);
    const image = { id: text(input, "id", 80), name: text(input, "name", 255), mimeType: input.mimeType, size: input.size, width: input.width, height: input.height };
    if (!validCompanionImageAttachment(image)) throw new Error("Invalid image attachment");
    if (!Number.isSafeInteger(input.offset) || (input.offset as number) < 0) throw new Error("Invalid image offset");
    const bytes = decodedBytes(input.data);
    const offset = input.offset as number;
    if (offset + bytes.length > image.size) throw new Error("Image upload is too large");
    const uploadId = text(input, "uploadId", 128);
    const scope = uploadScope(requestId, uploadId, true);
    cleanUploads();
    let upload = uploads.get(scope);
    if (!upload) {
      if (uploads.size >= 8) throw new Error("Too many images are waiting to send");
      upload = { sessionId, turn: input.turn as number, expiresAt: Date.now() + UPLOAD_TTL_MS, images: new Map() };
      uploads.set(scope, upload);
    }
    if (upload.sessionId !== sessionId || upload.turn !== input.turn) throw new Error("Image upload belongs to another session");
    let received = upload.images.get(image.id);
    if (!received) {
      if (upload.images.size >= COMPANION_IMAGE_COUNT_LIMIT) throw new Error("Too many images");
      received = { ...image, chunks: new Map(), received: 0 };
      upload.images.set(image.id, received);
    }
    if (received.name !== image.name || received.mimeType !== image.mimeType || received.size !== image.size || received.width !== image.width || received.height !== image.height)
      throw new Error("Image upload metadata changed");
    const existing = received.chunks.get(offset);
    if (existing !== undefined) {
      if (existing.length !== bytes.length || existing.some((value, index) => value !== bytes[index])) throw new Error("Image retry does not match uploaded bytes");
      return { accepted: true };
    }
    const buffered = [...uploads.values()].reduce((total, entry) => total + [...entry.images.values()].reduce((size, candidate) => size + candidate.received, 0), 0);
    if (buffered + bytes.length > UPLOAD_BYTES_LIMIT) throw new Error("Too many images are waiting to send");
    if (offset !== received.received) throw new Error("Image chunks are out of order");
    received.chunks.set(offset, bytes);
    received.received += bytes.length;
    upload.expiresAt = Date.now() + UPLOAD_TTL_MS;
    return { accepted: true };
  }

  function current(id: string) {
    const session = owner.sessions().find((entry) => entry.id === id);
    if (!session || !owner.eligible(session))
      throw new Error("Session is not available to this companion");
    return session;
  }

  function summary(session: Session, navigation?: CompanionNavigation) {
    const projectId = navigation && owner.projectId?.(session, navigation);
    return {
      id: session.id,
      ...(projectId ? { projectId } : {}),
      title: session.title.slice(0, 300),
      cwd: session.cwd,
      harness: session.harness,
      model: session.model,
      modelSettings: session.modelSettings,
      runtimeMode: session.runtimeMode,
      busy: !!session.busy,
      turn: owner.turn(session.id),
      needsApproval: !!session.pendingQuestion || session.blocks.some((block) => block.approval && !block.approval.decided),
      needsQuestion: !!session.pendingQuestion,
      lifecycle: launchedSessionState(session),
    };
  }

  /**
   * Resolve Mono launch cards against the live owner session list. The launch
   * receipt can be older than the transcript page currently being returned,
   * so anchor each card to its turn's final phone-visible block before slicing.
   */
  function spawnedSessionCards(session: Session, start: number, end: number, navigation?: CompanionNavigation) {
    const knownLaunches = monoSpawnedSessions(session.blocks);
    if (knownLaunches.length === 0) return new Map<number, ReturnType<typeof summary>[]>();

    const liveTargets = new Map(
      owner.sessions()
        .filter((target) => target.id !== session.id && owner.eligible(target) && (owner.listable?.(target) ?? true))
        .map((target) => [target.id, target]),
    );
    if (liveTargets.size === 0) return new Map<number, ReturnType<typeof summary>[]>();

    const anchors = new Map<number, ReturnType<typeof summary>[]>();
    let turnStart: number | undefined;
    const finishTurn = (turnEnd: number) => {
      if (turnStart === undefined) return;
      let anchor = turnEnd - 1;
      while (anchor >= turnStart && !visibleTranscriptBlock(session.blocks[anchor])) --anchor;
      // A wholly hidden turn has no row to decorate. Its child remains
      // discoverable in the Mono header's linked-sessions list.
      if (anchor < turnStart) return;
      // If the visible continuation is not in this page, leave its card to
      // the page containing that block rather than duplicating it elsewhere.
      if (anchor < start || anchor >= end) return;
      const launches = monoSpawnedSessions(session.blocks.slice(turnStart, turnEnd), knownLaunches);
      const cards: ReturnType<typeof summary>[] = [];
      for (const launch of launches) {
        const target = liveTargets.get(launch.sessionId);
        if (!target) continue;
        cards.push(summary(target, navigation));
        if (cards.length >= SPAWNED_SESSION_LIMIT) break;
      }
      if (cards.length > 0) anchors.set(anchor, cards);
    };

    session.blocks.forEach((block, index) => {
      if (block.role !== "user") return;
      finishTurn(index);
      turnStart = index;
    });
    finishTurn(session.blocks.length);
    return anchors;
  }

  function read(action: string, input: Record<string, unknown>) {
    owner.flush();
    if (action === "sessions.review.list" || action === "sessions.review.read") {
      fields(input, ["sessionId", ...(action === "sessions.review.read" ? ["relative"] : [])]);
      const session = current(text(input, "sessionId"));
      if (!owner.review) throw new Error("Session review is unavailable on this Mac");
      if (session.busy || session.worktreePreparing || session.worktreeRemoved) throw new Error("Wait for the session to finish before reviewing changes");
      const turn = owner.turn(session.id);
      const cwd = sessionWorkCwd(session);
      return owner.review(session, action === "sessions.review.read" ? text(input, "relative", 1024) : undefined).then(result => {
        const latest = current(session.id);
        if (latest.busy || sessionWorkCwd(latest) !== cwd || owner.turn(session.id) !== turn || latest.worktreePreparing || latest.worktreeRemoved)
          throw new Error("Session changed; refresh before reviewing changes");
        return { ...result, epoch, turn };
      });
    }
    if (action === "inbox.list" || action === "inbox.read") {
      const inbox = owner.inbox;
      if (!inbox) throw new Error("Inbox is unavailable; update the Mac companion");
      fields(input, action === "inbox.list" ? [] : ["key", "offset"]);
      const result = action === "inbox.list"
        ? inbox.list()
        : input.offset === undefined
          ? inbox.read(text(input, "key", 512))
          : inbox.read(text(input, "key", 512), pageOffset(input.offset));
      return result.then(value => ({ ...value, epoch }));
    }
    if (action === "monos.read") {
      if (!owner.monoRead) throw new Error("Mono details are unavailable; update the Mac companion");
      fields(input, ["monoId", "section", "offset"]);
      const section = input.section;
      if (section !== undefined && section !== "soul" && section !== "memory" && section !== "habits" && section !== "sessions")
        throw new Error("Invalid Mono detail section");
      const request: CompanionMonoReadInput = {
        monoId: text(input, "monoId", 128),
        ...(section === undefined ? {} : { section: section as CompanionMonoReadSection }),
        ...(input.offset === undefined ? {} : { offset: pageOffset(input.offset) }),
      };
      return owner.monoRead(request).then(value => ({ ...value, epoch }));
    }
    if (action === "changes.list" || action === "changes.read") {
      if (!owner.changes) throw new Error("Changes are unavailable; update the Mac companion");
      fields(input, ["projectId", "sessionId", ...(action === "changes.read" ? ["relative", "kind"] : [])]);
      const target = { projectId: text(input, "projectId"), ...(input.sessionId === undefined ? {} : { sessionId: text(input, "sessionId") }) };
      if (action === "changes.read" && input.kind !== "staged" && input.kind !== "unstaged") throw new Error("Invalid changes section");
      const result = action === "changes.list" ? owner.changes.list(target) : owner.changes.read(target, text(input, "relative", 1024), input.kind as "staged" | "unstaged");
      return result.then(value => ({ ...value, epoch }));
    }
    if (action === "sessions.list") {
      fields(input, []);
      const sessions = owner.sessions().filter(
        (session) => owner.eligible(session) && (owner.listable?.(session) ?? true),
      );
      const navigation = owner.navigation?.();
      return {
        epoch,
        sessions: sessions.slice(0, 200).map((session) => summary(session, navigation)),
        truncated: sessions.length > 200,
        appearance: owner.appearance?.(),
        capabilities: { createSession: !!owner.createSession, inbox: !!owner.inbox, changes: !!owner.changes, queuedFollowUps: !!owner.queuedFollowUps, imageAttachments: true, queueRecovery: !!owner.resumeQueue },
        ...(navigation ? { navigation } : {}),
      };
    }
    if (action !== "sessions.read") throw new Error("Unsupported companion action");
    fields(input, ["sessionId", "before"]);
    const session = current(text(input, "sessionId"));
    const before = input.before ?? session.blocks.length;
    if (!Number.isSafeInteger(before) || (before as number) < 0 || (before as number) > session.blocks.length)
      throw new Error("Invalid transcript cursor; refresh the session");
    const end = before as number;
    const start = Math.max(0, end - READ_LIMIT);
    const navigation = owner.navigation?.();
    const spawnedCards = spawnedSessionCards(session, start, end, navigation);
    let chatBackground: CompanionChatBackground | null = null;
    try {
      chatBackground = owner.chatBackground?.(session) ?? null;
    } catch {
      // Missing artwork is cosmetic; retain the live transcript.
    }
    return {
      epoch,
      session: {
        ...summary(session, navigation),
      },
      ...(owner.configuration ? { configuration: owner.configuration(session) } : {}),
      // Keep cursors in raw storage coordinates. Filtering before slicing
      // would skip hidden-only pages or attach a card to the wrong row.
      blocks: session.blocks.slice(start, end).flatMap((block, offset) => {
        if (!visibleTranscriptBlock(block)) return [];
        const snapshot = snapshotBlock(block);
        const spawnedSessions = spawnedCards.get(start + offset);
        return [spawnedSessions ? { ...snapshot, spawnedSessions } : snapshot];
      }),
      nextBefore: start || null,
      totalBlocks: session.blocks.length,
      chatBackground,
      pendingQuestion: owner.answer ? companionQuestion(session.pendingQuestion) : undefined,
      questionUnavailable: !!session.pendingQuestion && (!owner.answer || !companionQuestion(session.pendingQuestion)),
      reviewAvailable: !!owner.review,
      queuedMessages: session.queuedMessages?.filter(message => !message.monoSessionCompletion).map(message => ({
        id: message.id, text: message.text.slice(0, TEXT_LIMIT),
        state: message.error ? "failed" : session.queueStatus === "paused" ? "paused" : "queued",
        ...(message.error ? { error: message.error.slice(0, TEXT_LIMIT) } : {}),
        ...(message.attachments.length ? { attachments: message.attachments.slice(0, COMPANION_IMAGE_COUNT_LIMIT).map(file => ({ name: file.name.slice(0, 255), mimeType: file.mimeType, size: file.size })) } : {}),
      })),
    };
  }

  async function mutate(action: string, input: Record<string, unknown>, requestId: string) {
    owner.flush();
    if (action === "sessions.create") {
      fields(input, ["epoch", "projectId", "sessionId"]);
      const projectId = text(input, "projectId");
      const sessionId = text(input, "sessionId");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId))
        throw new Error("Invalid session ID");
      if (owner.sessions().some((session) => session.id === sessionId))
        throw new Error("Session ID already exists");
      const project = owner.navigation?.().projects.find((entry) => entry.id === projectId);
      if (!project || !owner.createSession)
        throw new Error("Project session creation is unavailable to this companion");
      try { owner.createSession(project.id, sessionId); }
      catch (error) { throw new CompanionCommandUncertain(error); }
      return { epoch, sessionId, accepted: true, turn: 0 };
    }
    const id = text(input, "sessionId");
    const session = current(id);
    if (!Number.isSafeInteger(input.turn) || input.turn !== owner.turn(id))
      throw new Error("The session turn changed; refresh before acting");
    if (isPreparingHandoff(session) || session.worktreePreparing || session.worktreeRemoved)
      throw new Error("Session is changing its provider or workspace");

    if (action === "sessions.send") {
      fields(input, ["epoch", "sessionId", "turn", "text", "attachments", "uploadId"]);
      if (typeof input.text !== "string" || input.text.length > 32_768)
        throw new Error("Invalid text");
      const uploaded = uploadedImages(input, requestId);
      const prompt = input.text.trim();
      if (!prompt && uploaded.images.length === 0) throw new Error("Message or image is required");
      if (!owner.queuedFollowUps && (session.busy || session.queuedMessages?.length))
        throw new Error("Queued follow-ups are unavailable; update the Mac companion");
      if (session.blocks.some((block) => block.draft))
        throw new Error("Resolve this session's existing draft or queued messages first");
      let accepted: boolean | "queued";
      try { accepted = await owner.send(id, prompt, uploaded.images, `companion:${epoch}:${requestId}`); }
      catch (error) { throw new CompanionCommandUncertain(error); }
      if (!accepted)
        throw new Error("Desktop did not accept the follow-up");
      if (uploaded.scope) uploads.delete(uploaded.scope);
      return {
        epoch, sessionId: id, accepted: true, turn: owner.turn(id),
        delivery: accepted === "queued" ? "queued" : "accepted",
        ...(accepted === "queued" ? { queueId: companionQueueId(`companion:${epoch}:${requestId}`) } : {}),
      };
    } else if (action === "sessions.queue.resume") {
      fields(input, ["epoch", "sessionId", "turn"]);
      if (!owner.resumeQueue || session.queueStatus !== "paused" || !session.queuedMessages?.length)
        throw new Error("Queued delivery cannot be resumed here");
      let resumed: boolean | void;
      try { resumed = owner.resumeQueue(id); }
      catch (error) { throw new CompanionCommandUncertain(error); }
      if (resumed === false) throw new Error("Queued delivery cannot be resumed here");
    } else if (action === "sessions.approve") {
      fields(input, ["epoch", "sessionId", "turn", "blockId", "decision"]);
      const blockId = text(input, "blockId");
      if (input.decision !== "allow" && input.decision !== "deny")
        throw new Error("Invalid approval decision");
      const block = session.blocks.find((entry) => entry.id === blockId);
      const key = JSON.stringify([id, input.turn, blockId]);
      if (!session.busy || !block?.approval || block.approval.decided || answered.has(key))
        throw new Error("Approval is no longer pending");
      if (block.monoHabit)
        throw new Error("Review habit approvals on your Mac");
      if (input.decision === "allow" && snapshotBlock(block).truncated)
        throw new Error("Review the full action on your Mac before allowing it");
      // Claim before dispatch. An uncertain failure must not send another
      // decision. Refresh state instead of retrying under a new command ID.
      answered.add(key);
      try { owner.approve(id, block.approval.requestId, input.decision); }
      catch (error) { throw new CompanionCommandUncertain(error); }
    } else if (action === "sessions.answer" || action === "sessions.question.keepOpen") {
      fields(input, ["epoch", "sessionId", "turn", "questionId", ...(action === "sessions.answer" ? ["reply"] : [])]);
      const prompt = companionQuestion(session.pendingQuestion);
      const key = JSON.stringify([id, input.turn, "question", input.questionId]);
      if (!session.busy || !prompt || input.questionId !== prompt.requestId || answered.has(key))
        throw new Error("Question is no longer pending");
      if (action === "sessions.answer") {
        if (!owner.answer) throw new Error("Question answers are unavailable on this Mac");
        const reply = validateQuestionReply(prompt, input.reply);
        answered.add(key);
        try { owner.answer(id, prompt.requestId, reply); }
        catch (error) { throw new CompanionCommandUncertain(error); }
      } else {
        if (!owner.keepQuestionOpen) throw new Error("Question interaction is unavailable on this Mac");
        try { owner.keepQuestionOpen(id, prompt.requestId); }
        catch (error) { throw new CompanionCommandUncertain(error); }
      }
    } else if (action === "sessions.stop") {
      fields(input, ["epoch", "sessionId", "turn"]);
      if (!session.busy) throw new Error("Session is not running");
      try { await owner.stop(id); }
      catch (error) { throw new CompanionCommandUncertain(error); }
    } else {
      fields(input, ["epoch", "sessionId", "turn", "harness", "model", "runtimeMode"]);
      const harness = input.harness;
      const model = input.model;
      const runtimeMode = input.runtimeMode;
      if (harness !== undefined && (typeof harness !== "string" || !harness))
        throw new Error("Invalid harness");
      if (model !== undefined && (typeof model !== "string" || !model))
        throw new Error("Invalid model");
      if (runtimeMode !== undefined && (typeof runtimeMode !== "string" || !runtimeMode))
        throw new Error("Invalid access mode");
      if (harness === undefined && model === undefined && runtimeMode === undefined)
        throw new Error("Choose a model or access mode");
      if (session.busy || session.blocks.some((block) => block.draft) || session.queuedMessages?.length)
        throw new Error("Session must be idle with no draft or queued messages before changing settings");
      const configuration = owner.configuration?.(session);
      if (!configuration || !owner.configure)
        throw new Error("Session settings are unavailable to this companion");
      const selectedHarness = harness ?? session.harness;
      const selectedModel = model ?? session.model;
      if (harness && harness !== session.harness && !model)
        throw new Error("Choose a model for the selected provider");
      if ((harness || model) && !configuration.models.some((entry) => entry.harness === selectedHarness && entry.id === selectedModel))
        throw new Error("Selected model is unavailable on this Mac");
      if (runtimeMode && !configuration.accessModes.some((mode) => mode.id === runtimeMode))
        throw new Error("Selected access mode is unavailable");
      try { owner.configure(id, { harness, model, runtimeMode }); }
      catch (error) { throw new CompanionCommandUncertain(error); }
    }
    return { epoch, sessionId: id, accepted: true, turn: owner.turn(id) };
  }

  return {
    epoch,
    handle(requestId: string, action: string, input: Record<string, unknown>): Promise<unknown> {
      try {
        if (!input || Array.isArray(input) || typeof input !== "object")
          throw new Error("Invalid input");
        if (action === "sessions.attachment.upload")
          return Promise.resolve(uploadImage(requestId, input));
        if (!MUTATIONS.has(action)) return Promise.resolve(read(action, input));
        if (input.epoch !== epoch) throw new Error("Desktop connection changed; refresh before acting");
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) throw new Error("Invalid request ID");
        const signature = JSON.stringify([action, Object.entries(input).sort(([a], [b]) => a.localeCompare(b))]);
        const previous = receipts.get(requestId);
        if (previous) {
          if (previous.signature !== signature) throw new Error("Request ID already used with different input");
          return previous.result;
        }
        // Fail closed rather than evicting a receipt and possibly replaying an
        // old mutation. Restarting this development bridge creates a new epoch.
        if (receipts.size >= RECEIPT_LIMIT) throw new Error("Development command limit reached; restart the isolated app");
        const result = queue.then(() => mutate(action, input, requestId));
        // A final send that has no staged bytes never reaches the owner. Do
        // not turn that preflight rejection into a receipt which would block
        // the same idempotent request after its phone replays the chunks.
        const receipt = result.catch(error => {
          if (action === "sessions.send" && error instanceof Error && error.message.startsWith("Image upload expired"))
            receipts.delete(requestId);
          throw error;
        });
        receipts.set(requestId, { signature, result: receipt });
        queue = result.then(() => undefined, () => undefined);
        return receipt;
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}
