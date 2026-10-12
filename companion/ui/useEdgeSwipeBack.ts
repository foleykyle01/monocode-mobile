import { useEffect, useLayoutEffect, useRef } from "react";

/** Touch-only back navigation; vertical scrolling keeps ownership until intent is clear. */
export function useEdgeSwipeBack(onBack: () => void, enabled = true, pageKey?: string) {
  const surface = useRef<HTMLElement>(null);
  const back = useRef(onBack);
  useLayoutEffect(() => { back.current = onBack; });

  useEffect(() => {
    const element = surface.current;
    if (!enabled || !element) return;
    let gesture: { id: number; x: number; y: number; claimed: boolean } | undefined;
    const cancel = () => { gesture = undefined; };
    const start = (event: TouchEvent) => {
      cancel();
      if (event.touches.length !== 1 || !window.matchMedia("(max-width: 700px)").matches) return;
      if (document.querySelector("dialog[open]") || window.getSelection()?.toString()) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      const touch = event.touches[0];
      if (touch.clientX < 0 || touch.clientX > 24) return;
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, claimed: false };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || touch.identifier !== gesture.id) { cancel(); return; }
      const dx = touch.clientX - gesture.x;
      const dy = Math.abs(touch.clientY - gesture.y);
      if (!gesture.claimed) {
        if (dy > 10 && dy >= dx || dx < -10) { cancel(); return; }
        if (dx < 12 || dx < dy * 1.5) return;
        // A non-cancelable move means the browser already started scrolling.
        if (!event.cancelable) { cancel(); return; }
        gesture.claimed = true;
      }
      event.preventDefault();
    };
    const end = (event: TouchEvent) => {
      const current = gesture;
      cancel();
      if (!current?.claimed || event.touches.length) return;
      const touch = Array.from(event.changedTouches).find(entry => entry.identifier === current.id);
      if (!touch) return;
      event.preventDefault(); // Suppress a tap on the control underneath the completed drag.
      const dx = touch.clientX - current.x;
      if (dx >= 72 && Math.abs(touch.clientY - current.y) < dx / 2) back.current();
    };
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end, { passive: false });
    element.addEventListener("touchcancel", cancel);
    return () => {
      cancel();
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", cancel);
    };
  }, [enabled, pageKey]);

  return surface;
}
