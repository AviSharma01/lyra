// Shared name normalization used by both the lyrics fetcher and cache key builder.
// Strip ALL parentheticals before the remaster suffix so "Song - Remastered (feat. X)"
// works: feat. strips first, then the $-anchored remaster regex fires cleanly.
// [-–—] covers en/em dashes that streaming metadata uses instead of hyphens.
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s*[-–—]\s*(\d{4}\s+)?remaster(ed)?(\s+\d{4})?(\s+version)?\s*$/i, "")
    .trim();
}

// Cache key: normalized track|artist. Duration omitted — Spotify rounding can drift ±1s
// between store and lookup, turning a valid cache entry into a permanent miss.
export function buildCacheKey(track: string, artist: string): string {
  return `${normalizeName(track)}|${normalizeName(artist)}`;
}
