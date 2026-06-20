import { fetch } from "@tauri-apps/plugin-http";
import { parseLrc, type LyricLine } from "./parseLrc";
import { normalizeName } from "./normalize";

export type LyricsResult =
  | { status: "synced"; lines: LyricLine[] }
  | { status: "instrumental" }
  | { status: "none" }
  | { status: "failed" };

interface LrclibEntry {
  trackName?: string;
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
  const start = Date.now();
  const durationSecs = Math.round(durationMs / 1000);

  try {
    const exactParams = new URLSearchParams({
      track_name: track,
      artist_name: artist,
      duration: String(durationSecs),
    });
    if (album) exactParams.set("album_name", album);
    const exactUrl = `${BASE}/api/get?${exactParams}`;

    const exactRes = await fetch(exactUrl, { headers: HEADERS });
    console.log(`[lyrics] GET ${exactUrl} → ${exactRes.status} (${Date.now() - start}ms)`);

    if (exactRes.ok) {
      const result = evaluate((await exactRes.json()) as LrclibEntry);
      console.log(`[lyrics] exact match: status=${result.status} (${Date.now() - start}ms total)`);
      return result;
    }

    // 404 = normal no-exact-match signal; anything else is a server error.
    if (exactRes.status !== 404) {
      console.log(`[lyrics] non-404 from /api/get; failing (${Date.now() - start}ms total)`);
      return { status: "failed" };
    }

    const searchParams = new URLSearchParams({ track_name: track, artist_name: artist });
    const searchUrl = `${BASE}/api/search?${searchParams}`;
    const searchRes = await fetch(searchUrl, { headers: HEADERS });

    if (!searchRes.ok) {
      console.log(`[lyrics] search → ${searchRes.status}; failing (${Date.now() - start}ms total)`);
      return { status: "failed" };
    }

    const results = (await searchRes.json()) as LrclibEntry[];
    const normalizedTrack = normalizeName(track);

    const candidates = results.filter((r) => {
      if (!r.trackName) return false; // missing trackName is not a match, not a throw
      if (!r.syncedLyrics) return false;
      if (Math.abs((r.duration ?? 0) - durationSecs) > 2) return false;
      return normalizeName(r.trackName) === normalizedTrack;
    });

    console.log(
      `[lyrics] search → ${results.length} results, ${candidates.length} qualified` +
      ` (${Date.now() - start}ms)`,
    );

    if (!candidates.length) {
      console.log(`[lyrics] no qualifying match (${Date.now() - start}ms total)`);
      return { status: "none" };
    }

    const best = candidates.reduce((a, b) =>
      Math.abs((a.duration ?? 0) - durationSecs) <= Math.abs((b.duration ?? 0) - durationSecs)
        ? a
        : b,
    );
    console.log(
      `[lyrics] matched "${best.trackName}" dur=${best.duration}s (${Date.now() - start}ms total)`,
    );

    return evaluate(best);
  } catch (err) {
    console.log(`[lyrics] fetch threw: ${err} (${Date.now() - start}ms elapsed)`);
    return { status: "failed" };
  }
}
