import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { homeDir as tauriHome } from "@tauri-apps/api/path";
import type { FsLike } from "@skill-sync/adapters";

// Tauri plugin-fs implementation of the adapters' FsLike contract.
// readTextFile returns null for missing files (matching nodeFs()).
export const tauriFs: FsLike = {
  readTextFile: async (path) => {
    try {
      return await readTextFile(path);
    } catch {
      return null;
    }
  },
  writeTextFile,
  mkdir: (path, opts) => mkdir(path, { recursive: opts?.recursive ?? true }).then(() => undefined),
  exists,
};

let cachedHome: string | null = null;

/** The user's home directory, without a trailing slash. */
export async function home(): Promise<string> {
  if (cachedHome) return cachedHome;
  const dir = (await tauriHome()).replace(/\/+$/, "");
  cachedHome = dir;
  return dir;
}
