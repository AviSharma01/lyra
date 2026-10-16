import Database from "@tauri-apps/plugin-sql";
import { type LyricLine } from "./parseLrc";
import { buildCacheKey } from "./normalize";

export { buildCacheKey };

export interface CachedEntry {
  lines: LyricLine[];
  perLine: (string | null)[];
}

interface CacheRow {
  data: string;
}

let db: Awaited<ReturnType<typeof Database.load>> | null = null;

export async function getDb() {
  if (!db) db = await Database.load("sqlite:lyrics.db");
  return db;
}

export async function cacheGet(key: string): Promise<CachedEntry | null> {
  try {
    const conn = await getDb();
    const rows = await conn.select<CacheRow[]>(
      "SELECT data FROM cached_lyrics WHERE key = ?",
      [key],
    );
    if (rows.length === 0) return null;
    const raw = JSON.parse(rows[0].data) as Record<string, unknown>;
    // Old entries stored `translations: string[]`; new shape uses `perLine: (string|null)[]`.
    // Treat old-shaped entries as a miss so they re-translate with the new numbering scheme.
    if (!Array.isArray(raw.perLine)) return null;
    return { lines: raw.lines as LyricLine[], perLine: raw.perLine as (string | null)[] };
  } catch (err) {
    if (import.meta.env.DEV) console.log("[cache] get error:", err);
    return null;
  }
}

export async function cacheSet(key: string, entry: CachedEntry): Promise<void> {
  try {
    const conn = await getDb();
    await conn.execute(
      "INSERT OR REPLACE INTO cached_lyrics (key, data, created_at) VALUES (?, ?, ?)",
      [key, JSON.stringify(entry), Date.now()],
    );
  } catch (err) {
    if (import.meta.env.DEV) console.log("[cache] set error:", err);
  }
}
