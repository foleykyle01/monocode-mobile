import {
  gitDiffIndex,
  gitFileDiff,
  type GitChangedFile,
  type GitFileDiffKind,
} from "../../../platform/tauri/fs";

const READ_LIMIT = 64 * 1024;
const SNAPSHOT_FILE_LIMIT = 200;

export type CompanionChangesTarget = {
  projectId: string;
  sessionId?: string;
};

export type CompanionChangedFile = {
  relative: string;
  status: string;
  additions: number;
  deletions: number;
  staged: boolean;
  unstaged: boolean;
};

export type CompanionChangesList = {
  branch: string | null;
  head: string | null;
  files: CompanionChangedFile[];
  additions: number;
  deletions: number;
  revision: string;
};

export type CompanionChangeRead = {
  relative: string;
  kind: GitFileDiffKind;
  status: string;
  original: string;
  current: string;
  binary: boolean;
  tooLarge: boolean;
  truncated: boolean;
  revision: string;
};

function validRelative(relative: string): boolean {
  return typeof relative === "string" && relative.length > 0 && relative.length <= 1_024
    && !relative.startsWith("/") && !relative.includes("\\") && !relative.includes("\0")
    && relative.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

async function fingerprint(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
  return `changes-1-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function listed(file: GitChangedFile): CompanionChangedFile {
  return {
    relative: file.relative,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    staged: file.staged,
    unstaged: file.unstaged,
  };
}

function targetCwd(
  resolveTarget: (target: CompanionChangesTarget) => string,
  target: CompanionChangesTarget,
): string {
  if (!target || typeof target.projectId !== "string" || !target.projectId.trim())
    throw new Error("Invalid project target");
  if (target.sessionId !== undefined && (typeof target.sessionId !== "string" || !target.sessionId))
    throw new Error("Invalid session target");
  const cwd = resolveTarget(target);
  if (typeof cwd !== "string" || !cwd.trim()) throw new Error("Project is unavailable to this companion");
  return cwd;
}

/** A read-only, desktop-only Git boundary. The bridge resolves targets to an
 * already-authorized local checkout; callers never supply a filesystem path. */
export function createCompanionChanges(
  resolveTarget: (target: CompanionChangesTarget) => string,
) {
  async function snapshot(target: CompanionChangesTarget): Promise<{
    cwd: string;
    files: GitChangedFile[];
    list: CompanionChangesList;
  }> {
    const cwd = targetCwd(resolveTarget, target);
    const index = await gitDiffIndex(cwd);
    if (index.files.length > SNAPSHOT_FILE_LIMIT)
      throw new Error("Too many changed files; review this workspace on your Mac");
    const files = index.files.filter((file) => validRelative(file.relative));
    if (files.length !== index.files.length)
      throw new Error("Changes include an invalid path; review them on your Mac");
    const material = JSON.stringify({
      cwd,
      branch: index.branch,
      head: index.head,
      files: files.map(listed),
    });
    return {
      cwd,
      files,
      list: {
        branch: index.branch,
        head: index.head,
        files: files.map(listed),
        additions: index.additions,
        deletions: index.deletions,
        revision: await fingerprint(material),
      },
    };
  }

  function advertised(current: { files: GitChangedFile[] }, relative: string, kind: GitFileDiffKind): GitChangedFile {
    if (!validRelative(relative)) throw new Error("Invalid changed file path");
    const file = current.files.find((entry) => entry.relative === relative && entry[kind]);
    if (!file) throw new Error("File is no longer available in these changes");
    return file;
  }

  return {
    async list(target: CompanionChangesTarget): Promise<CompanionChangesList> {
      return (await snapshot(target)).list;
    },

    async read(
      target: CompanionChangesTarget,
      relative: string,
      kind: GitFileDiffKind,
    ): Promise<CompanionChangeRead> {
      if (kind !== "staged" && kind !== "unstaged") throw new Error("Invalid changes section");
      const current = await snapshot(target);
      advertised(current, relative, kind);
      const diff = await gitFileDiff(current.cwd, relative, kind);
      const truncated = diff.binary || diff.tooLarge
        || diff.original.length > READ_LIMIT || diff.current.length > READ_LIMIT;
      return {
        relative: diff.relative,
        kind,
        status: diff.status,
        original: diff.original.slice(0, READ_LIMIT),
        current: diff.current.slice(0, READ_LIMIT),
        binary: diff.binary,
        tooLarge: diff.tooLarge,
        truncated,
        // This is list metadata for older phone clients. The current UI accepts
        // this authorized file's current content instead of treating it as a precondition.
        revision: current.list.revision,
      };
    },
  };
}
