/**
 * Where a new upload goes inside its storage area, e.g. products/2026/11/3f/<uuid>.webp.
 * Splitting by month and by the first two characters of the id keeps any one folder small,
 * which matters most on FTP servers, where listing a huge folder is slow.
 */
export function storagePath(folder: string, ext: string, id: string = crypto.randomUUID(), now = new Date()) {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${folder}/${now.getUTCFullYear()}/${month}/${id.slice(0, 2)}/${id}.${ext}`;
}
