import { projectKey, projectName } from "../../../shared/lib/paths";
import { projectLogoSrc } from "../../projects/model/projectLogos";
import { projectMascot } from "../../projects/model/projectMascots";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLogos,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";

const THUMBNAIL_SIZE = 64;
const MAX_CACHE_ENTRIES = 200;
const MAX_LOGO_DATA_URL_LENGTH = 16 * 1024;

export type CompanionProjectAppearance = {
  mascot: string;
  color: string;
  /** A small inline PNG; source paths never cross the companion boundary. */
  logo?: string;
};

type LogoCacheEntry = {
  source: string;
  status: "pending" | "ready" | "failed";
  logo?: string;
};

const logoCache = new Map<string, LogoCacheEntry>();

function remember(key: string, entry: LogoCacheEntry): void {
  logoCache.delete(key);
  logoCache.set(key, entry);
  while (logoCache.size > MAX_CACHE_ENTRIES) {
    const oldest = logoCache.keys().next().value;
    if (oldest === undefined) break;
    logoCache.delete(oldest);
  }
}

function thumbnail(image: HTMLImageElement): string {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height || typeof document === "undefined") {
    throw new Error("logo image has no dimensions");
  }

  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("logo canvas is unavailable");

  const scale = Math.min(THUMBNAIL_SIZE / width, THUMBNAIL_SIZE / height);
  const drawWidth = Math.max(1, Math.round(width * scale));
  const drawHeight = Math.max(1, Math.round(height * scale));
  context.clearRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  context.drawImage(
    image,
    Math.round((THUMBNAIL_SIZE - drawWidth) / 2),
    Math.round((THUMBNAIL_SIZE - drawHeight) / 2),
    drawWidth,
    drawHeight,
  );

  const dataUrl = canvas.toDataURL("image/png");
  if (
    !dataUrl.startsWith("data:image/png;base64,") ||
    dataUrl.length > MAX_LOGO_DATA_URL_LENGTH
  ) {
    throw new Error("logo thumbnail is too large");
  }
  return dataUrl;
}

function loadLogo(key: string, entry: LogoCacheEntry): void {
  if (typeof Image === "undefined") {
    entry.status = "failed";
    return;
  }

  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (logoCache.get(key) !== entry) return;
      try {
        entry.logo = thumbnail(image);
        entry.status = "ready";
      } catch {
        entry.status = "failed";
      }
    };
    image.onerror = () => {
      if (logoCache.get(key) === entry) entry.status = "failed";
    };
    image.src = entry.source;
  } catch {
    if (logoCache.get(key) === entry) entry.status = "failed";
  }
}

/**
 * Reads the desktop's saved project appearance and returns a phone-safe view.
 * Logo conversion is lazy so navigation polls stay synchronous and bounded.
 */
export function companionProjectAppearance(
  path: string,
): CompanionProjectAppearance {
  const key = projectKey(path);
  const seed = projectName(path);
  const mascots = loadTabGroupMascots();
  const mascot = projectMascot(
    seed,
    resolveTabGroupMascot(key, mascots),
  ).name;
  const color = resolveTabGroupColor(
    key,
    loadTabGroupColors(),
    loadTabGroupCustomColors(),
    seed,
  );

  const logoPath = resolveTabGroupLogo(key, loadTabGroupLogos());
  const source = projectLogoSrc(logoPath);
  if (!source) {
    logoCache.delete(key);
    return { mascot, color };
  }

  const cached = logoCache.get(key);
  if (cached?.source === source) {
    logoCache.delete(key);
    logoCache.set(key, cached);
    return cached.status === "ready" && cached.logo
      ? { mascot, color, logo: cached.logo }
      : { mascot, color };
  }

  const entry: LogoCacheEntry = { source, status: "pending" };
  remember(key, entry);
  loadLogo(key, entry);
  return { mascot, color };
}
