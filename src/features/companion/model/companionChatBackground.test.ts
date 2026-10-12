// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
  invoke: vi.fn(),
}));

import { monoBackgroundKey } from "../../monos/model/monoBackground";
import {
  saveChatBackgroundPath,
  saveChatBackgroundScope,
} from "../../settings/model/appearance";
import { saveProjectChatBackgroundSettings } from "../../projects/model/projectChatBackground";
import { companionChatBackground } from "./companionChatBackground";

type FakeImage = {
  src: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
};

const images: FakeImage[] = [];

function stubImage(width = 2_400, height = 1_200) {
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      width = width;
      height = height;
      naturalWidth = width;
      naturalHeight = height;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {
        images.push(this);
      }
    },
  );
}

function stubCanvas(dataUrl = "data:image/jpeg;base64,phone-background") {
  vi.spyOn(document, "createElement").mockImplementation((tagName) => {
    if (tagName !== "canvas") {
      return document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
    }
    return {
      width: 0,
      height: 0,
      getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
      toDataURL: () => dataUrl,
    } as unknown as HTMLCanvasElement;
  });
}

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  images.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("companion chat backgrounds", () => {
  it("uses the project override and returns only a bounded rendered image", async () => {
    stubImage();
    stubCanvas();
    saveProjectChatBackgroundSettings("/work/app", {
      path: "/private/wallpaper.png",
      emptyOpacity: 0.45,
      sessionOpacity: 0.2,
      scope: "empty",
      effect: "gradient-blur",
    });

    expect(companionChatBackground({ cwd: "/work/app" } as never)).toEqual({
      emptyOpacity: 0.45,
      sessionOpacity: 0.2,
      scope: "empty",
      effect: "gradient-blur",
    });
    expect(images[0]?.src).toContain("/private/wallpaper.png");
    images[0]?.onload?.();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    expect(companionChatBackground({ cwd: "/work/app" } as never)).toEqual({
      image: "data:image/jpeg;base64,phone-background",
      emptyOpacity: 0.45,
      sessionOpacity: 0.2,
      scope: "empty",
      effect: "gradient-blur",
    });
  });

  it("keeps changing images separate while an older conversion is still pending", async () => {
    stubImage();
    stubCanvas();
    saveProjectChatBackgroundSettings("/work/app", {
      path: "/private/old.png",
      emptyOpacity: 0.24,
      sessionOpacity: 0.24,
      scope: "all",
      effect: "none",
    });
    const oldRead = companionChatBackground({ cwd: "/work/app" } as never);

    saveProjectChatBackgroundSettings("/work/app", {
      path: "/private/new.png",
      emptyOpacity: 0.5,
      sessionOpacity: 0.3,
      scope: "empty",
      effect: "none",
    });
    const newRead = companionChatBackground({ cwd: "/work/app" } as never);
    expect(images).toHaveLength(2);
    images[1]?.onload?.();
    images[0]?.onload?.();
    await Promise.resolve();

    expect(newRead).toMatchObject({
      scope: "empty",
      emptyOpacity: 0.5,
    });
    expect(oldRead).toMatchObject({
      scope: "all",
      emptyOpacity: 0.24,
    });
  });

  it("falls back to metadata when artwork is too large or cannot render", async () => {
    stubImage();
    stubCanvas("data:image/jpeg;base64," + "x".repeat(128 * 1024));
    saveProjectChatBackgroundSettings("/work/app", {
      path: "/private/large.png",
      emptyOpacity: 0.24,
      sessionOpacity: 0.24,
      scope: "all",
      effect: "none",
    });
    expect(companionChatBackground({ cwd: "/work/app" } as never)).toEqual({
      emptyOpacity: 0.24,
      sessionOpacity: 0.24,
      scope: "all",
      effect: "none",
    });
    images[0]?.onload?.();
    await Promise.resolve();

    expect(companionChatBackground({ cwd: "/work/app" } as never)).toEqual({
      emptyOpacity: 0.24,
      sessionOpacity: 0.24,
      scope: "all",
      effect: "none",
    });
  });

  it("uses a Mono's own artwork and never falls through to the global background", async () => {
    stubImage();
    stubCanvas();
    saveChatBackgroundPath("/private/global.png");
    saveChatBackgroundScope("all");
    saveProjectChatBackgroundSettings(monoBackgroundKey("reviewer"), {
      path: "/private/mono.png",
      emptyOpacity: 0.6,
      sessionOpacity: 0.5,
      scope: "empty",
      effect: "none",
    });

    const monoRead = companionChatBackground({ cwd: "/work/app" } as never, "reviewer");
    expect(images[0]?.src).toContain("/private/mono.png");
    images[0]?.onload?.();
    await Promise.resolve();
    expect(monoRead).toMatchObject({
      effect: "gradient-blur",
      scope: "all",
      emptyOpacity: 0.24,
    });

    expect(companionChatBackground({ cwd: "/work/app" } as never, "without-artwork")).toBeNull();
  });

  it("does not delay a transcript or retry a timed-out image on every poll", async () => {
    vi.useFakeTimers();
    stubImage();
    stubCanvas();
    saveProjectChatBackgroundSettings("/work/never-completes", {
      path: "/private/never.png",
      emptyOpacity: 0.24,
      sessionOpacity: 0.24,
      scope: "all",
      effect: "none",
    });

    expect(companionChatBackground({ cwd: "/work/never-completes" } as never)).toMatchObject({
      effect: "none",
    });
    expect(images).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(companionChatBackground({ cwd: "/work/never-completes" } as never)).toEqual({
      emptyOpacity: 0.24,
      sessionOpacity: 0.24,
      scope: "all",
      effect: "none",
    });
    expect(images).toHaveLength(1);
    vi.useRealTimers();
  });
});
