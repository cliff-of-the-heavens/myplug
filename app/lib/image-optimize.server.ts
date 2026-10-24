import { getSettings, intSetting, setSettings } from "./settings.server";

export type ImageSettings = { enabled: boolean; maxWidth: number; quality: number };

export async function getImageSettings(): Promise<ImageSettings> {
  const s = await getSettings();
  return {
    enabled: s.image_optimize === "true",
    maxWidth: Math.min(4000, intSetting(s, "image_max_width", 1600, 320)),
    quality: Math.min(95, intSetting(s, "image_quality", 80, 40)),
  };
}

export async function saveImageSettings(v: ImageSettings) {
  await setSettings({
    image_optimize: String(v.enabled),
    image_max_width: String(Math.min(4000, Math.max(320, Math.round(v.maxWidth)))),
    image_quality: String(Math.min(95, Math.max(40, Math.round(v.quality)))),
  });
}

/**
 * When the admin has switched optimisation on: turns photos the right way up (phone EXIF),
 * shrinks them to the maximum width and converts them to WebP, which is typically a fraction of
 * the size of a phone JPEG. GIFs (possibly animated) and files that wouldn't get smaller are left
 * as they are. Returns the file to store and its extension.
 */
export async function optimizeImage(file: File, ext: string): Promise<{ file: File; ext: string }> {
  if (ext === "gif") return { file, ext };
  const cfg = await getImageSettings();
  if (!cfg.enabled) return { file, ext };
  try {
    // Loaded only when needed, so it adds nothing to requests that don't upload images.
    const sharp = (await import("sharp")).default;
    const input = Buffer.from(await file.arrayBuffer());
    const out = await sharp(input, { failOn: "error" })
      .rotate()
      .resize({ width: cfg.maxWidth, withoutEnlargement: true })
      .webp({ quality: cfg.quality })
      .toBuffer();
    if (out.length >= input.length) return { file, ext };
    return { file: new File([new Uint8Array(out)], file.name.replace(/\.\w+$/, "") + ".webp", { type: "image/webp" }), ext: "webp" };
  } catch (e) {
    // Never lose an upload because optimisation failed; store the original instead.
    console.error("Image optimisation failed; storing the original", e);
    return { file, ext };
  }
}
