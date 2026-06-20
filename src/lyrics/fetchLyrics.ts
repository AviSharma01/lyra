import { fetch } from "@tauri-apps/plugin-http";
import { parseLrc, type LyricLine } from "./parseLrc";

export type LyricsResult =
  | { status: "synced"; lines: LyricLine[] }
  | { status: "instrumental" }
  | { status: "none" };

interface LrclibEntry {
  syncedLyrics?: string | null;
  instrumental?: boolean;
  duration?: number;
}

const BASE = "https://lrclib.net";
// User-Agent is set explicitly so it lands on the native reqwest request,
// not the webview — plugin-http passes headers to Rust before the OS call.
const HEADERS = { "User-Agent": "Lyra/0.1 (github.com/avisharma/lyra)" };

function evaluate(entry: LrclibEntry): LyricsResult {
  if (entry.instrumental) return { status: "instrumental" };
  if (entry.syncedLyrics) return { status: "synced", lines: parseLrc(entry.syncedLyrics) };
  return { status: "none" };
}

export async function fetchLyrics(
  track: string,
  artist: string,
  album: string,
  durationMs: number,
): Promise<LyricsResult> {
  const durationSecs = Math.round(durationMs / 1000);

  // Exact match — include album_name when present; omit when empty.
  const exactParams = new URLSearchParams({
    track_name: track,
    artist_name: artist,
    duration: String(durationSecs),
  });
  if (album) exactParams.set("album_name", album);

  const exactRes = await fetch(`${BASE}/api/get?${exactParams}`, { headers: HEADERS });
  if (exactRes.ok) {
    return evaluate((await exactRes.json()) as LrclibEntry);
  }

  // Search fallback — pick the result closest in duration.
  const searchParams = new URLSearchParams({ track_name: track, artist_name: artist });
  const searchRes = await fetch(`${BASE}/api/search?${searchParams}`, { headers: HEADERS });
  if (!searchRes.ok) return { status: "none" };

  const results = (await searchRes.json()) as LrclibEntry[];
  if (!results.length) return { status: "none" };

  const best = results.reduce((a, b) => {
    const da = Math.abs((a.duration ?? 0) - durationSecs);
    const db = Math.abs((b.duration ?? 0) - durationSecs);
    return da <= db ? a : b;
  });

  return evaluate(best);
}
