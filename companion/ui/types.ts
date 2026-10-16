export type {
  CompanionInboxItem,
  CompanionInboxList,
  CompanionInboxRead,
  CompanionInboxComment,
  CompanionInboxThread,
  CompanionInboxChanges,
} from "../../src/features/companion/model/companionInbox";
export type { CompanionChangesTarget, CompanionChangesList, CompanionChangeRead } from "../../src/features/companion/model/companionChanges";
export type {
  CompanionMonoProject,
  CompanionMonoSummary,
  CompanionMonoTextPage,
  CompanionMonoHabitRun,
  CompanionMonoHabit,
  CompanionMonoHabitPage,
  CompanionMonoLinkedSession,
  CompanionMonoLinkedSessionPage,
  CompanionMonoReadSection,
  CompanionMonoReadInput,
  CompanionMonoRead,
  CompanionMonoConfiguration,
} from "../../src/features/companion/model/companionMono";

export type CompanionStatus = {
  paired: boolean;
  hostId?: string;
};

export type CompanionAppearance = {
  version: 1;
  scheme: "dark" | "light";
  hue: number;
  saturation: number;
  backgroundLightness: number;
  contentLightness: number;
  accent: string;
  userAccent?: string;
  userAccentForeground?: string;
  fontSans?: string;
  fontMono?: string;
  linkColor?: string;
  headingColor?: string;
  uiScale?: number;
  transcriptLayout?: "chat" | "full";
};

export type CompanionChatBackground = {
  image?: string;
  scope: "empty" | "all";
  emptyOpacity: number;
  sessionOpacity: number;
  effect: "none" | "dither" | "ascii" | "halftone" | "scanlines" | "gradient-blur";
};

export type CompanionSession = {
  id: string;
  projectId?: string;
  title: string;
  cwd: string;
  harness: string;
  model: string;
  modelSettings?: Record<string, string>;
  runtimeMode?: string;
  busy: boolean;
  turn: number;
  needsApproval: boolean;
  needsQuestion?: boolean;
  lifecycle?: import("../../src/features/monos/model/monoSpawnedSessions").LaunchedSessionState;
};

export type CompanionApproval = {
  requestId: number;
  decided?: "allow" | "deny" | "cancelled";
};

export type CompanionBlock = {
  id: string;
  role: string;
  text: string;
  truncated?: boolean;
  approval?: CompanionApproval;
  spawnedSessions?: CompanionSession[];
  activity?: { label: string; state: "pending" | "accepted" | "rejected"; kind?: string; name?: string;
    steps?: { id: string; label: string; state: "pending" | "accepted" | "rejected" }[]; stepsTruncated?: boolean };
};

export type SessionsList = {
  epoch: string;
  sessions: CompanionSession[];
  truncated: boolean;
  appearance?: CompanionAppearance;
  navigation?: CompanionNavigation;
  capabilities?: { createSession?: boolean; inbox?: boolean; changes?: boolean; queuedFollowUps?: boolean };
};

export type CompanionProject = { id: string; name: string; path: string; groupId?: string; mascot?: string; color?: string; logo?: string };
export type CompanionMono = {
  id: string; name: string; mascot: string; color: string; projectIds: string[];
  status?: "working" | "needs-you" | "idle"; statusLabel?: string; activity?: string;
  busy: boolean; needsApproval: boolean;
  sessionId?: string; canChat?: boolean;
};
export type CompanionNavigation = {
  groups: { id: string; name: string; projectIds: string[]; mascot?: string; color?: string }[];
  projects: CompanionProject[];
  monos: CompanionMono[];
  truncated?: boolean;
};

export type SessionRead = {
  epoch: string;
  session: CompanionSession;
  blocks: CompanionBlock[];
  nextBefore: number | null;
  totalBlocks: number;
  configuration?: SessionConfiguration;
  chatBackground?: CompanionChatBackground | null;
  pendingQuestion?: import("../../src/features/sessions/model/userQuestion").UserQuestionPrompt;
  questionUnavailable?: boolean;
  reviewAvailable?: boolean;
  queuedMessages?: { id: string; text: string; state: "queued" | "paused" | "failed" }[];
};

export type SessionConfiguration = {
  models: { harness: string; id: string; label: string }[];
  accessModes: { id: string; label: string; description?: string }[];
};

export type CompanionDesktopResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  error?: string;
  outcomeUnknown?: boolean;
};

export type CompanionAction =
  | "sessions.review.list" | "sessions.review.read"
  | "sessions.answer" | "sessions.question.keepOpen"
  | "inbox.list" | "inbox.read"
  | "changes.list" | "changes.read"
  | "monos.read"
  | "sessions.create"
  | "sessions.list"
  | "sessions.read"
  | "sessions.send"
  | "sessions.approve"
  | "sessions.stop"
  | "sessions.configure";

export type CompanionMutationAction =
  | "sessions.answer" | "sessions.question.keepOpen"
  | "sessions.create"
  | "sessions.send"
  | "sessions.approve"
  | "sessions.stop"
  | "sessions.configure";

export type MutationInput = {
  epoch: string;
  sessionId: string;
  turn?: number;
  projectId?: string;
  text?: string;
  blockId?: string;
  decision?: "allow" | "deny";
  harness?: string;
  model?: string;
  runtimeMode?: string;
  questionId?: number;
  reply?: import("../../src/features/sessions/model/userQuestion").UserQuestionReply;
};

export type PendingMutation = {
  requestId: string;
  action: CompanionMutationAction;
  input: MutationInput;
  error: string;
};

export type InvokeLike = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
