export type LyricLine = { timeMs: number; text: string };

// LRC offset convention: [offset:N] means lyrics are N ms early relative to the audio,
// so we subtract N from each timestamp to make them smaller (earlier). Positive N → lines
// appear sooner; negative N → lines appear later.

function parseTagMs(tag: string): number | null {
  const m = tag.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]$/);
  if (!m) return null;
  const fracMs = m[3].length === 2 ? parseInt(m[3], 10) * 10 : parseInt(m[3], 10);
  return parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + fracMs;
}

export function parseLrc(lrc: string): LyricLine[] {
  if (!lrc.trim()) return [];

  let offsetMs = 0;
  const lines: LyricLine[] = [];

  for (const raw of lrc.split("\n")) {
    let rest = raw.trim();
    if (!rest) continue;

    const tags: string[] = [];
    while (rest.startsWith("[")) {
      const end = rest.indexOf("]");
      if (end === -1) break;
      tags.push(rest.slice(0, end + 1));
      rest = rest.slice(end + 1);
    }

    if (tags.length === 0) continue;

    const timestamps: number[] = [];
    for (const tag of tags) {
      const ms = parseTagMs(tag);
      if (ms !== null) timestamps.push(ms);
    }

    if (timestamps.length > 0) {
      for (const ts of timestamps) {
        lines.push({ timeMs: ts, text: rest });
      }
    } else {
      // No timestamps → metadata line; capture offset if present, then skip
      for (const tag of tags) {
        const m = tag.match(/^\[offset:([+-]?\d+)\]$/);
        if (m) {
          offsetMs = parseInt(m[1], 10);
          break;
        }
      }
    }
  }

  return lines
    .map((l) => ({ ...l, timeMs: l.timeMs - offsetMs }))
    .sort((a, b) => a.timeMs - b.timeMs);
}
