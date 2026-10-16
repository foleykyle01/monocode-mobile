import {
  COMPANION_IMAGE_BYTES_LIMIT,
  COMPANION_IMAGE_COUNT_LIMIT,
  COMPANION_IMAGE_MIME_TYPES,
  COMPANION_IMAGE_PIXELS_LIMIT,
  COMPANION_IMAGE_TOTAL_BYTES_LIMIT,
} from "../../src/features/companion/model/companionAttachments";
import type { CompanionImageDraft } from "./client";

export type PhoneImageDraft = CompanionImageDraft & { previewUrl: string };

export async function phoneImagesFromFiles(files: File[], existing: PhoneImageDraft[]): Promise<PhoneImageDraft[]> {
  const incoming = files.filter(file => file.size > 0);
  if (!incoming.length) return [];
  if (incoming.some(file => !COMPANION_IMAGE_MIME_TYPES.has(file.type.toLowerCase())))
    throw new Error("Use a PNG, JPEG, GIF, or WebP image.");
  if (existing.length + incoming.length > COMPANION_IMAGE_COUNT_LIMIT)
    throw new Error(`Attach up to ${COMPANION_IMAGE_COUNT_LIMIT} images at once.`);
  if (incoming.some(file => file.size > COMPANION_IMAGE_BYTES_LIMIT))
    throw new Error("Each image must be 8 MB or smaller.");
  if (existing.reduce((total, image) => total + image.size, 0) + incoming.reduce((total, file) => total + file.size, 0) > COMPANION_IMAGE_TOTAL_BYTES_LIMIT)
    throw new Error("Attached images must total 12 MB or smaller.");
  return Promise.all(incoming.map(async file => {
    const { width, height } = await imageDimensions(file);
    if (width * height > COMPANION_IMAGE_PIXELS_LIMIT)
      throw new Error("Each image must be 64 megapixels or smaller.");
    const previewUrl = URL.createObjectURL(file);
    try {
      return {
        id: crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80),
        name: file.name.trim() || "image",
        mimeType: file.type.toLowerCase() === "image/jpg" ? "image/jpeg" : file.type.toLowerCase(),
        size: file.size,
        width,
        height,
        data: await fileBase64(file),
        previewUrl,
      };
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      throw error;
    }
  }));
}

export function releasePhoneImage(image: PhoneImageDraft) {
  URL.revokeObjectURL(image.previewUrl);
}

function imageDimensions(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
    image.src = url;
  });
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string") { reject(new Error("Could not read that image.")); return; }
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}
