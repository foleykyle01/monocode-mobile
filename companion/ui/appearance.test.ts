// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { appearanceStyle, readAppearanceMode, resolveAppearance } from "./appearance";
import { ChatBackground } from "./ChatBackground";
import type { CompanionAppearance, CompanionChatBackground } from "./types";

const dark: CompanionAppearance = { version: 1, scheme: "dark", hue: 275, saturation: 24, backgroundLightness: 12, contentLightness: 92, accent: "#69b7ff", userAccent: "#b8a0e8", userAccentForeground: "#000000", fontSans: "system-ui", fontMono: "Menlo, monospace", linkColor: "#7dd3fc", headingColor: "#f9a8c9", uiScale: 1.3 };

it("defaults to the host and applies neutral overrides without inheriting custom colors", () => {
  expect(resolveAppearance("host", dark)).toBe(dark);
  expect(resolveAppearance("host")).toBeUndefined();
  for (const mode of ["light", "dark"] as const) {
    const override = resolveAppearance(mode, dark)!;
    expect(override.scheme).toBe(mode);
    expect(override.saturation).toBe(0);
    expect(override.userAccent).toBeUndefined();
    expect(override.linkColor).toBeUndefined();
    expect(override.fontMono).toBe(dark.fontMono);
    expect(appearanceStyle(override)["--companion-ui-scale" as keyof React.CSSProperties]).toBe(1);
  }
  localStorage.setItem("test-theme", "unknown");
  expect(readAppearanceMode("test-theme")).toBe("host");
  localStorage.setItem("test-theme", "light");
  expect(readAppearanceMode("test-theme")).toBe("light");
  localStorage.removeItem("test-theme");
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Unavailable"); });
  try { expect(readAppearanceMode("test-theme")).toBe("host"); } finally { get.mockRestore(); }
});

it("updates the inherited theme and removes previous accent/font overrides when the Mac clears them", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement("main", { style: appearanceStyle(dark) })));
    const style = container.querySelector("main")!.style;
    expect(style.getPropertyValue("--companion-send-bg")).toBe("#b8a0e8");
    expect(style.getPropertyValue("--companion-ui-scale")).toBe("1");
    expect(style.getPropertyValue("--companion-mono")).toBe("Menlo, monospace");
    await act(async () => root.render(createElement("main", { style: appearanceStyle({ version: 1, scheme: "light", hue: 200, saturation: 10, backgroundLightness: 97, contentLightness: 18, accent: "#3080bb" }) })));
    expect(style.colorScheme).toBe("light");
    expect(style.getPropertyValue("--companion-bg")).toBe("hsl(200 10% 97%)");
    expect(style.getPropertyValue("--companion-send-bg")).toBe("");
    expect(style.getPropertyValue("--companion-mono")).toBe("");
    expect(style.getPropertyValue("--companion-ui-scale")).toBe("1");
    await act(async () => root.render(createElement("main", { style: appearanceStyle() })));
    expect(style.getPropertyValue("--companion-bg")).toBe("");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("honors background scope and opacity, reuses desktop Haze, and rejects paths or oversized image data", () => {
  const background: CompanionChatBackground = { image: "data:image/png;base64,YQ==", scope: "empty", emptyOpacity: .4, sessionOpacity: .15, effect: "gradient-blur" };
  const render = (value: CompanionChatBackground | null, empty: boolean) => renderToStaticMarkup(createElement(ChatBackground, { background: value, empty }));
  expect(render(background, true)).toContain("opacity:0.4");
  expect(render(background, false)).toContain('opacity:0"');
  expect(render({ ...background, scope: "all" }, false)).toContain("opacity:0.15");
  expect(render(background, true)).toContain("gradient-blur-background-strong");
  for (const image of ["/Users/me/private.png", "https://example.com/image.png", "data:image/svg+xml;base64,YQ==", `data:image/png;base64,${"A".repeat(128 * 1024)}`]) {
    expect(render({ ...background, image }, true)).toBe("");
  }
  expect(render(null, true)).toBe("");
});
