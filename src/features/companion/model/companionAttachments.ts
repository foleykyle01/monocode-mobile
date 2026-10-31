/** Bounded image-only transport for the authenticated phone companion. */
export const COMPANION_IMAGE_COUNT_LIMIT = 4;
export const COMPANION_IMAGE_BYTES_LIMIT = 8 * 1024 * 1024;
export const COMPANION_IMAGE_TOTAL_BYTES_LIMIT = 12 * 1024 * 1024;
export const COMPANION_IMAGE_PIXELS_LIMIT = 64 * 1024 * 1024;
export const COMPANION_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export type CompanionImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
};

export function validCompanionImageAttachment(value: unknown): value is CompanionImageAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const image = value as Record<string, unknown>;
  const size = image.size;
  const width = image.width;
  const height = image.height;
  return typeof image.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(image.id)
    && typeof image.name === "string" && image.name.length > 0 && image.name.length <= 255
    && typeof image.mimeType === "string" && COMPANION_IMAGE_MIME_TYPES.has(image.mimeType)
    && typeof size === "number" && Number.isSafeInteger(size) && size > 0 && size <= COMPANION_IMAGE_BYTES_LIMIT
    && typeof width === "number" && Number.isSafeInteger(width) && width > 0
    && typeof height === "number" && Number.isSafeInteger(height) && height > 0
    && width * height <= COMPANION_IMAGE_PIXELS_LIMIT;
}

export function validateCompanionImages(value: unknown): CompanionImageAttachment[] {
  if (!Array.isArray(value) || value.length > COMPANION_IMAGE_COUNT_LIMIT)
    throw new Error("Too many images");
  const images = value.filter(validCompanionImageAttachment);
  if (images.length !== value.length || new Set(images.map(image => image.id)).size !== images.length)
    throw new Error("Invalid image attachment");
  if (images.reduce((total, image) => total + image.size, 0) > COMPANION_IMAGE_TOTAL_BYTES_LIMIT)
    throw new Error("Images are too large");
  return images;
}
