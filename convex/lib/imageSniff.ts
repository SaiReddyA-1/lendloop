import type { PhotoContentType } from "./validation";

/**
 * Detects the real image format from the first bytes of a file (magic numbers). The stored Content-Type is
 * client-supplied, so it is only trusted when it agrees with the bytes (OWASP File Upload Cheat Sheet:
 * validate content, not just the declared type). Returns null for anything that is not JPEG, PNG or WebP.
 */
export function sniffImageType(head: Uint8Array): PhotoContentType | null {
  const startsWith = (offset: number, bytes: number[]) =>
    bytes.every((b, i) => head[offset + i] === b);
  if (startsWith(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // RIFF....WEBP
  if (startsWith(0, [0x52, 0x49, 0x46, 0x46]) && startsWith(8, [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp";
  }
  return null;
}
