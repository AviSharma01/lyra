import { type LyricLine } from "./parseLrc";

export type TranslationResult =
  | { kind: "translated"; perLine: (string | null)[] }
  | { kind: "failed" };

// Pure: parse the model's response into a Map from 1-based subset line number to translation.
// [[N]] markers are the transport; any line without one is ignored (preamble / commentary).
// Out-of-order numbers: fine — keyed by number, not position.
// Duplicate numbers: first wins.
// Empty text after marker: skipped — renders original-only, same as missing.
export function parseNumberedResponse(content: string): Map<number, string> {
  const MARKER = /^\[\[(\d+)\]\]\s*(.*)/;
  const map = new Map<number, string>();
  for (const raw of content.split("\n")) {
    const m = raw.trim().match(MARKER);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    // Strip any leading [[N]] prefixes the model echoed back (can be doubled or tripled).
    let text = m[2].trim();
    while (/^\[\[\d+\]\]/.test(text)) {
      text = text.replace(/^\[\[\d+\]\]\s*/, "").trim();
    }
    if (text === "") continue;
    if (!map.has(num)) map.set(num, text);
  }
  return map;
}

// Pure: build the full-length per-line translation array (length === lines.length).
// nonEmptyIndices[i] corresponds to subset number i+1. Blank gap lines and dropped lines
// both become null — the caller renders them original-only.
export function assemblePerLine(
  lines: LyricLine[],
  nonEmptyIndices: number[],
  parsed: Map<number, string>,
): (string | null)[] {
  const result: (string | null)[] = lines.map(() => null);
  nonEmptyIndices.forEach((lineIdx, i) => {
    const translation = parsed.get(i + 1);
    if (translation !== undefined) result[lineIdx] = translation;
  });
  return result;
}

// Pure: true when fewer than half the sent lines received a parsed translation.
// Signals the model likely ignored the [[N]] format; a retry is worth attempting.
// Integer arithmetic avoids floating-point edge cases.
export function needsRetry(sent: number, parsedCount: number): boolean {
  return parsedCount * 2 < sent;
}

const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_MODEL = "qwen2.5:7b";
// The English reproduction rule must stay character-for-character emphatic.
// collapseEnglish() in LyricPanel fires when translation === original after normalization,
// suppressing the doubled-line display. If the model rephrases ("wanna" → "want to"),
// the strings genuinely differ, collapse doesn't fire, and English lines show twice.
// Loosening the rule reintroduces exactly that regression — don't soften it.
// Manual check: a contraction-heavy fully-English line (e.g. "I just wanna dive") must
// come back byte-identical so collapse fires and the line renders original-only.
const PROMPT =
  "Translate these song lyrics to natural English.\n\n" +
  "Lines are numbered with [[N]] markers. For each numbered line, return that marker with its " +
  "translation on the same line.\n" +
  "Use the whole song as context. Give the meaning a listener would understand, preferring " +
  "natural intended sense over literal word-for-word, and keep the tone.\n\n" +
  "Follow these rules for each line:\n" +
  '- If a line is ENTIRELY in English, reproduce it EXACTLY, character for character: no rephrasing, no expanding contractions ("wanna" stays "wanna", "gonna" stays "gonna"), no grammar or spelling fixes, no added or removed words, no punctuation changes.\n' +
  "- If a line is entirely in another language, translate it to natural English.\n" +
  "- If a line MIXES English with another language, translate the whole line into one natural English line (carry the already-English words through naturally). A mixed line is NOT \"already English\" — it gets a translation.\n" +
  "- Romanized non-English text (another language written in Latin letters) is NOT English; translate it.\n" +
  "- Only a fully-English line is reproduced unchanged.\n\n" +
  "Format each output line as: [[N]] <translation>\n" +
  "Use the exact same [[N]] marker as the input line. One output line per input line, same order.\n" +
  "No merging, splitting, reordering, or combining lines.\n" +
  "No preamble, no commentary, no extra lines.";

// Appended on retry only — stronger format reminder to recover from ignored [[N]] markers.
const RETRY_HINT =
  "\n\nReturn ONLY lines of the form [[N]] translation, nothing else. No preamble.";

interface OllamaChatResponse {
  message: { content: string };
}

// Dynamic import keeps @tauri-apps/plugin-http out of module-level scope so the Node-env
// test suite can import the pure functions above without a Tauri runtime present.
async function ollamaTranslate(texts: string[], extraHint = ""): Promise<string> {
  const { fetch } = await import("@tauri-apps/plugin-http");
  const numbered = texts.map((t, i) => `[[${i + 1}]] ${t}`).join("\n");
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: `${PROMPT}\n\n${numbered}${extraHint}` }],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = (await res.json()) as OllamaChatResponse;
  return data.message.content;
}

export async function translateLines(lines: LyricLine[]): Promise<TranslationResult> {
  const nonEmptyIndices: number[] = [];
  const texts: string[] = [];

  lines.forEach((line, i) => {
    if (line.text.trim() !== "") {
      nonEmptyIndices.push(i);
      texts.push(line.text);
    }
  });

  if (nonEmptyIndices.length === 0) {
    return { kind: "translated", perLine: lines.map(() => null) };
  }

  let content: string;
  try {
    content = await ollamaTranslate(texts);
  } catch {
    return { kind: "failed" };
  }

  let parsed = parseNumberedResponse(content);

  if (needsRetry(texts.length, parsed.size)) {
    // Retry with a stronger format reminder so we're not just replaying the same call.
    try {
      const content2 = await ollamaTranslate(texts, RETRY_HINT);
      parsed = parseNumberedResponse(content2);
    } catch {
      return { kind: "failed" };
    }
    // Accept after retry regardless of remaining coverage.
  }

  return { kind: "translated", perLine: assemblePerLine(lines, nonEmptyIndices, parsed) };
}
