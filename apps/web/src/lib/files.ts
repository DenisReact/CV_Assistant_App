/**
 * Client-side pre-flight for uploads. The API enforces the same rules (multer
 * size cap, MIME whitelist in TextExtractionService) — this exists so a wrong
 * file fails before a 10 MB round trip, not after. Numbers mirror the backend
 * and must change together with it.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];

export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.join(',');

/** Returns a user-facing problem description, or null when the file is fine. */
export function validateUpload(file: File): string | null {
  const name = file.name.toLowerCase();

  if (!ALLOWED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return `"${file.name}" is not a supported format. Use PDF, DOCX, TXT or Markdown.`;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    const size = (file.size / 1024 / 1024).toFixed(1);

    return `"${file.name}" is ${size} MB — the limit is 10 MB.`;
  }

  if (file.size === 0) {
    return `"${file.name}" is empty.`;
  }

  return null;
}
