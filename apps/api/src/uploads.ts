// Field check photos live in one folder, served at /uploads/. The server writes them; the demo reset deletes those of the
// demo accounts.
import { unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** The photo folder: UPLOAD_DIR, else storage/uploads under the working directory. */
export const uploadsDirectory = (value = process.env.UPLOAD_DIR) => resolve(value ?? 'storage/uploads');

/**
 * Deletes the files behind photo URLs (/uploads/<name>) inside `directory`. A URL that would lead outside the folder is
 * skipped, and a file that is already gone or cannot be deleted is passed over. Returns how many files were deleted.
 */
export async function deleteUploads(directory: string, urls: (string | null | undefined)[]) {
  const root = resolve(directory);
  let deleted = 0;
  for (const url of urls) {
    if (!url?.startsWith('/uploads/')) continue;
    const file = resolve(root, url.slice('/uploads/'.length));
    const path = relative(root, file);
    if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) continue;
    try { await unlink(file); deleted++; } catch { /* gone already, or not ours to delete */ }
  }
  return deleted;
}
