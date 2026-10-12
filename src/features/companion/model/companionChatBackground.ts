import type { Session } from "../../sessions/model/session";
import {
  chatBackgroundSrc,
  isLightScheme,
  loadChatBackgroundEmptyOpacity,
  loadChatBackgroundPath,
  loadChatBackgroundScope,
  loadChatBackgroundSessionOpacity,
  loadNewThreadBackgroundEffect,
  type NewThreadBackgroundEffect,
} from "../../settings/model/appearance";
import { monoChatBackground } from "../../monos/model/monoBackground";
import { projectKey } from "../../../shared/lib/paths";
import { projectChatBackgroundSrc } from "../../projects/model/chatBackground";
import {
  loadProjectChatBackgroundSettings,
  projectChatBackgroundImageRevision,
  type ProjectChatBackgroundSettings,
} from "../../projects/model/projectChatBackground";
import { prepareNewThreadBackgroundEffect } from "../../settings/model/newThreadBackgroundEffects";

const MAX_EDGE = 1024;
const MAX_DATA_URL_LENGTH = 128 * 1024;
const CACHE_LIMIT = 32;

export type CompanionChatBackground = {
  /** A rendered image, never the desktop's local asset path or asset URL. */
  image?: string;
  scope: "empty" | "all";
  emptyOpacity: number;
  sessionOpacity: number;
  effect: NewThreadBackgroundEffect;
};

type ResolvedBackground = {
  settings: ProjectChatBackgroundSettings;
  source: string;
  cacheKey: string;
};

type CacheEntry = {
  state: "pending" | "ready" | "failed";
  image?: string;
};

const imageCache = new Map<string, CacheEntry>();

function touch(key: string, value: CacheEntry) {
  imageCache.delete(key);
  imageCache.set(key, value);
}

function makeRoom() {
  while (imageCache.size >= CACHE_LIMIT) {
    const settled = [...imageCache.entries()].find(
      ([, entry]) => entry.state !== "pending",
    );
    if (!settled) break;
    imageCache.delete(settled[0]);
  }
}

function settingsFor(
  session: Pick<Session, "cwd">,
  monoId?: string,
): ResolvedBackground | null {
  const revision = projectChatBackgroundImageRevision();
  const mono = monoId ? monoChatBackground(monoId) : null;
  // Mono panes intentionally use only their own artwork, matching desktop.
  if (mono) {
    const source = projectChatBackgroundSrc(mono.path, revision);
    return {
      settings: mono,
      source,
      cacheKey: `mono:${monoId}:${source}:${mono.effect}:${isLightScheme()}`,
    };
  }
  if (monoId) return null;

  const project = loadProjectChatBackgroundSettings(projectKey(session.cwd));
  if (project) {
    const source = projectChatBackgroundSrc(project.path, revision);
    return {
      settings: project,
      source,
      cacheKey: `project:${projectKey(session.cwd)}:${source}:${project.effect}:${isLightScheme()}`,
    };
  }

  const path = loadChatBackgroundPath();
  const source = chatBackgroundSrc(path);
  if (!path || !source) return null;
  const settings: ProjectChatBackgroundSettings = {
    path,
    emptyOpacity: loadChatBackgroundEmptyOpacity(),
    sessionOpacity: loadChatBackgroundSessionOpacity(),
    scope: loadChatBackgroundScope(),
    effect: loadNewThreadBackgroundEffect(),
  };
  return {
    settings,
    source,
    cacheKey: `global:${source}:${settings.effect}:${isLightScheme()}`,
  };
}

function dataUrl(image: HTMLImageElement): string | undefined {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight || typeof document === "undefined") return;

  const initialScale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return;

  for (const scale of [initialScale, initialScale * 0.75, initialScale * 0.5, initialScale * 0.35]) {
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.84, 0.7, 0.55, 0.4]) {
      const value = canvas.toDataURL("image/jpeg", quality);
      if (value.startsWith("data:image/jpeg;base64,") && value.length <= MAX_DATA_URL_LENGTH) {
        return value;
      }
    }
  }
}

function renderImage(source: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(undefined);
      return;
    }
    try {
      const image = new Image();
      let settled = false;
      const finish = (value: string | undefined) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        resolve(value);
      };
      // A broken native asset can otherwise hold a transcript read forever.
      const timeout = window.setTimeout(() => finish(undefined), 10_000);
      image.crossOrigin = "anonymous";
      image.onload = () => {
        try {
          finish(dataUrl(image));
        } catch {
          finish(undefined);
        }
      };
      image.onerror = () => finish(undefined);
      image.src = source;
    } catch {
      resolve(undefined);
    }
  });
}

async function render(resolved: ResolvedBackground): Promise<string | undefined> {
  const { settings, source } = resolved;
  if (settings.effect === "none" || settings.effect === "gradient-blur") {
    return renderImage(source);
  }
  try {
    const image = await prepareNewThreadBackgroundEffect(
      resolved.cacheKey,
      source,
      settings.effect,
      isLightScheme(),
    );
    const renderedSource = URL.createObjectURL(image);
    try {
      return await renderImage(renderedSource);
    } finally {
      URL.revokeObjectURL(renderedSource);
    }
  } catch {
    // A background must never hold up a transcript. Cache this failure so
    // routine transcript polls do not keep restarting an unavailable image.
    return undefined;
  }
}

/**
 * Returns metadata immediately and starts a lazy conversion when needed. A
 * later read receives the finished rendered image. This keeps reconnects and
 * transcripts independent of image loading, while local paths never cross the
 * companion boundary.
 */
export function companionChatBackground(
  session: Pick<Session, "cwd">,
  monoId?: string,
): CompanionChatBackground | null {
  const resolved = settingsFor(session, monoId);
  if (!resolved) return null;

  let entry = imageCache.get(resolved.cacheKey);
  if (entry) {
    touch(resolved.cacheKey, entry);
  } else {
    makeRoom();
    if (imageCache.size < CACHE_LIMIT) {
      const pending: CacheEntry = { state: "pending" };
      entry = pending;
      touch(resolved.cacheKey, pending);
      void render(resolved).then((image) => {
        if (imageCache.get(resolved.cacheKey) !== pending) return;
        pending.state = image ? "ready" : "failed";
        pending.image = image;
      });
    }
  }

  return {
    ...(entry?.state === "ready" && entry.image ? { image: entry.image } : {}),
    scope: resolved.settings.scope,
    emptyOpacity: resolved.settings.emptyOpacity,
    sessionOpacity: resolved.settings.sessionOpacity,
    effect: resolved.settings.effect,
  };
}
