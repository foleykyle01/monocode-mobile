import {
  applyInboxFilters,
  inboxFetchState,
  loadInboxFilters,
  pruneInboxFilters,
} from "../../inbox/model/inboxFilters";
import {
  githubWorkItemDetails,
  inboxItemKey,
  inboxItemRef,
  inboxItemStatus,
  listInboxItems,
  githubPrDiff,
  githubWorkItemThread,
  type InboxItem,
  type InboxKind,
  type InboxProvider,
} from "../../inbox/model/githubTasks";
import { inboxTrackerDescription } from "../../inbox/model/inboxContext";
import {
  gitlabMrDiff,
  gitlabWorkItemDetails,
  gitlabWorkItemThread,
} from "../../inbox/model/gitlab";
import {
  azureDevOpsMrDiff,
  azureDevOpsWorkItemDetails,
  azureDevOpsWorkItemThread,
} from "../../inbox/model/azureDevOps";
import { linearIssueThread, loadHiddenLinearTeamIds } from "../../inbox/model/linear";
import { jiraIssueThread, loadHiddenJiraProjectIds } from "../../inbox/model/jira";
import { sameProjectPath } from "../../projects/model/recents";

const ITEM_LIMIT = 100;
/** A transport page; callers request subsequent pages with `nextOffset`. */
const BODY_PAGE_LIMIT = 16_384;
const COMMENT_LIMIT = 50;
const COMMENT_BODY_LIMIT = 8_192;
const COMMENT_DEPTH_LIMIT = 6;
const COMMENT_ID_LIMIT = 512;
const COMMENT_AUTHOR_LIMIT = 256;
const COMMENT_AVATAR_URL_LIMIT = 2_048;
const COMMENT_DATE_LIMIT = 128;
const COMMENT_URL_LIMIT = 2_048;
const COMMENT_STATE_LIMIT = 128;
const COMMENT_PATH_LIMIT = 1_024;
const CHANGE_FILE_LIMIT = 60;
const ERROR_LIMIT = 400;
const KEY_LIMIT = 512;

export type CompanionInboxProject = {
  id: string;
  path: string;
  name: string;
};

export type CompanionInboxItem = {
  key: string;
  title: string;
  provider: InboxProvider;
  kind: InboxKind;
  reference: string;
  state: string;
  url: string;
  projectId?: string;
  /** Desktop Inbox metadata used by the compact row and full summary. */
  labels?: { name: string; color: string }[];
  assignees?: { login: string; avatarUrl?: string }[];
  createdAt?: string;
  updatedAt?: string;
  stateReason?: string;
  attentionReason?: string;
  teamName?: string;
  projectName?: string;
  draft?: boolean;
};

export type CompanionInboxList = {
  items: CompanionInboxItem[];
  errors: string[];
  truncated: boolean;
};

export type CompanionInboxRead = {
  item: CompanionInboxItem;
  /** One page of the item description. */
  body: string;
  /** True only when another description page is available. */
  truncated: boolean;
  nextOffset?: number;
  thread?: CompanionInboxThread;
  changes?: CompanionInboxChanges;
  /** Provider detail that could not be read without affecting the summary. */
  summaryWarnings?: string[];
};

export type CompanionInboxComment = {
  id: string;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
  url: string;
  state: string;
  path: string;
  line: number | null;
  resolved: boolean;
  replies: CompanionInboxComment[];
};

export type CompanionInboxThread = {
  comments: CompanionInboxComment[];
  truncated: boolean;
  reviewDecision?: string;
  baseRefName?: string;
  headRefName?: string;
};

export type CompanionInboxChanges = {
  additions: number;
  deletions: number;
  files: { path: string; additions: number; deletions: number }[];
  truncated: boolean;
};

type CachedItem = {
  item: InboxItem;
  summary: CompanionInboxItem;
  body?: string;
  extras?: Omit<CompanionInboxRead, "item" | "body" | "truncated" | "nextOffset">;
  extrasLoaded?: boolean;
};

function bounded(value: string, limit: number): [string, boolean] {
  return value.length > limit
    ? [`${value.slice(0, Math.max(0, limit - 1))}…`, true]
    : [value, false];
}

function cachedItem(item: InboxItem): InboxItem {
  return {
    ...item,
    labels: item.labels.map((label) => ({ ...label })),
    assignees: item.assignees.map((assignee) => ({ ...assignee })),
  };
}

function projectFor(
  item: InboxItem,
  projects: readonly CompanionInboxProject[],
) {
  const path = item.projectPath.trim();
  return path
    ? projects.find((project) => sameProjectPath(project.path, path))
    : undefined;
}

function summaryFor(
  item: InboxItem,
  projects: readonly CompanionInboxProject[],
): CompanionInboxItem | null {
  const key = inboxItemKey(item);
  if (!key || key.length > KEY_LIMIT) return null;
  const [title] = bounded(item.title.trim() || inboxItemRef(item), 300);
  const [reference] = bounded(inboxItemRef(item), 300);
  const [url] = bounded(item.url.trim(), 2_048);
  const project = projectFor(item, projects);
  return {
    key,
    title,
    provider: item.provider,
    kind: item.kind,
    reference,
    state: inboxItemStatus(item),
    url,
    ...(project ? { projectId: project.id } : {}),
    labels: item.labels.map(({ name, color }) => ({ name, color })),
    assignees: item.assignees.map(({ login, avatarUrl }) => ({
      login,
      ...(avatarUrl ? { avatarUrl } : {}),
    })),
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
    ...(item.stateReason ? { stateReason: item.stateReason } : {}),
    ...(item.attentionReason
      ? { attentionReason: item.attentionReason }
      : {}),
    ...(item.teamName ? { teamName: item.teamName } : {}),
    ...(item.projectName ? { projectName: item.projectName } : {}),
    draft: item.draft,
  };
}

async function detailBody(item: InboxItem): Promise<string> {
  if (item.provider === "linear" || item.provider === "jira") {
    return (await inboxTrackerDescription(item)) ?? "";
  }
  if (item.provider === "gitlab") {
    const kind = item.kind === "issue" || item.kind === "pr" ? item.kind : null;
    if (!kind) throw new Error("Unsupported GitLab item");
    return (await gitlabWorkItemDetails(item.repo, kind, item.number)).body;
  }
  if (item.provider === "azuredevops") {
    const kind = item.kind === "issue" || item.kind === "pr" ? item.kind : null;
    if (!kind) throw new Error("Unsupported Azure DevOps item");
    return (await azureDevOpsWorkItemDetails(item.repo, kind, item.number))
      .body;
  }
  const kind = item.kind === "issue" || item.kind === "pr" ? item.kind : null;
  if (!kind) throw new Error("Unsupported GitHub item");
  return (
    await githubWorkItemDetails(item.projectPath, item.repo, kind, item.number)
  ).body;
}

type DesktopComment = {
  id: string;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
  url: string;
  state: string;
  path: string;
  line: number | null;
  resolved: boolean;
  replies: DesktopComment[];
};

type DesktopThread = {
  comments: DesktopComment[];
  truncated: boolean;
  reviewDecision: string;
  baseRefName: string;
  headRefName: string;
};

type DesktopChanges = {
  additions: number;
  deletions: number;
  files: { path: string; additions: number; deletions: number }[];
  truncated: boolean;
};

type CommentBudget = { remaining: number };

function projectComment(
  comment: DesktopComment,
  budget: CommentBudget,
  depth = 0,
): { comment?: CompanionInboxComment; truncated: boolean } {
  if (budget.remaining <= 0) return { truncated: true };
  budget.remaining -= 1;
  const [id, idTruncated] = bounded(comment.id, COMMENT_ID_LIMIT);
  const [author, authorTruncated] = bounded(comment.author, COMMENT_AUTHOR_LIMIT);
  const [createdAt, dateTruncated] = bounded(comment.createdAt, COMMENT_DATE_LIMIT);
  const [url, urlTruncated] = bounded(comment.url, COMMENT_URL_LIMIT);
  const [state, stateTruncated] = bounded(comment.state, COMMENT_STATE_LIMIT);
  const [path, pathTruncated] = bounded(comment.path, COMMENT_PATH_LIMIT);
  const [body, bodyTruncated] = bounded(comment.body, COMMENT_BODY_LIMIT);
  const [authorAvatarUrl, avatarTruncated] = comment.authorAvatarUrl
    ? bounded(comment.authorAvatarUrl, COMMENT_AVATAR_URL_LIMIT)
    : ["", false];
  const replies: CompanionInboxComment[] = [];
  let repliesTruncated = depth >= COMMENT_DEPTH_LIMIT && comment.replies.length > 0;
  if (!repliesTruncated) {
    for (let index = 0; index < comment.replies.length; index += 1) {
      const reply = comment.replies[index]!;
      const projected = projectComment(reply, budget, depth + 1);
      if (projected.comment) replies.push(projected.comment);
      if (projected.truncated) repliesTruncated = true;
      if (budget.remaining <= 0) {
        if (index < comment.replies.length - 1) repliesTruncated = true;
        break;
      }
    }
  }
  return {
    comment: {
    id,
    author,
    ...(authorAvatarUrl ? { authorAvatarUrl } : {}),
    body,
    createdAt,
    url,
    state,
    path,
    line: comment.line,
    resolved: comment.resolved,
    replies,
    },
    truncated:
      idTruncated ||
      authorTruncated ||
      avatarTruncated ||
      bodyTruncated ||
      dateTruncated ||
      urlTruncated ||
      stateTruncated ||
      pathTruncated ||
      repliesTruncated,
  };
}

function projectThread(thread: DesktopThread): CompanionInboxThread {
  const budget = { remaining: COMMENT_LIMIT };
  const comments: CompanionInboxComment[] = [];
  let commentsTruncated = false;
  for (const comment of thread.comments) {
    const projected = projectComment(comment, budget);
    if (projected.comment) comments.push(projected.comment);
    if (projected.truncated) commentsTruncated = true;
    if (budget.remaining <= 0) {
      if (comments.length < thread.comments.length) commentsTruncated = true;
      break;
    }
  }
  return {
    comments,
    truncated:
      thread.truncated ||
      commentsTruncated,
    ...(thread.reviewDecision ? { reviewDecision: thread.reviewDecision } : {}),
    ...(thread.baseRefName ? { baseRefName: thread.baseRefName } : {}),
    ...(thread.headRefName ? { headRefName: thread.headRefName } : {}),
  };
}

function threadFor(item: InboxItem): Promise<DesktopThread> | null {
  if (item.provider === "linear") {
    return item.id ? linearIssueThread(item.id) : null;
  }
  if (item.provider === "jira") {
    return item.identifier ? jiraIssueThread(item.identifier) : null;
  }
  const kind = item.kind === "issue" || item.kind === "pr" ? item.kind : null;
  if (!kind) return null;
  if (item.provider === "gitlab") {
    return gitlabWorkItemThread(item.repo, kind, item.number);
  }
  if (item.provider === "azuredevops") {
    return azureDevOpsWorkItemThread(item.repo, kind, item.number);
  }
  return githubWorkItemThread(item.projectPath, item.repo, kind, item.number);
}

function changesFor(item: InboxItem): Promise<DesktopChanges> | null {
  if (item.kind !== "pr") return null;
  if (item.provider === "gitlab") return gitlabMrDiff(item.repo, item.number);
  if (item.provider === "azuredevops") {
    return azureDevOpsMrDiff(item.repo, item.number);
  }
  if (item.provider === "github") {
    return githubPrDiff(item.projectPath, item.repo, item.number);
  }
  return null;
}

function warning(prefix: string, error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return prefix + ": " + bounded(value, ERROR_LIMIT)[0];
}

async function settle<T>(job: Promise<T>) {
  try {
    return { value: await job, error: undefined as unknown };
  } catch (error) {
    return { value: undefined as T | undefined, error };
  }
}

async function detailExtras(
  item: InboxItem,
): Promise<Omit<CompanionInboxRead, "item" | "body" | "truncated" | "nextOffset">> {
  const threadJob = threadFor(item);
  const changesJob = changesFor(item);
  const [thread, changes] = await Promise.all([
    settle(threadJob ? threadJob.then(projectThread) : Promise.resolve(undefined)),
    settle(changesJob
      ? changesJob.then((diff) => ({
          additions: diff.additions,
          deletions: diff.deletions,
          files: diff.files.slice(0, CHANGE_FILE_LIMIT).map((file) => ({ ...file })),
          truncated: diff.truncated || diff.files.length > CHANGE_FILE_LIMIT,
        }))
      : Promise.resolve(undefined)),
  ]);
  const warnings = [
    thread.error ? warning("Comments unavailable", thread.error) : "",
    changes.error ? warning("Changed files unavailable", changes.error) : "",
  ].filter(Boolean);
  return {
    ...(thread.value ? { thread: thread.value } : {}),
    ...(changes.value ? { changes: changes.value } : {}),
    ...(warnings.length ? { summaryWarnings: warnings } : {}),
  };
}

/** A narrow, cached desktop Inbox projection for items already listed here. */
export function createCompanionInbox(
  projects: () => readonly CompanionInboxProject[],
) {
  const advertised = new Map<string, CachedItem>();

  async function list(): Promise<CompanionInboxList> {
    const currentProjects = projects();
    const filters = pruneInboxFilters(
      loadInboxFilters(),
      currentProjects.map((project) => project.path),
    );
    const query = {
      assignedToMe: filters.assignedToMe,
      state: inboxFetchState(filters),
      search: "",
      linearHiddenTeamIds: loadHiddenLinearTeamIds(),
      jiraHiddenProjectIds: loadHiddenJiraProjectIds(),
    } as const;

    let result: Awaited<ReturnType<typeof listInboxItems>>;
    try {
      result = await listInboxItems(currentProjects, query);
    } catch (error) {
      advertised.clear();
      const message = error instanceof Error ? error.message : String(error);
      return {
        items: [],
        errors: [bounded(message, ERROR_LIMIT)[0]],
        truncated: false,
      };
    }

    advertised.clear();
    const visible = result.items.filter(
      (item) =>
        applyInboxFilters([item], filters, "", Date.now(), item.provider)
          .length > 0,
    );
    let truncated = visible.length > ITEM_LIMIT;
    const items: CompanionInboxItem[] = [];
    for (const item of visible) {
      if (items.length >= ITEM_LIMIT) break;
      const summary = summaryFor(item, currentProjects);
      if (!summary) {
        truncated = true;
        continue;
      }
      const snapshot = cachedItem(item);
      advertised.set(summary.key, { item: snapshot, summary });
      items.push(summary);
    }
    return {
      items,
      errors: Object.values(result.errors)
        .filter((message): message is string => typeof message === "string")
        .slice(0, 5)
        .map((message) => bounded(message, ERROR_LIMIT)[0]),
      truncated,
    };
  }

  async function read(key: string, offset = 0): Promise<CompanionInboxRead> {
    const entry = advertised.get(key);
    if (!entry)
      throw new Error("Inbox item is no longer available; refresh Inbox");
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error("Inbox description offset is invalid");
    }
    if (entry.body === undefined) {
      entry.body = await detailBody(entry.item);
    }
    if (!entry.extrasLoaded) {
      entry.extras = await detailExtras(entry.item);
      entry.extrasLoaded = true;
    }
    const body = entry.body.slice(offset, offset + BODY_PAGE_LIMIT);
    const nextOffset = offset + body.length;
    const truncated = nextOffset < entry.body.length;
    return {
      item: entry.summary,
      body,
      truncated,
      ...(truncated ? { nextOffset } : {}),
      ...entry.extras,
    };
  }

  return { list, read };
}
