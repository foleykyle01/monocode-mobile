import type { CompanionNavigation } from "./companionNavigation";
import { pathKey } from "../../../shared/lib/paths";
import { redactSecrets } from "../../monos/model/monoMemory";
import { defaultSoul, readAgentFile } from "../../monos/model/monoFiles";
import {
  MONO_STATUS_LABEL,
  monoLook,
  monoState,
  type Mono,
  type MonoStatus,
  type MonoState,
} from "../../monos/model/mono";
import { parseHabits, type Habit } from "../../monos/model/monoHabits";
import { getMonoTranscriptPage } from "../../sessions/data/sessionStore";
import type { Block, Session } from "../../sessions/model/session";
import {
  LAUNCHED_SESSION_LABELS,
  launchedSessionState,
  monoSpawnedSessions,
  type LaunchedSessionState,
} from "../../monos/model/monoSpawnedSessions";

const MONO_ID = /^[A-Za-z0-9-]{1,128}$/;
const PAGE_LINES = 120;
const PAGE_BYTES = 24 * 1024;
// Leave room for escaped report text inside the transport's 4 MiB response cap.
const HABIT_PAGE_SIZE = 5;
const HABIT_TEXT_LIMIT = 4_000;
const HABIT_ERROR_LIMIT = 1_000;
const HABIT_REPORT_LIMIT = 4_000;
const MAX_OFFSET = 100_000;
const LINKED_SESSION_PAGE_SIZE = 50;

export type CompanionMonoProject = { id: string; name: string };

export type CompanionMonoSummary = {
  id: string;
  name: string;
  mascot: string;
  color: string;
  projectIds: string[];
  sessionId?: string;
  canChat: boolean;
  status: MonoStatus;
  statusLabel: string;
  activity?: string;
  busy: boolean;
  needsApproval: boolean;
};

export type CompanionMonoTextPage = {
  text: string;
  offset: number;
  totalLines: number;
  nextOffset?: number;
  truncated: boolean;
  contentTruncated?: boolean;
};

export type CompanionMonoHabitRun = {
  at: number;
  durationMs: number;
  outcome: "posted" | "quiet" | "failed";
  report?: string;
  error?: string;
};

export type CompanionMonoHabit = {
  id: string;
  name: string;
  instructions: string;
  schedule: Habit["schedule"];
  enabled: boolean;
  createdAt: number;
  nextRunAt: number;
  lastRunAt?: number;
  lastOutcome?: Habit["lastOutcome"];
  lastError?: string;
  runs?: CompanionMonoHabitRun[];
  runRequested?: boolean;
  contentTruncated?: boolean;
};

export type CompanionMonoHabitPage = {
  items: CompanionMonoHabit[];
  offset: number;
  total: number;
  nextOffset?: number;
  truncated: boolean;
};

/** A live, eligible session explicitly linked from this Mono's own history. */
export type CompanionMonoLinkedSession = {
  id: string;
  title: string;
  state: LaunchedSessionState;
  statusLabel: string;
};

export type CompanionMonoLinkedSessionPage = {
  items: CompanionMonoLinkedSession[];
  offset: number;
  total: number;
  nextOffset?: number;
  truncated: boolean;
};

export type CompanionMonoReadSection = "soul" | "memory" | "habits" | "sessions";

export type CompanionMonoReadInput = {
  monoId: string;
  section?: CompanionMonoReadSection;
  offset?: number;
};

export type CompanionMonoRead = {
  mono: CompanionMonoSummary;
  scope: { projects: CompanionMonoProject[] };
  model?: {
    harness: string;
    id: string;
    label?: string;
    settings?: Record<string, string>;
  };
  access?: { id: string; label?: string; description?: string };
  soul?: CompanionMonoTextPage;
  memory?: CompanionMonoTextPage;
  habits?: CompanionMonoHabitPage;
  sessions?: CompanionMonoLinkedSessionPage;
};

export type CompanionMonoConfiguration = {
  models: { harness: string; id: string; label: string }[];
  accessModes: { id: string; label: string; description?: string }[];
};

export type CompanionMonoReaderSource = {
  monos: () => readonly Mono[];
  sessions: () => readonly Session[];
  navigation: () => Pick<CompanionNavigation, "projects">;
  canChat?: (session: Session) => boolean;
  /** Keep internal Mono sessions out of linked child navigation. */
  listable?: (session: Session) => boolean;
  /** Shared Mono activity is presentation-only; controls keep the parent state. */
  activityState?: (mono: Mono) => MonoState | undefined;
  configuration?: (session: Session) => CompanionMonoConfiguration | undefined;
};

function bounded(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function boundedWithFlag(value: string, limit: number): [string, boolean] {
  return [bounded(value, limit), value.length > limit];
}

function offset(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_OFFSET)
    throw new Error("Invalid Mono page offset");
  return value as number;
}

function pageText(value: string, start: number): CompanionMonoTextPage {
  const lines = redactSecrets(value).split(/\r?\n/);
  const offset = Math.min(start, lines.length);
  let end = offset;
  let bytes = 0;
  let contentTruncated = false;
  const encoder = new TextEncoder();
  while (end < lines.length && end - offset < PAGE_LINES) {
    const next = encoder.encode(lines[end]).length + 1;
    if (end > offset && bytes + next > PAGE_BYTES) break;
    if (end === offset && next > PAGE_BYTES) {
      let text = "";
      let textBytes = 0;
      for (const character of lines[end]) {
        const characterBytes = encoder.encode(character).length;
        if (textBytes + characterBytes + 1 > PAGE_BYTES) break;
        text += character;
        textBytes += characterBytes;
      }
      lines[end] = text;
      bytes = textBytes + 1;
      contentTruncated = true;
    } else {
      bytes += next;
    }
    end += 1;
  }
  const truncated = end < lines.length;
  return {
    text: lines.slice(offset, end).join("\n"),
    offset,
    totalLines: lines.length,
    ...(truncated ? { nextOffset: end } : {}),
    truncated,
    ...(contentTruncated ? { contentTruncated: true, truncated: true } : {}),
  };
}

function habit(value: Habit): CompanionMonoHabit {
  const [name, nameTruncated] = boundedWithFlag(value.name, 300);
  const [instructions, instructionsTruncated] = boundedWithFlag(redactSecrets(value.instructions), HABIT_TEXT_LIMIT);
  const [lastError, lastErrorTruncated] = value.lastError
    ? boundedWithFlag(redactSecrets(value.lastError), HABIT_ERROR_LIMIT)
    : [undefined, false] as const;
  let contentTruncated = nameTruncated || instructionsTruncated || lastErrorTruncated;
  const runs = value.runs?.length ? value.runs.slice(0, 20).map((run) => {
    const [report, reportTruncated] = run.report
      ? boundedWithFlag(redactSecrets(run.report), HABIT_REPORT_LIMIT)
      : [undefined, false] as const;
    const [error, errorTruncated] = run.error
      ? boundedWithFlag(redactSecrets(run.error), HABIT_ERROR_LIMIT)
      : [undefined, false] as const;
    contentTruncated ||= reportTruncated || errorTruncated;
    return {
      at: run.at,
      durationMs: run.durationMs,
      outcome: run.outcome,
      ...(report ? { report } : {}),
      ...(error ? { error } : {}),
    };
  }) : undefined;
  return {
    id: bounded(value.id, 128),
    name,
    instructions,
    schedule: value.schedule,
    enabled: value.enabled,
    createdAt: value.createdAt,
    nextRunAt: value.nextRunAt,
    ...(value.lastRunAt === undefined ? {} : { lastRunAt: value.lastRunAt }),
    ...(value.lastOutcome ? { lastOutcome: value.lastOutcome } : {}),
    ...(lastError ? { lastError } : {}),
    ...(value.runRequested ? { runRequested: true } : {}),
    ...(runs ? { runs } : {}),
    ...(contentTruncated ? { contentTruncated: true } : {}),
  };
}

function habitPage(values: readonly Habit[], start: number): CompanionMonoHabitPage {
  const offset = Math.min(start, values.length);
  const end = Math.min(offset + HABIT_PAGE_SIZE, values.length);
  const truncated = end < values.length;
  return {
    items: values.slice(offset, end).map(habit),
    offset,
    total: values.length,
    ...(truncated ? { nextOffset: end } : {}),
    truncated,
  };
}

function linkedSessionPage(
  values: readonly CompanionMonoLinkedSession[],
  start: number,
): CompanionMonoLinkedSessionPage {
  const offset = Math.min(start, values.length);
  const end = Math.min(offset + LINKED_SESSION_PAGE_SIZE, values.length);
  const truncated = end < values.length;
  return {
    items: values.slice(offset, end),
    offset,
    total: values.length,
    ...(truncated ? { nextOffset: end } : {}),
    truncated,
  };
}

function summary(mono: Mono, source: CompanionMonoReaderSource): CompanionMonoSummary {
  const navigation = source.navigation();
  const look = monoLook(mono);
  const projectIds = mono.projects
    .map((path) => navigation.projects.find((project) => pathKey(project.path) === pathKey(path))?.id)
    .filter((id): id is string => !!id);
  const foundSession = mono.sessionId
    ? source.sessions().find((session) => session.id === mono.sessionId)
    : undefined;
  const canChat = !!foundSession && (source.canChat?.(foundSession) ?? true);
  const ownState = foundSession
    ? monoState(foundSession)
    : { status: "idle" as const };
  const state = source.activityState?.(mono) ?? ownState;
  return {
    id: mono.id,
    name: look.name.slice(0, 300),
    mascot: look.mascot,
    color: look.color,
    projectIds,
    ...(canChat && foundSession ? { sessionId: foundSession.id } : {}),
    canChat,
    status: state.status,
    statusLabel: MONO_STATUS_LABEL[state.status],
    ...(state.status === ownState.status && ownState.activity
      ? { activity: bounded(ownState.activity, 300) }
      : {}),
    busy: ownState.status === "working",
    needsApproval: ownState.status === "needs-you",
  };
}

function settings(session: Session, source: CompanionMonoReaderSource) {
  const configuration = source.configuration?.(session);
  const model = configuration?.models.find((entry) => entry.harness === session.harness && entry.id === session.model);
  const access = configuration?.accessModes.find((entry) => entry.id === session.runtimeMode);
  return {
    model: {
      harness: session.harness,
      id: session.model,
      ...(model ? { label: model.label } : {}),
      ...(session.modelSettings && Object.keys(session.modelSettings).length ? { settings: Object.fromEntries(Object.entries(session.modelSettings).slice(0, 32).map(([key, value]) => [bounded(key, 128), bounded(value, 512)])) } : {}),
    },
    ...(session.runtimeMode ? { access: { id: session.runtimeMode, ...(access ? { label: access.label, description: access.description } : {}) } } : {}),
  };
}

/** Read-only projection of a Mono's desktop profile and bounded local files. */
export function createCompanionMonoReader(source: CompanionMonoReaderSource) {
  // Old Mono windows only retain their newest blocks in memory. Cache the
  // immutable older pages by their cursor, then resolve their linked ids
  // against the current live session list on every read.
  const olderBlocks = new Map<string, Promise<readonly Block[]>>();

  async function historyFor(session: Session): Promise<readonly Block[]> {
    if (session.monoTranscript?.before === null) return session.blocks;
    const before = session.monoTranscript?.before;
    const key = `${session.id}:${before ?? "start"}`;
    let pending = olderBlocks.get(key);
    if (!pending) {
      pending = (async () => {
        const blocks: Block[] = [];
        let cursor = before;
        do {
          const page = await getMonoTranscriptPage(session.id, { before: cursor });
          blocks.unshift(...page.blocks);
          const next = page.before ?? undefined;
          if (next === cursor) break;
          cursor = next;
        } while (cursor !== undefined);
        return blocks;
      })();
      olderBlocks.set(key, pending);
    }
    let historical: readonly Block[];
    try {
      historical = await pending;
    } catch (error) {
      // A transient local-store read must not make the sheet permanently
      // unavailable; its Retry button starts a fresh bounded read.
      if (olderBlocks.get(key) === pending) olderBlocks.delete(key);
      throw error;
    }
    // The newest saved page can overlap a live tail. Preserve the live block
    // object while retaining original chronology and never duplicate a link.
    const combined = new Map<string, Block>();
    for (const block of historical) combined.set(block.id, block);
    for (const block of session.blocks) combined.set(block.id, block);
    return [...combined.values()];
  }

  async function linkedSessions(mono: Mono): Promise<CompanionMonoLinkedSession[]> {
    const initialParent = mono.sessionId
      ? source.sessions().find((session) => session.id === mono.sessionId)
      : undefined;
    if (!initialParent || source.canChat?.(initialParent) === false) return [];

    const launches = monoSpawnedSessions(await historyFor(initialParent));
    // The history store is asynchronous. Resolve the live targets only after
    // it returns, and never project a parent instance that was replaced while
    // reading its older blocks.
    const parent = source.sessions().find((session) => session.id === initialParent.id);
    if (!parent || parent !== initialParent || source.canChat?.(parent) === false) return [];

    const targets = new Map(
      source.sessions()
        .filter((session) =>
          session.id !== parent.id &&
          (source.canChat?.(session) ?? true) &&
          (source.listable?.(session) ?? true),
        )
        .map((session) => [session.id, session]),
    );
    const stateOrder: Record<LaunchedSessionState, number> = {
      working: 0,
      input: 1,
      draft: 2,
      unknown: 3,
      failed: 4,
      stopped: 5,
      done: 6,
    };
    return launches.flatMap((launch, index) => {
      const target = targets.get(launch.sessionId);
      if (!target) return [];
      const state = launchedSessionState(target);
      return [{
        id: target.id,
        title: target.title.slice(0, 300) || "Untitled session",
        state,
        statusLabel: LAUNCHED_SESSION_LABELS[state],
        index,
      }];
    }).sort((left, right) => stateOrder[left.state] - stateOrder[right.state] || left.index - right.index)
      .map(({ index: _index, ...session }) => session);
  }

  return {
    async read(input: CompanionMonoReadInput): Promise<CompanionMonoRead> {
      if (!input || !MONO_ID.test(input.monoId)) throw new Error("Invalid Mono ID");
      if (input.section !== undefined && !["soul", "memory", "habits", "sessions"].includes(input.section)) throw new Error("Invalid Mono detail section");
      const mono = source.monos().find((entry) => entry.id === input.monoId);
      if (!mono) throw new Error("Mono is not available to this companion");
      const start = offset(input.offset);
      const navigation = source.navigation();
      const scope = {
        projects: mono.projects.flatMap((path) => {
          const project = navigation.projects.find((entry) => pathKey(entry.path) === pathKey(path));
          return project ? [{ id: project.id, name: project.name.slice(0, 300) }] : [];
        }),
      };
      const session = mono.sessionId ? source.sessions().find((entry) => entry.id === mono.sessionId) : undefined;
      const result: CompanionMonoRead = { mono: summary(mono, source), scope };
      if (session && source.canChat?.(session) !== false) Object.assign(result, settings(session, source));
      const section = input.section;
      if (!section || section === "soul") {
        const soul = await readAgentFile(mono.id, "SOUL.md");
        result.soul = pageText(soul.text === null ? defaultSoul(mono.instructions) : soul.text ?? "", start);
      }
      if (!section || section === "memory") result.memory = pageText((await readAgentFile(mono.id, "MEMORY.md")).text ?? "", start);
      if (!section || section === "habits") result.habits = habitPage(parseHabits((await readAgentFile(mono.id, "habits.json")).text), start);
      if (section === "sessions") result.sessions = linkedSessionPage(await linkedSessions(mono), start);
      return result;
    },
  };
}
