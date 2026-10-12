import type { CSSProperties } from "react";
import { GradientBlurBackground } from "../../src/features/settings/ui/GradientBlurBackground";
import type { CompanionChatBackground } from "./types";
import "../../src/styles/gradientBackground.css";

export function ChatBackground({ background, empty }: { background?: CompanionChatBackground | null; empty: boolean }) {
  const image = background?.image;
  // Backgrounds are host-rendered image bytes, never Mac paths or remote URLs.
  if (!image || image.length > 128 * 1024 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return null;
  const opacity = !empty && background.scope === "empty" ? 0 : empty ? background.emptyOpacity : background.sessionOpacity;
  const style = {
    "--chat-background-image": `url("${image}")`,
    "--color-background-base": "var(--companion-bg)",
    opacity: Number.isFinite(opacity) ? Math.min(.65, Math.max(0, opacity)) : .24,
  } as CSSProperties;
  return background.effect === "gradient-blur"
    ? <GradientBlurBackground className="companion-chat-background" style={style} />
    : <div aria-hidden className="companion-chat-background" style={style} />;
}
