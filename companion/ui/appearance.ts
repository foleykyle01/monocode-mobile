import type { CSSProperties } from "react";
import type { CompanionAppearance } from "./types";

export type AppearanceMode = "host" | "light" | "dark";
export const BASE_APPEARANCES: Record<"light" | "dark", CompanionAppearance> = {
  light: { version: 1, scheme: "light", hue: 240, saturation: 0, backgroundLightness: 97, contentLightness: 18, accent: "hsl(211 92% 40%)" },
  dark: { version: 1, scheme: "dark", hue: 240, saturation: 0, backgroundLightness: 9, contentLightness: 92, accent: "hsl(211 92% 62%)" },
};

export function readAppearanceMode(key: string): AppearanceMode {
  try {
    const value = localStorage.getItem(key);
    return value === "light" || value === "dark" ? value : "host";
  } catch { return "host"; }
}

export function resolveAppearance(mode: AppearanceMode, host?: CompanionAppearance): CompanionAppearance | undefined {
  if (mode === "host") return host;
  return { ...BASE_APPEARANCES[mode], fontSans: host?.fontSans, fontMono: host?.fontMono, transcriptLayout: host?.transcriptLayout };
}

/** Recompute on each host snapshot; omitted values remove previous overrides. */
export function appearanceStyle(appearance?: CompanionAppearance): CSSProperties {
  if (!appearance) return {};
  return {
    colorScheme: appearance.scheme,
    "--companion-bg": `hsl(${appearance.hue} ${appearance.saturation}% ${appearance.backgroundLightness}%)`,
    "--companion-content": `hsl(${appearance.hue} ${appearance.saturation}% ${appearance.contentLightness}%)`,
    "--companion-accent": appearance.accent,
    "--companion-sans": appearance.fontSans,
    "--companion-mono": appearance.fontMono,
    "--companion-link": appearance.linkColor,
    "--companion-heading": appearance.headingColor,
    // The phone keeps a fixed type scale, independently of desktop zoom.
    "--companion-ui-scale": 1,
    ...(appearance.userAccent ? {
      "--companion-send-bg": appearance.userAccent,
      "--companion-send-ink": appearance.userAccentForeground,
      "--companion-user-bg": `color-mix(in srgb, ${appearance.userAccent} 24%, transparent)`,
      "--companion-user-border": `color-mix(in srgb, ${appearance.userAccent} 30%, transparent)`,
    } : {}),
  } as CSSProperties;
}
