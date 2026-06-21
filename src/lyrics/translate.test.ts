import { describe, it, expect } from "vitest";
import { parseNumberedResponse, assemblePerLine, needsRetry } from "./translate";
import { type LyricLine } from "./parseLrc";

function lines(...texts: string[]): LyricLine[] {
  return texts.map((text, i) => ({ timeMs: i * 1000, text }));
}

describe("parseNumberedResponse", () => {
  it("parses a well-formed [[N]] response", () => {
    const m = parseNumberedResponse("[[1]] Hello\n[[2]] World");
    expect(m.get(1)).toBe("Hello");
    expect(m.get(2)).toBe("World");
    expect(m.size).toBe(2);
  });

  it("trims whitespace around translation text", () => {
    const m = parseNumberedResponse("[[1]]   foo   ");
    expect(m.get(1)).toBe("foo");
  });

  it("ignores preamble and commentary lines without [[N]] marker", () => {
    const m = parseNumberedResponse(
      "Here are the translations:\n[[1]] Hello\n[[2]] World\nDone.",
    );
    expect(m.size).toBe(2);
    expect(m.get(1)).toBe("Hello");
    expect(m.get(2)).toBe("World");
  });

  it("handles out-of-order numbers correctly", () => {
    const m = parseNumberedResponse("[[3]] Third\n[[1]] First\n[[2]] Second");
    expect(m.get(1)).toBe("First");
    expect(m.get(2)).toBe("Second");
    expect(m.get(3)).toBe("Third");
  });

  it("missing middle number is simply absent from the map", () => {
    const m = parseNumberedResponse("[[1]] foo\n[[3]] baz");
    expect(m.has(2)).toBe(false);
    expect(m.get(1)).toBe("foo");
    expect(m.get(3)).toBe("baz");
  });

  it("first wins on duplicate numbers", () => {
    const m = parseNumberedResponse("[[1]] first\n[[1]] second");
    expect(m.get(1)).toBe("first");
    expect(m.size).toBe(1);
  });

  it("hallucinated number we didn't send is stored but harmless", () => {
    const m = parseNumberedResponse("[[1]] foo\n[[999]] hallucinated");
    expect(m.get(999)).toBe("hallucinated"); // stored
    // assemblePerLine never looks up 999 unless we actually sent 999 lines
  });

  it("empty text after marker is skipped — that line renders original-only", () => {
    const m = parseNumberedResponse("[[1]] \n[[2]] World");
    expect(m.has(1)).toBe(false); // empty → skip
    expect(m.get(2)).toBe("World");
  });

  it("multi-digit numbers parse correctly", () => {
    const m = parseNumberedResponse("[[12]] twelve\n[[100]] hundred");
    expect(m.get(12)).toBe("twelve");
    expect(m.get(100)).toBe("hundred");
  });

  it("old-style N. format is NOT matched (no marker collision)", () => {
    const m = parseNumberedResponse("1. Hello\n2. World");
    expect(m.size).toBe(0);
  });

  it("lyric lines starting with numbers are NOT matched without [[N]] wrapper", () => {
    const m = parseNumberedResponse("1000 reasons\n24 hours");
    expect(m.size).toBe(0);
  });

  it("doubled leading marker is stripped — stored value contains no [[", () => {
    const m = parseNumberedResponse("[[3]] [[3]] some text");
    expect(m.get(3)).toBe("some text");
    expect(m.get(3)).not.toContain("[[");
  });

  it("tripled leading marker collapses to clean text", () => {
    const m = parseNumberedResponse("[[1]] [[1]] [[1]] deeply nested");
    expect(m.get(1)).toBe("deeply nested");
  });
});

describe("assemblePerLine", () => {
  // Marker strings are deliberately different from input text so a mis-mapped
  // translation is detectable — an echo would pass even on wrong indices.

  it("leading blank: translation lands on correct index, blank stays null", () => {
    const ls = lines("", "A", "B");
    const parsed = new Map([[1, "T:1"], [2, "T:2"]]);
    const result = assemblePerLine(ls, [1, 2], parsed);
    expect(result[0]).toBeNull();   // blank gap → null
    expect(result[1]).toBe("T:1"); // subset #1 → index 1
    expect(result[2]).toBe("T:2"); // subset #2 → index 2
  });

  it("consecutive blanks: translations skip them correctly", () => {
    const ls = lines("A", "", "", "B");
    const parsed = new Map([[1, "T:1"], [2, "T:2"]]);
    const result = assemblePerLine(ls, [0, 3], parsed);
    expect(result[0]).toBe("T:1"); // subset #1 → index 0
    expect(result[1]).toBeNull();
    expect(result[2]).toBeNull();
    expect(result[3]).toBe("T:2"); // subset #2 → index 3, not 1
  });

  it("trailing blank stays null", () => {
    const ls = lines("A", "B", "");
    const parsed = new Map([[1, "T:1"], [2, "T:2"]]);
    const result = assemblePerLine(ls, [0, 1], parsed);
    expect(result[0]).toBe("T:1");
    expect(result[1]).toBe("T:2");
    expect(result[2]).toBeNull();
  });

  it("dropped middle line: that slot is null, others land correctly", () => {
    const ls = lines("A", "B", "C");
    // Model returned #1 and #3, dropped #2
    const parsed = new Map([[1, "T:1"], [3, "T:3"]]);
    const result = assemblePerLine(ls, [0, 1, 2], parsed);
    expect(result[0]).toBe("T:1");
    expect(result[1]).toBeNull(); // dropped → null, renders original-only
    expect(result[2]).toBe("T:3"); // subset #3 → index 2, not confused with dropped #2
  });

  it("all blank lines: every entry is null", () => {
    const ls = lines("", "", "");
    const result = assemblePerLine(ls, [], new Map());
    expect(result).toEqual([null, null, null]);
  });
});

describe("needsRetry", () => {
  it("fewer than half → retry", () => {
    expect(needsRetry(10, 4)).toBe(true);
  });

  it("exactly half → no retry", () => {
    expect(needsRetry(10, 5)).toBe(false); // 5*2 = 10, not < 10
  });

  it("more than half → no retry", () => {
    expect(needsRetry(10, 6)).toBe(false);
  });

  it("none parsed, 1 sent → retry", () => {
    expect(needsRetry(1, 0)).toBe(true);
  });

  it("all parsed → no retry", () => {
    expect(needsRetry(1, 1)).toBe(false);
  });

  it("0 sent, 0 parsed → no retry", () => {
    expect(needsRetry(0, 0)).toBe(false); // 0*2 = 0, not < 0
  });
});
