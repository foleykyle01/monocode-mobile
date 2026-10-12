import {
  loadTranscriptLayout,
} from "../../settings/model/appearance";
import { loadUiScale } from "../../settings/model/uiScale";

/** Export visual values only. Never expose localStorage, file paths, or credentials. */
export function companionAppearance() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const number = (key: string, fallback: number, max: number) => {
    const value = parseFloat(style.getPropertyValue(key));
    return Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback;
  };
  const light = root.classList.contains("theme-light");
  const accent = style.getPropertyValue("--color-accent").trim();
  const userAccent = style.getPropertyValue("--user-accent-color").trim();
  const userAccentForeground = style.getPropertyValue("--user-accent-foreground").trim();
  const linkColor = style.getPropertyValue("--link-color").trim();
  const headingColor = style.getPropertyValue("--color-markdown-heading").trim();
  const fontSans = style.getPropertyValue("--font-sans").trim();
  const fontMono = style.getPropertyValue("--font-mono").trim();
  const validColor = (color: string) => /^(#[\da-f]{3,8}|(?:hsl|rgb)a?\([\d\s.,%/]+\))$/i.test(color);
  // Font stacks come from the desktop stylesheet. Keep them bounded and free
  // of CSS rule delimiters before the phone applies them as custom properties.
  const validFont = (font: string) =>
    font.length > 0 && font.length <= 512 && !/[{};@]/.test(font);
  return {
    // Additive fields remain compatible with v1 companion clients.
    version: 1,
    scheme: light ? "light" : "dark",
    hue: number("--theme-hue", 240, 360),
    saturation: number("--theme-saturation", 0, 100),
    backgroundLightness: number("--background-lightness", light ? 97 : 9, 100),
    contentLightness: number("--content-lightness", light ? 18 : 92, 100),
    accent: /^(#[\da-f]{3,8}|(?:hsl|rgb)a?\([\d\s.,%/]+\))$/i.test(accent) ? accent : "hsl(211 92% 62%)",
    ...(validColor(linkColor) ? { linkColor } : {}),
    ...(validColor(headingColor) ? { headingColor } : {}),
    ...(validFont(fontSans) ? { fontSans } : {}),
    ...(validFont(fontMono) ? { fontMono } : {}),
    uiScale: loadUiScale(),
    transcriptLayout: loadTranscriptLayout(),
    ...(root.classList.contains("has-user-accent") && validColor(userAccent) ? {
      userAccent,
      userAccentForeground: validColor(userAccentForeground) ? userAccentForeground : "#000000",
    } : {}),
  };
}
