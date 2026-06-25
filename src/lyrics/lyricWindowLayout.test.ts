import { describe, it, expect } from "vitest";
import { lyricWindowLayout } from "./lyricWindowLayout";

const SLOT = 60;

describe("lyricWindowLayout", () => {
  it("clamps to 1 when height is 0", () => {
    expect(lyricWindowLayout(0, SLOT)).toEqual({ count: 1, above: 0, below: 0 });
  });

  it("clamps to 1 when height is less than one slot", () => {
    expect(lyricWindowLayout(59, SLOT)).toEqual({ count: 1, above: 0, below: 0 });
  });

  it("returns 1 slot at exactly one slot height", () => {
    // floor(60/60) = 1; no room for an above slot
    expect(lyricWindowLayout(60, SLOT)).toEqual({ count: 1, above: 0, below: 0 });
  });

  it("returns 2 slots at exactly 2× slot height, 1-above bias kicks in", () => {
    expect(lyricWindowLayout(120, SLOT)).toEqual({ count: 2, above: 1, below: 0 });
  });

  it("returns 3 slots (nominal floor for ~3-line minimum)", () => {
    expect(lyricWindowLayout(180, SLOT)).toEqual({ count: 3, above: 1, below: 1 });
  });

  it("returns 5 slots for 300px (existing hardcoded lyric-area equivalent)", () => {
    expect(lyricWindowLayout(300, SLOT)).toEqual({ count: 5, above: 1, below: 3 });
  });

  it("ignores partial slot — floor, not round", () => {
    expect(lyricWindowLayout(359, SLOT)).toEqual({ count: 5, above: 1, below: 3 });
  });

  it("returns 6 slots at exactly 360px", () => {
    expect(lyricWindowLayout(360, SLOT)).toEqual({ count: 6, above: 1, below: 4 });
  });
});
