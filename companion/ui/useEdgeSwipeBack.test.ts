// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEdgeSwipeBack } from "./useEdgeSwipeBack";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const back = vi.fn();
function Page({ enabled = true, pageKey = "chat", onBack = back }) {
  return createElement("section", { ref: useEdgeSwipeBack(onBack, enabled, pageKey) }, createElement("textarea"));
}
function touch(type: string, x: number, y: number, options: { target?: Element; count?: number; cancelable?: boolean } = {}) {
  const point = { identifier: 1, clientX: x, clientY: y };
  const event = new Event(type, { bubbles: true, cancelable: options.cancelable ?? true });
  Object.defineProperties(event, {
    touches: { value: type === "touchend" ? [] : Array.from({ length: options.count ?? 1 }, () => point) },
    changedTouches: { value: [point] },
  });
  (options.target || container.querySelector("section")!).dispatchEvent(event);
  return event;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  back.mockClear();
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Page)));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("waits for release, prevents a click after a drag, and calls only the current back action once", async () => {
  touch("touchstart", 8, 200);
  expect(touch("touchmove", 110, 205).defaultPrevented).toBe(true);
  expect(back).not.toHaveBeenCalled();
  const latest = vi.fn();
  await act(async () => root.render(createElement(Page, { onBack: latest })));
  expect(touch("touchend", 120, 205).defaultPrevented).toBe(true);
  touch("touchend", 120, 205);
  expect(latest).toHaveBeenCalledTimes(1);
  expect(back).not.toHaveBeenCalled();
});

it.each(["middle", "vertical", "left", "short", "reverse", "cancel", "multitouch", "scrolling", "input", "selection", "dialog", "desktop", "disabled", "navigation"])("does not navigate for %s", async scenario => {
  if (scenario === "desktop") vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
  if (scenario === "disabled") await act(async () => root.render(createElement(Page, { enabled: false })));
  if (scenario === "dialog") { const dialog = document.createElement("dialog"); dialog.open = true; container.append(dialog); }
  if (scenario === "selection") vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "Selected text" } as Selection);
  const target = scenario === "input" ? container.querySelector("textarea")! : undefined;
  touch("touchstart", scenario === "middle" ? 100 : 8, 200, { target });
  if (scenario === "vertical") expect(touch("touchmove", 12, 235).defaultPrevented).toBe(false);
  if (scenario === "left") touch("touchmove", -15, 200);
  if (scenario === "multitouch") touch("touchmove", 20, 200, { count: 2 });
  if (scenario === "navigation") await act(async () => root.render(createElement(Page, { pageKey: "another-chat" })));
  touch("touchmove", scenario === "short" ? 40 : 120, 205, { target, cancelable: scenario !== "scrolling" });
  if (scenario === "cancel") touch("touchcancel", 120, 205);
  touch("touchend", scenario === "short" || scenario === "reverse" ? 40 : 120, 205, { target });
  expect(back).not.toHaveBeenCalled();
});
