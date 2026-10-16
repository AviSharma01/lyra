import { fetch } from "@tauri-apps/plugin-http";
import { parseLrc, type LyricLine } from "./parseLrc";
import { normalizeName } from "./normalize";
import {
  exactReason,
  rejectedBy,
  searchReason,
  type LrclibEntry,
  type RejectedBy,
} from "./classify";
import { writeLookupLog, type LookupDetail, type LookupTrace } from "./lookupLog";

export type LyricsResult =
  | { status: "synced"; lines: LyricLine[] }
  | { status: "instrumental" }
  | { status: "none" }
  | { status: "failed" };

const BASE = "https://lrclib.net";
// User-Agent is set explicitly so it lands on the native reqwest request,
// not the webview — plugin-http passes headers to Rust before the OS call.
const HEADERS = { "User-Agent": "Lyra/0.1 (github.com/avisharma/lyra)" };


function evaluate(entry: LrclibEntry): LyricsResult {
  if (entry.instrumental) return { status: "instrumental" };
  if (entry.syncedLyrics) return { status: "synced", lines: parseLrc(entry.syncedLyrics) };
  return { status: "none" };
}

// Shared by the real search and the shadow search so the two queries can't drift.
function searchUrl(track: string, artist: string): string {
  const searchParams = new URLSearchParams({ track_name: track, artist_name: artist });
  return `${BASE}/api/search?${searchParams}`;
}

function traceCandidates(
  results: LrclibEntry[],
  normalizedTrack: string,
  durationSecs: number,
  detail: LookupDetail,
): RejectedBy[] {
  const rejections = results.map((r) => rejectedBy(r, normalizedTrack, durationSecs));
  detail.resultCount = results.length;
  detail.searchBody = results;
  detail.candidates = results.map((r, i) => ({
    trackName: r.trackName,
    artistName: r.artistName,
    duration: r.duration,
    hasSynced: !!r.syncedLyrics,
    hasPlain: !!r.plainLyrics,
    rejectedBy: rejections[i],
  }));
  return rejections;
}

export async function fetchLyrics(
  track: string,
  artist: string,
  album: string,
  durationMs: number,
): Promise<LyricsResult> {
  const trace: LookupTrace = { reason: "threw", detail: {} };
  const result = await lookup(track, artist, album, durationMs, trace);
  void logLookup(track, artist, album, durationMs, result.status, trace);
  return result;
}

// Runs after fetchLyrics has returned, so the shadow search can't delay or change the result.
async function logLookup(
  track: string,
  artist: string,
  album: string,
  durationMs: number,
  outcome: LyricsResult["status"],
  trace: LookupTrace,
): Promise<void> {
  // A plain-only exact hit returns "none" without searching; this shows whether a synced upload exists.
  if (trace.reason === "exact_plain_only") {
    try {
      await shadowSearch(track, artist, Math.round(durationMs / 1000), trace.detail);
    } catch {
      // The row is still written, just without search fields.
    }
  }
  await writeLookupLog({ track, artist, album, durationMs, outcome, trace });
}

async function shadowSearch(
  track: string,
  artist: string,
  durationSecs: number,
  detail: LookupDetail,
): Promise<void> {
  const res = await fetch(searchUrl(track, artist), { headers: HEADERS });
  detail.searchStatus = res.status;
  if (!res.ok) return;
  const results = (await res.json()) as LrclibEntry[];
  traceCandidates(results, normalizeName(track), durationSecs, detail);
}

async function lookup(
  track: string,
  artist: string,
  album: string,
  durationMs: number,
  trace: LookupTrace,
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
    trace.detail.exactStatus = exactRes.status;

    if (exactRes.ok) {
      const entry = (await exactRes.json()) as LrclibEntry;
      trace.detail.exactBody = entry;
      trace.reason = exactReason(entry);
      const result = evaluate(entry);
      return result;
    }

    // 404 = normal no-exact-match signal; anything else is a server error.
    if (exactRes.status !== 404) {
      trace.reason = "http_error";
      if (import.meta.env.DEV) console.log(`[lyrics] non-404 from /api/get; failing (${Date.now() - start}ms total)`);
      return { status: "failed" };
    }

    const searchRes = await fetch(searchUrl(track, artist), { headers: HEADERS });
    trace.detail.searchStatus = searchRes.status;

    if (!searchRes.ok) {
      trace.reason = "http_error";
      if (import.meta.env.DEV) console.log(`[lyrics] search → ${searchRes.status}; failing (${Date.now() - start}ms total)`);
      return { status: "failed" };
    }

    const results = (await searchRes.json()) as LrclibEntry[];
    const normalizedTrack = normalizeName(track);

    const rejections = traceCandidates(results, normalizedTrack, durationSecs, trace.detail);
    trace.reason = searchReason(rejections);
    const candidates = results.filter((_, i) => rejections[i] === null);

    if (!candidates.length) {
      return { status: "none" };
    }

    const best = candidates.reduce((a, b) =>
      Math.abs((a.duration ?? 0) - durationSecs) <= Math.abs((b.duration ?? 0) - durationSecs)
        ? a
        : b,
    );

    return evaluate(best);
  } catch (err) {
    trace.reason = "threw";
    trace.detail.error = String(err);
    if (import.meta.env.DEV) console.log(`[lyrics] fetch threw: ${err} (${Date.now() - start}ms elapsed)`);
    return { status: "failed" };
  }
}
