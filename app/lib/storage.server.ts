import { put } from "@vercel/blob";
import { Client as FtpClient } from "basic-ftp";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getSettings, setSettings } from "./settings.server";

/**
 * Where uploaded files (product photos, logos, proofs of payment) are stored.
 *
 * - "blob":  Vercel Blob (needs BLOB_READ_WRITE_TOKEN)
 * - "ftp":   any FTP/FTPS server; files must be reachable over HTTP at `publicBaseUrl`
 *            (e.g. the server's web root), because browsers can't load ftp:// links
 * - "local": public/uploads (development only; Vercel's disk is read-only)
 * - "auto":  Blob when a token is set, otherwise local in development
 */
export type StorageBackend = "auto" | "blob" | "ftp" | "local";

export type FtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string; // decrypted; stored encrypted in settings
  secure: "none" | "explicit" | "implicit"; // FTPS mode
  directory: string; // remote folder, e.g. /public_html/uploads
  publicBaseUrl: string; // where that folder is served over HTTP(S), e.g. https://cdn.example.com/uploads
};

export class StorageError extends Error {}

// ---------------------------------------------------------------- secrets at rest

/** AES-256-GCM with a key derived from SESSION_SECRET, so the FTP password isn't stored in plain text. */
function key() {
  return createHash("sha256").update(`storage:${process.env.SESSION_SECRET}`).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(stored: string) {
  try {
    const [iv, tag, data] = stored.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return ""; // SESSION_SECRET changed: the admin has to re-enter the password
  }
}

// ---------------------------------------------------------------- settings

export async function getStorageSettings() {
  const all = await getSettings();
  const backend = (["auto", "blob", "ftp", "local"].includes(all.storage_backend) ? all.storage_backend : "auto") as StorageBackend;
  const ftp: FtpConfig = {
    host: all.ftp_host ?? "",
    port: Number(all.ftp_port) || 21,
    user: all.ftp_user ?? "",
    password: all.ftp_password ? decryptSecret(all.ftp_password) : "",
    secure: (["none", "explicit", "implicit"].includes(all.ftp_secure) ? all.ftp_secure : "explicit") as FtpConfig["secure"],
    directory: all.ftp_directory || "/",
    publicBaseUrl: (all.ftp_public_base_url ?? "").replace(/\/$/, ""),
  };
  return { backend, ftp };
}

/** Saves storage settings. Without `ftp` the saved FTP details are kept; an empty password keeps the current one. */
export async function saveStorageSettings(backend: StorageBackend, ftp: (Omit<FtpConfig, "password"> & { password?: string }) | null) {
  if (!ftp) return setSettings({ storage_backend: backend });
  await setSettings({
    storage_backend: backend,
    ftp_host: ftp.host,
    ftp_port: String(ftp.port),
    ftp_user: ftp.user,
    ftp_secure: ftp.secure,
    ftp_directory: ftp.directory,
    ftp_public_base_url: ftp.publicBaseUrl,
    ...(ftp.password ? { ftp_password: encryptSecret(ftp.password) } : {}),
  });
}

/** Which backend uploads actually go to. */
export function resolveBackend(backend: StorageBackend): Exclude<StorageBackend, "auto"> {
  if (backend !== "auto") return backend;
  return process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "local";
}

// ---------------------------------------------------------------- FTP

async function withFtp<T>(cfg: FtpConfig, fn: (client: FtpClient) => Promise<T>) {
  if (!cfg.host || !cfg.user) throw new StorageError("FTP host and username are required.");
  const client = new FtpClient(20_000);
  try {
    await client.access({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      secure: cfg.secure === "none" ? false : cfg.secure === "implicit" ? "implicit" : true,
    });
    return await fn(client);
  } catch (e) {
    if (e instanceof StorageError) throw e;
    throw new StorageError(`FTP: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    client.close();
  }
}

/** Connects, uploads a tiny file and checks it's reachable at the public URL. Used by the admin "Test" button. */
export async function testFtp(cfg: FtpConfig) {
  if (!/^https?:\/\//.test(cfg.publicBaseUrl)) throw new StorageError("Public base URL must start with http:// or https://");
  const name = `myplug-test-${Date.now()}.txt`;
  await withFtp(cfg, async (client) => {
    await client.ensureDir(cfg.directory);
    await client.uploadFrom(Readable.from(["MyPlug storage test"]), name);
  });
  const res = await fetch(`${cfg.publicBaseUrl}/${name}`).catch(() => null);
  await withFtp(cfg, async (client) => {
    await client.cd(cfg.directory);
    await client.remove(name).catch(() => {});
  });
  if (!res?.ok) {
    throw new StorageError(
      `Uploaded to FTP, but ${cfg.publicBaseUrl}/${name} wasn't reachable (${res ? res.status : "no response"}). Check the public base URL.`,
    );
  }
}

// ---------------------------------------------------------------- upload

/** Stores a file under `name` (e.g. "products/uuid.jpg") and returns its public URL. */
export async function storeFile(name: string, file: File) {
  const { backend, ftp } = await getStorageSettings();
  const target = resolveBackend(backend);

  if (target === "blob") {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new StorageError("Vercel Blob is selected but BLOB_READ_WRITE_TOKEN is missing.");
    const blob = await put(name, file, { access: "public", contentType: file.type });
    return blob.url;
  }

  if (target === "ftp") {
    const buffer = Buffer.from(await file.arrayBuffer());
    const folder = path.posix.dirname(name);
    await withFtp(ftp, async (client) => {
      await client.ensureDir(path.posix.join(ftp.directory, folder)); // also changes into it
      await client.uploadFrom(Readable.from(buffer), path.posix.basename(name));
    });
    return `${ftp.publicBaseUrl}/${name}`;
  }

  if (process.env.VERCEL) {
    throw new StorageError("File storage is not configured. Choose Vercel Blob or FTP in Admin → System settings.");
  }
  // Local development fallback
  const file_ = path.join(process.cwd(), "public", "uploads", name);
  await mkdir(path.dirname(file_), { recursive: true });
  await writeFile(file_, Buffer.from(await file.arrayBuffer()));
  return `/uploads/${name}`;
}

/** Whether a URL a form sends back (e.g. a gallery image) points at a file we stored. */
export async function isOwnUpload(url: string) {
  if (/^\/uploads\/[\w/.-]+$/.test(url) && !url.includes("..")) return true; // local development
  const { ftp } = await getStorageSettings();
  if (ftp.publicBaseUrl && url.startsWith(`${ftp.publicBaseUrl}/`)) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- private files

/**
 * Sensitive or paid files (ID photos, licences, purchased media) are never given a public
 * address. They're stored privately and served only through routes that check permission.
 * The returned key says where the file lives: "blob:…", "ftp:…" or "local:…".
 */
export async function storePrivateFile(name: string, file: File | Blob) {
  const { backend, ftp } = await getStorageSettings();
  const target = resolveBackend(backend);

  if (target === "blob") {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new StorageError("Vercel Blob is selected but BLOB_READ_WRITE_TOKEN is missing.");
    const blob = await put(`private/${name}`, file, { access: "private", contentType: file.type });
    return `blob:${blob.pathname}`;
  }

  if (target === "ftp") {
    // Kept outside the public uploads folder, with a deny-all rule for Apache-style hosts.
    const dir = path.posix.join(privateFtpRoot(ftp), path.posix.dirname(name));
    const buffer = Buffer.from(await file.arrayBuffer());
    await withFtp(ftp, async (client) => {
      await client.ensureDir(privateFtpRoot(ftp));
      await client.uploadFrom(Readable.from(["Require all denied\nDeny from all\n"]), ".htaccess");
      await client.ensureDir(dir);
      await client.uploadFrom(Readable.from(buffer), path.posix.basename(name));
    });
    return `ftp:${name}`;
  }

  if (process.env.VERCEL) throw new StorageError("File storage is not configured. Choose Vercel Blob or FTP in Admin → System settings.");
  const file_ = path.join(PRIVATE_DIR, name);
  await mkdir(path.dirname(file_), { recursive: true });
  await writeFile(file_, Buffer.from(await file.arrayBuffer()));
  return `local:${name}`;
}

/** Local private files live outside public/, so the web server never serves them directly. */
const PRIVATE_DIR = path.join(process.cwd(), ".private-uploads");

function privateFtpRoot(ftp: FtpConfig) {
  return path.posix.join(path.posix.dirname(ftp.directory.replace(/\/$/, "") || "/"), "myplug-private");
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg",
  wav: "audio/wav", epub: "application/epub+zip",
};

export function mimeFor(name: string) {
  return MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/**
 * Streams a private file as an HTTP response, honouring a Range header (so video and audio
 * can seek). Callers must check permission first.
 */
export async function privateFileResponse(key: string, request: Request, extraHeaders: Record<string, string> = {}) {
  const [scheme, ...rest] = key.split(":");
  const name = rest.join(":");
  const type = mimeFor(name);
  const range = request.headers.get("Range");
  const base = { "Content-Type": type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders };

  if (scheme === "blob") {
    const { get } = await import("@vercel/blob");
    const result = await get(name, { access: "private", headers: range ? { Range: range } : undefined });
    if (!result || !result.stream) return new Response("Not found", { status: 404 });
    const contentRange = result.headers.get("content-range");
    return new Response(result.stream, {
      status: contentRange ? 206 : 200,
      headers: {
        ...base,
        "Accept-Ranges": "bytes",
        ...(contentRange ? { "Content-Range": contentRange } : {}),
        ...(result.headers.get("content-length") ? { "Content-Length": result.headers.get("content-length")! } : {}),
      },
    });
  }

  if (scheme === "local") {
    const { createReadStream } = await import("node:fs");
    const { stat } = await import("node:fs/promises");
    const file = path.join(PRIVATE_DIR, name);
    if (!file.startsWith(PRIVATE_DIR)) return new Response("Not found", { status: 404 });
    const info = await stat(file).catch(() => null);
    if (!info) return new Response("Not found", { status: 404 });
    const m = range?.match(/bytes=(\d*)-(\d*)/);
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, info.size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
      return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
        status: 206,
        headers: { ...base, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${info.size}`, "Content-Length": String(end - start + 1) },
      });
    }
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: { ...base, "Accept-Ranges": "bytes", "Content-Length": String(info.size) },
    });
  }

  if (scheme === "ftp") {
    // FTP has no byte ranges over this client; fine for photos and documents, slow for large media.
    const { ftp } = await getStorageSettings();
    const { PassThrough } = await import("node:stream");
    const chunks: Buffer[] = [];
    const sink = new PassThrough();
    sink.on("data", (c: Buffer) => chunks.push(c));
    await withFtp(ftp, (client) => client.downloadTo(sink, path.posix.join(privateFtpRoot(ftp), name)));
    return new Response(Buffer.concat(chunks), { headers: base });
  }

  return new Response("Not found", { status: 404 });
}
