import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motionDuration } from "../../../shared/lib/motion";

const TRANSITION = "transform var(--motion-navigation-duration, 220ms) var(--motion-ease-out, ease-out), opacity var(--motion-navigation-duration, 220ms) var(--motion-ease-out, ease-out)";

export type StackPage = { key: string; node: ReactNode };

type Layer = StackPage & { leaving: boolean };

/**
 * A side panel that drills in: each page slides in from the right over the
 * one beneath, which eases a little to the left and fades away (pages are
 * see-through, so the panel's glass shows behind them), and slides back out
 * on the way back. Pages nest (settings, then one of its pages), and a page
 * stays mounted until it has finished sliding away. A page whose key stays
 * the same just updates in place.
 */
export function PanelStack({
  pages,
  children,
}: {
  /** Open pages, bottom first; empty for the panel itself. */
  pages: StackPage[];
  children: ReactNode;
}) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const timers = useRef(new Map<string, number>());
  const focusTargets = useRef(new Map<string, HTMLElement>());
  const previousKeys = useRef<string[]>([]);

  // Keep the layers in step with the pages, letting removed ones slide out.
  const keys = pages.map((page) => page.key).join("\u0000");
  useLayoutEffect(() => {
    const wantedKeys = pages.map(page => page.key);
    const active = document.activeElement;
    for (const key of wantedKeys) {
      if (!previousKeys.current.includes(key) && active instanceof HTMLElement)
        focusTargets.current.set(key, active);
    }
    const removed = previousKeys.current.filter(key => !wantedKeys.includes(key));
    const target = removed.length ? focusTargets.current.get(removed[0]) : undefined;
    previousKeys.current = wantedKeys;
    for (const key of removed) focusTargets.current.delete(key);
    setLayers((current) => {
      const wanted = new Set(pages.map((page) => page.key));
      const next: Layer[] = pages.map((page) => ({ ...page, leaving: false }));
      // A page on its way out keeps its place above the pages still open.
      if (motionDuration("--motion-navigation-duration", 220) > 0)
        for (const layer of current)
          if (!wanted.has(layer.key)) next.push({ ...layer, leaving: true });
      return next;
    });
    // Wait for React to remove inert from the revealed page, without scrolling it.
    const frame = target ? requestAnimationFrame(() => {
      if (target.isConnected && !target.closest("[inert]")) target.focus({ preventScroll: true });
    }) : undefined;
    for (const [key, timer] of timers.current)
      if (pages.some((page) => page.key === key)) {
        window.clearTimeout(timer);
        timers.current.delete(key);
      }
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  useLayoutEffect(() => {
    for (const layer of layers) {
      if (!layer.leaving || timers.current.has(layer.key)) continue;
      timers.current.set(
        layer.key,
        window.setTimeout(() => {
          timers.current.delete(layer.key);
          setLayers((current) =>
            current.filter(
              (entry) => !(entry.key === layer.key && entry.leaving),
            ),
          );
        }, motionDuration("--motion-navigation-duration", 220)),
      );
    }
  }, [layers]);

  useLayoutEffect(() => {
    const pending = timers.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finish = () => {
      if (!preference.matches) return;
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
      setLayers(current => current.filter(layer => !layer.leaving));
    };
    preference.addEventListener("change", finish);
    return () => {
      preference.removeEventListener("change", finish);
      for (const timer of pending.values()) window.clearTimeout(timer);
    };
  }, []);

  // Open pages show their latest content; leaving ones keep their last.
  const content = new Map(pages.map((page) => [page.key, page.node]));
  const open = layers.filter((layer) => !layer.leaving);
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      // A page that focuses its composer while still offscreen would scroll
      // this clip box to reveal it, fighting the slide. It never scrolls.
      onScroll={(event) => {
        event.currentTarget.scrollLeft = 0;
        event.currentTarget.scrollTop = 0;
      }}
    >
      <Covered covered={open.length > 0}>{children}</Covered>
      {layers.map((layer) => {
        const index = open.findIndex((entry) => entry.key === layer.key);
        return (
          <PageLayer
            key={layer.key}
            leaving={layer.leaving}
            covered={index >= 0 && index < open.length - 1}
          >
            {content.get(layer.key) ?? layer.node}
          </PageLayer>
        );
      })}
    </div>
  );
}

/** What lies under the top page: nudged left, faded out and out of reach. */
function Covered({
  covered,
  children,
}: {
  covered: boolean;
  children: ReactNode;
}) {
  return (
    <div
      inert={covered || undefined}
      aria-hidden={covered || undefined}
      style={{
        transition: TRANSITION,
        transform: covered ? "translateX(-12px)" : "none",
        opacity: covered ? 0 : 1,
      }}
      className="flex min-h-0 flex-1 flex-col motion-reduce:!transition-none"
    >
      {children}
    </div>
  );
}

function PageLayer({
  leaving,
  covered,
  children,
}: {
  leaving: boolean;
  covered: boolean;
  children: ReactNode;
}) {
  // Mount offscreen first, so the slide has somewhere to come from.
  const [entered, setEntered] = useState(() => motionDuration("--motion-navigation-duration", 220) === 0);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const shown = entered && !leaving;
  return (
    <div
      inert={covered || leaving || undefined}
      aria-hidden={covered || leaving || undefined}
      style={{
        transition: TRANSITION,
        transform: !shown
          ? "translateX(24px)"
          : covered
            ? "translateX(-12px)"
            : "none",
        opacity: covered || !shown ? 0 : 1,
      }}
      className="absolute inset-0 flex min-h-0 flex-col motion-reduce:!transition-none"
    >
      {children}
    </div>
  );
}
