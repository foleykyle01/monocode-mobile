// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { motionDuration, tabCloseDuration } from "./motion";

afterEach(() => {
  document.documentElement.style.removeProperty("--motion-tab-close-duration");
  vi.restoreAllMocks();
});

it("shares CSS seconds/milliseconds, preserving zero instead of a fallback delay", () => {
  expect(motionDuration("--missing", 220)).toBe(220);
  for (const [value, expected] of [[".2s", 200], ["160ms", 160], ["0ms", 0]] as const) {
    document.documentElement.style.setProperty("--motion-tab-close-duration", value);
    expect(tabCloseDuration()).toBe(expected);
  }
});

it("honors OS reduced motion even when a timing token has not been refreshed", () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  document.documentElement.style.setProperty("--motion-tab-close-duration", "200ms");
  expect(tabCloseDuration()).toBe(0);
});
