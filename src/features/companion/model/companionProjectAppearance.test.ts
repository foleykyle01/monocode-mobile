// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../projects/model/projectLogos", () => ({
  projectLogoSrc: (path: string | null) =>
    path ? `asset://${path}?v=${logoRevision}` : null,
}));

let logoRevision = 1;
import { companionProjectAppearance } from "./companionProjectAppearance";

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

function stubImage(width = 32, height = 16): void {
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

function stubCanvas(dataUrl = "data:image/png;base64,thumb"): void {
  vi.spyOn(document, "createElement").mockImplementation((tagName) => {
    if (tagName !== "canvas") {
      return document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
    }
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      }),
      toDataURL: () => dataUrl,
    } as unknown as HTMLCanvasElement;
  });
}

beforeEach(() => {
  localStorage.clear();
  images.length = 0;
  logoRevision = 1;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("companionProjectAppearance", () => {
  it("matches the rail's configured and default mascot/color", () => {
    localStorage.setItem(
      "monocode:tab-group:mascots",
      JSON.stringify({ "/work/app": "cat" }),
    );
    localStorage.setItem(
      "monocode:tab-group:custom-colors",
      JSON.stringify({ "/work/app": "#ff00aa" }),
    );

    expect(companionProjectAppearance("/work/app")).toMatchObject({
      mascot: "cat",
      color: "#ff00aa",
    });
    expect(companionProjectAppearance("/work/other").mascot).toBe(
      companionProjectAppearance("/work/other").mascot,
    );
  });

  it("loads a logo lazily and returns only the inline thumbnail", () => {
    stubImage();
    stubCanvas();
    localStorage.setItem(
      "monocode:tab-group:logos",
      JSON.stringify({ "/work/app": "/private/logo.png" }),
    );

    expect(companionProjectAppearance("/work/app").logo).toBeUndefined();
    expect(images).toHaveLength(1);
    expect(images[0]?.src).toContain("asset:///private/logo.png?v=1");
    images[0]?.onload?.();

    expect(companionProjectAppearance("/work/app").logo).toBe(
      "data:image/png;base64,thumb",
    );
    expect(companionProjectAppearance("/work/app").logo).not.toContain(
      "/private/logo.png",
    );
    expect(images).toHaveLength(1);
  });

  it("caches failed images and invalidates them when the logo revision changes", () => {
    stubImage();
    stubCanvas();
    localStorage.setItem(
      "monocode:tab-group:logos",
      JSON.stringify({ "/work/failure": "/private/logo.png" }),
    );

    companionProjectAppearance("/work/failure");
    images[0]?.onerror?.();
    expect(companionProjectAppearance("/work/failure").logo).toBeUndefined();
    expect(images).toHaveLength(1);

    logoRevision = 2;
    companionProjectAppearance("/work/failure");
    expect(images).toHaveLength(2);
  });

  it("rejects oversized thumbnails and keeps the cache bounded", () => {
    stubImage();
    stubCanvas("data:image/png;base64," + "x".repeat(16 * 1024));
    const logos = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [
        `/work/${index}`,
        `/private/${index}.png`,
      ]),
    );
    localStorage.setItem("monocode:tab-group:logos", JSON.stringify(logos));

    for (let index = 0; index < 201; index += 1) {
      companionProjectAppearance(`/work/${index}`);
      images[index]?.onload?.();
    }

    expect(companionProjectAppearance("/work/0").logo).toBeUndefined();
    expect(images).toHaveLength(202);
  });
});
