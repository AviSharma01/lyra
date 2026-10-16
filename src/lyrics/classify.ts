import { normalizeName } from "./normalize";

export interface LrclibEntry {
  trackName?: string;
  artistName?: string;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
  duration?: number;
}

export type RejectedBy = "no_synced" | "duration" | "title" | null;

export type ExactReason =
  "exact_synced" | "exact_instrumental" | "exact_plain_only" | "exact_empty";

export type SearchReason = "search_matched" | "search_empty" | "gate_rejected";

export type LookupReason = ExactReason | SearchReason | "http_error" | "threw";

// This is the search gate itself: a candidate is accepted iff this returns null.
// A missing trackName counts as a title failure (not a match, not a throw).
export function rejectedBy(
  entry: LrclibEntry,
  normalizedTrack: string,
  durationSecs: number,
): RejectedBy {
  if (!entry.trackName) return "title";
  if (!entry.syncedLyrics) return "no_synced";
  if (Math.abs((entry.duration ?? 0) - durationSecs) > 2) return "duration";
  if (normalizeName(entry.trackName) !== normalizedTrack) return "title";
  return null;
}

// Same precedence as evaluate(): instrumental wins over synced.
export function exactReason(entry: LrclibEntry): ExactReason {
  if (entry.instrumental) return "exact_instrumental";
  if (entry.syncedLyrics) return "exact_synced";
  if (entry.plainLyrics) return "exact_plain_only";
  return "exact_empty";
}

export function searchReason(rejections: RejectedBy[]): SearchReason {
  if (!rejections.length) return "search_empty";
  return rejections.includes(null) ? "search_matched" : "gate_rejected";
}
