import { describe, it, expect } from "vitest";
import { lyricWindowLayout } from "./lyricWindowLayout";

const SLOT = 72;

describe("lyricWindowLayout", () => {
  it("clamps to 1 when height is 0", () => {
    expect(lyricWindowLayout(0, SLOT)).toEqual({ count: 1, above: 0, below: 0 });
  });

  it("clamps to 1 when height is less than one slot", () => {
    expect(lyricWindowLayout(71, SLOT)).toEqual({ count: 1, above: 0, below: 0 });
  });

  it("returns 1 slot at exactly one slot height", () => {
    expect(lyricWindowLayout(72, SLOT)).toEqual({ count: 1, above: 0, below: 0 });
  });

  it("returns 2 slots at exactly 2× slot height, 1-above clamp kicks in", () => {
    expect(lyricWindowLayout(144, SLOT)).toEqual({ count: 2, above: 1, below: 0 });
  });

  it("returns 3 slots — 1 above, 1 below", () => {
    expect(lyricWindowLayout(216, SLOT)).toEqual({ count: 3, above: 1, below: 1 });
  });

  it("returns 5 slots — 1 above, 3 below (forward-biased)", () => {
    // round((5-1)/3) = round(1.33) = 1
    expect(lyricWindowLayout(360, SLOT)).toEqual({ count: 5, above: 1, below: 3 });
  });

  it("ignores partial slot — floor, not round", () => {
    expect(lyricWindowLayout(431, SLOT)).toEqual({ count: 5, above: 1, below: 3 });
  });

  it("returns 6 slots at 432px — Spotify-style upper-middle: 2 above, 3 below", () => {
    // round((6-1)/3) = round(1.67) = 2
    expect(lyricWindowLayout(432, SLOT)).toEqual({ count: 6, above: 2, below: 3 });
  });
});
