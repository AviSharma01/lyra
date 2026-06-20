import { describe, it, expect } from "vitest";
import { findCurrentLine } from "./findCurrentLine";
import type { LyricLine } from "./parseLrc";

const lines: LyricLine[] = [
  { timeMs: 5000, text: "A" },
  { timeMs: 10000, text: "B" },
  { timeMs: 15000, text: "C" },
  { timeMs: 20000, text: "D" },
];

describe("findCurrentLine", () => {
  it("returns -1 for empty array", () => {
    expect(findCurrentLine([], 10000)).toBe(-1);
  });

  it("returns -1 before the first line", () => {
    expect(findCurrentLine(lines, 0)).toBe(-1);
    expect(findCurrentLine(lines, 4999)).toBe(-1);
  });

  it("returns 0 at the exact boundary of the first line", () => {
    expect(findCurrentLine(lines, 5000)).toBe(0);
  });

  it("returns the previous index in a gap between lines", () => {
    expect(findCurrentLine(lines, 7500)).toBe(0);
    expect(findCurrentLine(lines, 12000)).toBe(1);
  });

  it("returns the correct index at an exact boundary", () => {
    expect(findCurrentLine(lines, 15000)).toBe(2);
  });

  it("returns the last index after the final line", () => {
    expect(findCurrentLine(lines, 20000)).toBe(3);
    expect(findCurrentLine(lines, 99999)).toBe(3);
  });
});
