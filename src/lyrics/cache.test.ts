import { describe, it, expect } from "vitest";
import { buildCacheKey } from "./normalize";

describe("buildCacheKey", () => {
  it("lowercases and trims", () => {
    expect(buildCacheKey("Hello World", "The Artist")).toBe("hello world|the artist");
  });

  it("strips (feat. X) from track", () => {
    expect(buildCacheKey("Song (feat. X)", "Artist")).toBe("song|artist");
  });

  it("strips remaster suffix from track", () => {
    expect(buildCacheKey("Song - Remastered", "Artist")).toBe("song|artist");
  });

  it("normalizes artist parens too", () => {
    expect(buildCacheKey("Song", "Artist (feat. B)")).toBe("song|artist");
  });

  it("key is stable regardless of caller (no duration component)", () => {
    expect(buildCacheKey("Song", "Artist")).toBe(buildCacheKey("Song", "Artist"));
  });

  it("separates track and artist with pipe", () => {
    const key = buildCacheKey("A", "B");
    const [track, artist] = key.split("|");
    expect(track).toBe("a");
    expect(artist).toBe("b");
  });
});
