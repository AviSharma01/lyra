import { getDb } from "./cache";
import type { LookupReason, RejectedBy } from "./classify";

export interface CandidateSummary {
  trackName?: string;
  artistName?: string;
  duration?: number;
  hasSynced: boolean;
  hasPlain: boolean;
  rejectedBy: RejectedBy;
}

export interface LookupDetail {
  exactStatus?: number;
  exactBody?: unknown;
  searchStatus?: number;
  resultCount?: number;
  candidates?: CandidateSummary[];
  searchBody?: unknown;
  error?: string;
}

export interface LookupTrace {
  reason: LookupReason;
  detail: LookupDetail;
}

export interface LookupLogRow {
  track: string;
  artist: string;
  album: string;
  durationMs: number;
  outcome: string;
  trace: LookupTrace;
}

// Diagnostics only: never throws, so a logging failure can't reach the lyric lookup.
export async function writeLookupLog(row: LookupLogRow): Promise<void> {
  try {
    const conn = await getDb();
    await conn.execute(
      "INSERT INTO lookup_log (ts, track, artist, album, duration_ms, outcome, reason, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        Date.now(),
        row.track,
        row.artist,
        row.album,
        row.durationMs,
        row.outcome,
        row.trace.reason,
        JSON.stringify(row.trace.detail),
      ],
    );
  } catch (err) {
    if (import.meta.env.DEV) console.log("[lookup-log] write error:", err);
  }
}
