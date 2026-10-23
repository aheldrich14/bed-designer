import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./data-dir";
import { backendName } from "./db/repo";
import { newId } from "./plan";
import { getSupabase, STORAGE_BUCKET } from "./supabase";

/**
 * File storage seam: local disk with the SQLite backend, Supabase Storage with
 * the Supabase backend. Either way files are served through /api/files/..., so
 * stored URLs don't depend on the store.
 */
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

class SupabaseFileStore implements FileStore {
  private bucketReady: Promise<void> | null = null;

  /** Creates the private bucket on first use. */
  private bucket() {
    this.bucketReady ??= (async () => {
      const sb = getSupabase();
      const { error } = await sb.storage.getBucket(STORAGE_BUCKET);
      if (!error) return;
      const created = await sb.storage.createBucket(STORAGE_BUCKET, { public: false });
      if (created.error && !/already exists/i.test(created.error.message)) {
        this.bucketReady = null;
        throw new Error(`Supabase storage: ${created.error.message}`);
      }
    })();
    return this.bucketReady.then(() => getSupabase().storage.from(STORAGE_BUCKET));
  }

  async save(folder: string, data: Buffer, ext: string) {
    const safeFolder = folder.replace(/[^a-z0-9_-]/gi, "");
    const name = `${newId()}.${ext.replace(/[^a-z0-9]/gi, "")}`;
    const { error } = await (await this.bucket()).upload(`${safeFolder}/${name}`, data, { contentType: contentTypeFor(name) });
    if (error) throw new Error(`Supabase storage: ${error.message}`);
    return `/api/files/${safeFolder}/${name}`;
  }

  async read(urlPath: string) {
    const rel = urlPath.replace(/^\/api\/files\//, "");
    if (!/^[a-z0-9_-]+\/[a-z0-9_.-]+$/i.test(rel) || rel.includes("..")) return null;
    const { data, error } = await (await this.bucket()).download(rel);
    if (error || !data) return null;
    return { data: Buffer.from(await data.arrayBuffer()), contentType: contentTypeFor(rel) };
  }
}

export const fileStore: FileStore = backendName() === "supabase" ? new SupabaseFileStore() : new LocalFileStore();
