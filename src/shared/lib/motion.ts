/** Read CSS timing, including an explicit zero for reduced motion. */
export function motionDuration(token: string, fallback: number) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const milliseconds = parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : fallback;
}

/** Read the shared CSS tokens so pointer gestures and CSS use the same timing. */
export function reorderMotion() {
  const style = window.getComputedStyle(document.documentElement);
  return {
    duration: motionDuration("--motion-reorder-duration", 0),
    easing: style.getPropertyValue("--motion-ease-out").trim() || "linear",
  };
}

export function tabCloseDuration() {
  return motionDuration("--motion-tab-close-duration", 200);
}
