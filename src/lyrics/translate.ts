import { type LyricLine } from "./parseLrc";

export function validateLineCount(sent: number, received: number): "ok" | "mismatch" {
  return sent === received ? "ok" : "mismatch";
}

// Pure mapping: places each translated string back at its original line index.
// nonEmptyIndices: sorted indices of the non-empty lines that were sent for translation.
// translated: one string per non-empty line, in order.
// Blank lines (not in nonEmptyIndices) remain "".
export function mapTranslations(
  lines: LyricLine[],
  nonEmptyIndices: number[],
  translated: string[],
): string[] {
  const result = lines.map(() => "");
  nonEmptyIndices.forEach((lineIdx, i) => {
    result[lineIdx] = translated[i];
  });
  return result;
}

// Stub translator: echoes lines back unchanged. Slice 2 replaces this body with the
// real Ollama call; the signature and surrounding mapping/validation logic stays the same.
async function stubTranslate(texts: string[]): Promise<string[]> {
  return texts;
}

export async function translateLines(lines: LyricLine[]): Promise<string[]> {
  const nonEmptyIndices: number[] = [];
  const texts: string[] = [];

  lines.forEach((line, i) => {
    if (line.text.trim() !== "") {
      nonEmptyIndices.push(i);
      texts.push(line.text);
    }
  });

  if (nonEmptyIndices.length === 0) return lines.map(() => "");

  const translated = await stubTranslate(texts);

  if (validateLineCount(nonEmptyIndices.length, translated.length) === "mismatch") {
    return lines.map(() => "");
  }

  return mapTranslations(lines, nonEmptyIndices, translated);
}
