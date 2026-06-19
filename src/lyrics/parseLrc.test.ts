import { describe, it, expect } from "vitest";
import { parseLrc } from "./parseLrc";

describe("parseLrc", () => {
  it("returns [] for empty input", () => {
    expect(parseLrc("")).toEqual([]);
    expect(parseLrc("   \n  ")).toEqual([]);
  });

  it("parses a basic single-timestamp line", () => {
    expect(parseLrc("[00:12.34]Hello")).toEqual([{ timeMs: 12340, text: "Hello" }]);
  });

  it("handles 2-digit fraction correctly", () => {
    // .05 → 50 ms, not 5 ms
    expect(parseLrc("[01:02.05]A")).toEqual([{ timeMs: 62050, text: "A" }]);
    expect(parseLrc("[01:02.50]A")).toEqual([{ timeMs: 62500, text: "A" }]);
  });

  it("handles 3-digit fraction correctly", () => {
    expect(parseLrc("[01:02.005]A")).toEqual([{ timeMs: 62005, text: "A" }]);
    expect(parseLrc("[01:02.500]A")).toEqual([{ timeMs: 62500, text: "A" }]);
  });

  it("expands multiple timestamps on one line into separate entries", () => {
    const result = parseLrc("[00:12.00][01:40.00]chorus");
    expect(result).toEqual([
      { timeMs: 12000, text: "chorus" },
      { timeMs: 100000, text: "chorus" },
    ]);
  });

  it("skips metadata tags (no timestamps on the line)", () => {
    const input = "[ar:Artist]\n[ti:Title]\n[al:Album]\n[by:Me]\n[length:3:00]";
    expect(parseLrc(input)).toEqual([]);
  });

  it("keeps timestamped lines with empty text (instrumental gaps)", () => {
    expect(parseLrc("[00:30.00]")).toEqual([{ timeMs: 30000, text: "" }]);
  });

  it("skips malformed lines without throwing", () => {
    const input = "[notvalid]garbage\n[00:10.00]good";
    expect(parseLrc(input)).toEqual([{ timeMs: 10000, text: "good" }]);
  });

  it("applies positive offset: timeMs -= offsetMs (lyrics appear earlier)", () => {
    const input = "[offset:500]\n[00:10.00]A";
    expect(parseLrc(input)).toEqual([{ timeMs: 9500, text: "A" }]);
  });

  it("applies negative offset: timeMs -= offsetMs (lyrics appear later)", () => {
    const input = "[offset:-200]\n[00:10.00]A";
    expect(parseLrc(input)).toEqual([{ timeMs: 10200, text: "A" }]);
  });

  it("sorts output ascending by timeMs (multi-timestamp expansion can reorder)", () => {
    // Second timestamp (12s) sorts before first (100s)
    const input = "[01:40.00][00:12.00]text";
    const result = parseLrc(input);
    expect(result[0].timeMs).toBe(12000);
    expect(result[1].timeMs).toBe(100000);
  });

  it("treats bracketed colons in lyrics as text, not metadata, when a timestamp is present", () => {
    const input = "[00:15.00]Hello [name:World] today";
    expect(parseLrc(input)).toEqual([{ timeMs: 15000, text: "Hello [name:World] today" }]);
  });
});
