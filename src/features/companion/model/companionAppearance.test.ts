// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { companionAppearance } from "./companionAppearance";

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
});

describe("companion appearance export", () => {
  it("exports the desktop typography, color, scale, and transcript settings", () => {
    const root = document.documentElement;
    root.classList.add("theme-light", "has-user-accent");
    root.style.setProperty("--font-sans", 'Inter, system-ui, sans-serif');
    root.style.setProperty("--font-mono", '"JetBrains Mono", monospace');
    root.style.setProperty("--link-color", "#0369a1");
    root.style.setProperty("--color-markdown-heading", "#be185d");
    root.style.setProperty("--user-accent-color", "#ff00aa");
    root.style.setProperty("--user-accent-foreground", "#000000");
    localStorage.setItem("monocode.uiScale", "1.3");
    localStorage.setItem("monocode.transcriptLayout", "full");

    expect(companionAppearance()).toMatchObject({
      version: 1,
      scheme: "light",
      fontSans: "Inter, system-ui, sans-serif",
      fontMono: '"JetBrains Mono", monospace',
      linkColor: "#0369a1",
      headingColor: "#be185d",
      userAccent: "#ff00aa",
      userAccentForeground: "#000000",
      uiScale: 1.3,
      transcriptLayout: "full",
    });
  });

  it("drops an unavailable user accent while retaining the desktop defaults", () => {
    const root = document.documentElement;
    root.style.setProperty("--font-sans", "system-ui");
    root.style.setProperty("--font-mono", "monospace");
    root.style.setProperty("--link-color", "#7dd3fc");
    root.style.setProperty("--color-markdown-heading", "#f9a8c9");

    expect(companionAppearance()).toMatchObject({
      fontSans: "system-ui",
      fontMono: "monospace",
      linkColor: "#7dd3fc",
      headingColor: "#f9a8c9",
      uiScale: 1,
      transcriptLayout: "chat",
    });
    expect(companionAppearance()).not.toHaveProperty("userAccent");
  });
});
