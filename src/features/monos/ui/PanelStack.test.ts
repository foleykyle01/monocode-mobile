// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PanelStack } from "./PanelStack";

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.style.removeProperty("--motion-navigation-duration");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("cancels a departing page's removal when quickly reopened", () => {
  document.documentElement.style.setProperty("--motion-navigation-duration", "90ms");
  render(["settings"]);
  render([]);
  act(() => void vi.advanceTimersByTime(45));
  render(["settings"]);
  act(() => void vi.advanceTimersByTime(100));
  expect(reachable()).toEqual(["settings"]);
  render([]);
  act(() => void vi.advanceTimersByTime(91));
  expect(container.textContent).toBe("panel");
});

it("finishes an outgoing layer if reduced motion changes during navigation", () => {
  let reduced = false;
  const preference = new EventTarget();
  Object.defineProperty(preference, "matches", { get: () => reduced });
  vi.spyOn(window, "matchMedia").mockReturnValue(preference as MediaQueryList);
  render(["settings"]);
  render([]);
  expect(container.textContent).toContain("settings");
  act(() => { reduced = true; preference.dispatchEvent(new Event("change")); });
  expect(container.textContent).toBe("panel");
  act(() => void vi.advanceTimersByTime(300));
  expect(reachable()).toEqual(["panel"]);
});

it("removes reduced-motion pages immediately and restores the opener without scrolling", () => {
  document.documentElement.style.setProperty("--motion-navigation-duration", "0ms");
  const draw = (open: boolean) => act(() => root.render(createElement(PanelStack, {
    pages: open ? [{ key: "settings", node: createElement("button", null, "Back") }] : [],
    children: createElement("button", null, "Settings"),
  })));
  draw(false);
  const opener = container.querySelector("button")!;
  opener.focus();
  draw(true);
  container.querySelectorAll("button")[1].focus();
  draw(false);
  expect(container.textContent).toBe("Settings");
  act(() => void vi.advanceTimersByTime(30));
  expect(document.activeElement).toBe(opener);
});

const render = (keys: string[]) =>
  act(() =>
    root.render(
      createElement(PanelStack, {
        pages: keys.map((key) => ({ key, node: createElement("p", null, key) })),
        children: createElement("p", null, "panel"),
      }),
    ),
  );
const reachable = () =>
  [...container.querySelectorAll("p")]
    .filter((p) => !p.closest("[inert]"))
    .map((p) => p.textContent);

it("stacks pages, with only the top one in reach, and lets them slide away", () => {
  render([]);
  expect(reachable()).toEqual(["panel"]);
  render(["settings"]);
  act(() => void vi.advanceTimersByTime(50));
  expect(reachable()).toEqual(["settings"]);
  render(["settings", "habit"]);
  act(() => void vi.advanceTimersByTime(50));
  expect(reachable()).toEqual(["habit"]);
  expect(container.textContent).toBe("panelsettingshabit");
  // Back: the habit page slides out, staying mounted until it is gone.
  render(["settings"]);
  expect(container.textContent).toBe("panelsettingshabit");
  expect(reachable()).toEqual(["settings"]);
  act(() => void vi.advanceTimersByTime(400));
  expect(container.textContent).toBe("panelsettings");
  render([]);
  act(() => void vi.advanceTimersByTime(400));
  expect(container.textContent).toBe("panel");
  expect(reachable()).toEqual(["panel"]);
});
