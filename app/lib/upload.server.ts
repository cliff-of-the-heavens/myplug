import { randomUUID } from "node:crypto";
import { optimizeImage } from "./image-optimize.server";
import { StorageError, storeFile, storePrivateFile } from "./storage.server";

// Vercel functions reject request bodies over 4.5 MB, so keep uploads below that.
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
/** Proof of payment may also be a PDF (bank statements, mobile money receipts). */
const PROOF_TYPES: Record<string, string> = { ...IMAGE_TYPES, "application/pdf": "pdf" };

export class UploadError extends Error {}

/**
 * Validates and stores an uploaded image, returning its public URL.
 * Returns null when no file was chosen.
 */
export function uploadImage(file: FormDataEntryValue | null, folder: string) {
  return uploadFile(file, folder, IMAGE_TYPES, "Images must be JPG, PNG, WebP or GIF.", { optimize: true });
}

/** Like uploadImage, but also accepts PDFs. */
export function uploadProof(file: FormDataEntryValue | null, folder: string) {
  return uploadFile(file, folder, PROOF_TYPES, "Proof of payment must be a PDF or an image (JPG, PNG, WebP or GIF).");
}

async function uploadFile(
  file: FormDataEntryValue | null,
  folder: string,
  allowed: Record<string, string>,
  typeError: string,
  { optimize = false } = {},
): Promise<string | null> {
  if (!file || typeof file === "string" || file.size === 0) return null;

  const type = allowed[file.type];
  if (!type) throw new UploadError(typeError);
  if (file.size > MAX_IMAGE_BYTES) throw new UploadError("Files must be 4 MB or smaller.");
  // Public photos are resized and converted to WebP when the admin has switched it on.
  const { file: toStore, ext } = optimize ? await optimizeImage(file, type) : { file, ext: type };

  try {
    return await storeFile(`${folder}/${randomUUID()}.${ext}`, toStore);
  } catch (e) {
    if (e instanceof StorageError) throw new UploadError(e.message);
    throw e;
  }
}

/**
 * Stores a sensitive image or document (ID photo, licence) privately and returns its storage key.
 * Returns null when no file was chosen.
 */
export async function uploadPrivate(file: FormDataEntryValue | null, folder: string, { documents = false } = {}) {
  if (!file || typeof file === "string" || file.size === 0) return null;
  const allowed = documents ? PROOF_TYPES : IMAGE_TYPES;
  const ext = allowed[file.type];
  if (!ext) throw new UploadError(documents ? "Upload a PDF or a photo (JPG, PNG, WebP)." : "Upload a photo (JPG, PNG or WebP).");
  if (file.size > MAX_IMAGE_BYTES) throw new UploadError("Files must be 4 MB or smaller.");
  try {
    return await storePrivateFile(`${folder}/${randomUUID()}.${ext}`, file);
  } catch (e) {
    if (e instanceof StorageError) throw new UploadError(e.message);
    throw e;
  }
}
