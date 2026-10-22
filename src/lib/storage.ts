import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./db/client";
import { newId } from "./plan";

/** File storage seam: local disk now, an object store (e.g. Supabase Storage) later. */
export interface FileStore {
  save(folder: string, data: Buffer, ext: string): Promise<string>;
  read(urlPath: string): Promise<{ data: Buffer; contentType: string } | null>;
}

const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

export function extFor(contentType: string, fallbackName = ""): string {
  const fromType = Object.entries(TYPES).find(([, t]) => t === contentType)?.[0];
  const fromName = fallbackName.split(".").pop()?.toLowerCase();
  return fromType ?? (fromName && TYPES[fromName] ? fromName : "png");
}

export function contentTypeFor(file: string): string {
  return TYPES[file.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

class LocalFileStore implements FileStore {
  private root = () => path.join(/*turbopackIgnore: true*/ dataDir(), "uploads");

  async save(folder: string, data: Buffer, ext: string) {
    const safeFolder = folder.replace(/[^a-z0-9_-]/gi, "");
    const name = `${newId()}.${ext.replace(/[^a-z0-9]/gi, "")}`;
    const dir = path.join(/*turbopackIgnore: true*/ this.root(), safeFolder);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, name), data);
    return `/api/files/${safeFolder}/${name}`;
  }

  async read(urlPath: string) {
    const rel = urlPath.replace(/^\/api\/files\//, "");
    const full = path.resolve(/*turbopackIgnore: true*/ this.root(), rel);
    // Refuse anything that escapes the uploads folder.
    if (!full.startsWith(path.resolve(this.root()) + path.sep)) return null;
    try {
      return { data: await fs.readFile(full), contentType: contentTypeFor(full) };
    } catch {
      return null;
    }
  }
}

export const fileStore: FileStore = new LocalFileStore();
