export interface LyricLayout {
  count: number;
  above: number;
  below: number;
}

// Slot height is nominal — wrapped translations are taller (~80-120px), so count may
// overestimate slightly on busy songs. overflow:hidden on the lyric area clips the rest.
export function lyricWindowLayout(availableHeight: number, slotHeight: number): LyricLayout {
  const count = Math.max(1, Math.floor(availableHeight / slotHeight));
  const above = count >= 2 ? 1 : 0;
  const below = count - 1 - above;
  return { count, above, below };
}
