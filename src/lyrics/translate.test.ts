import { describe, it, expect } from "vitest";
import { validateLineCount, mapTranslations } from "./translate";
import { type LyricLine } from "./parseLrc";

function lines(...texts: string[]): LyricLine[] {
  return texts.map((text, i) => ({ timeMs: i * 1000, text }));
}

describe("validateLineCount", () => {
  it("ok when counts match", () => {
    expect(validateLineCount(3, 3)).toBe("ok");
  });
  it("mismatch when received fewer", () => {
    expect(validateLineCount(3, 2)).toBe("mismatch");
  });
  it("mismatch when received more", () => {
    expect(validateLineCount(3, 4)).toBe("mismatch");
  });
  it("ok for zero/zero", () => {
    expect(validateLineCount(0, 0)).toBe("ok");
  });
});

describe("mapTranslations", () => {
  // Markers are intentionally different from input text so a misplaced mapping is
  // detectable — an echo stub would pass even with wrong indices.

  it("leading blank: translation lands on correct index, blank stays empty", () => {
    const ls = lines("", "Hello", "World");
    const result = mapTranslations(ls, [1, 2], ["T:1", "T:2"]);
    expect(result[0]).toBe("");     // blank untouched
    expect(result[1]).toBe("T:1"); // must be index 1, not 0
    expect(result[2]).toBe("T:2");
  });

  it("consecutive blanks: translations skip them correctly", () => {
    const ls = lines("Hello", "", "", "World");
    const result = mapTranslations(ls, [0, 3], ["T:0", "T:3"]);
    expect(result[0]).toBe("T:0");
    expect(result[1]).toBe("");
    expect(result[2]).toBe("");
    expect(result[3]).toBe("T:3"); // must be index 3, not 1
  });

  it("trailing blank: stays empty", () => {
    const ls = lines("Hello", "World", "");
    const result = mapTranslations(ls, [0, 1], ["T:0", "T:1"]);
    expect(result[0]).toBe("T:0");
    expect(result[1]).toBe("T:1");
    expect(result[2]).toBe("");
  });

  it("all blanks: returns all empty strings", () => {
    const ls = lines("", "", "");
    expect(mapTranslations(ls, [], [])).toEqual(["", "", ""]);
  });
});
