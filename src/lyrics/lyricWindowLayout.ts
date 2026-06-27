export interface LyricLayout {
  count: number;
  above: number;
  below: number;
}

// Slot height is nominal — wrapped translations are taller, so count may overestimate
// slightly on busy songs. overflow:hidden on the lyric area clips the rest.
export function lyricWindowLayout(availableHeight: number, slotHeight: number): LyricLayout {
  const count = Math.max(1, Math.floor(availableHeight / slotHeight));
  // Spotify-style upper-middle anchor: current sits ~1/3 from top (above ≈ (count-1)/3).
  // Clamp to 1 minimum when count >= 2 so there is always at least one lead line.
  const above = count <= 1 ? 0 : Math.max(1, Math.round((count - 1) / 3));
  const below = count - 1 - above;
  return { count, above, below };
}
