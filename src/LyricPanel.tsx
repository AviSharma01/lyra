import { useEffect, useRef, useState, memo, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";
import { motion, AnimatePresence } from "motion/react";
import { fetchLyrics, type LyricsResult } from "./lyrics/fetchLyrics";
import { type LyricLine } from "./lyrics/parseLrc";
import { findCurrentLine } from "./lyrics/findCurrentLine";
import { translateLines, type TranslationResult } from "./lyrics/translate";
import { buildCacheKey, cacheGet, cacheSet } from "./lyrics/cache";
import { lyricWindowLayout } from "./lyrics/lyricWindowLayout";

interface SpotifyState {
  track: string;
  artist: string;
  album: string;
  duration_ms: number;
  position_ms: number;
  state: "playing" | "paused" | "stopped";
  artwork_data?: string;
}

type Playback = SpotifyState | null;

// Nominal slot height in px: ~44px pair content + 20px between-pair gap + 8px buffer.
const SLOT_HEIGHT = 72;

// Stable key representing a track identity — changes trigger a new fetch.
function trackKey(p: SpotifyState): string {
  return `${p.track}::${p.artist}`;
}

type WindowSlot =
  | { type: "blank"; key: string }
  | { type: "line"; key: string; line: LyricLine; isCurrent: boolean; translation: string | null };

// True when the model returned the line effectively unchanged (English pass-through).
// Normalized so minor casing/punctuation changes from the model don't show doubled lines.
function collapseEnglish(translation: string, original: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[.,!?;:'"''"…-]+$/, "");
  return norm(translation) === norm(original);
}

// offsets: e.g. [-1, 0, 1, 2, 3] for 5 slots with 1-above bias.
// Out-of-bounds positions become blank spacers.
// Lines are keyed by their global index so Framer Motion tracks identity across window shifts.
function buildWindow(
  lines: LyricLine[],
  currentIndex: number,
  perLine: (string | null)[] | null,
  offsets: number[],
): WindowSlot[] {
  return offsets.map((offset) => {
    const idx = currentIndex + offset;
    if (idx < 0 || idx >= lines.length) {
      return { type: "blank", key: `blank-${offset}` };
    }
    return {
      type: "line",
      key: String(idx),
      line: lines[idx],
      isCurrent: offset === 0 && currentIndex >= 0,
      translation: perLine ? (perLine[idx] ?? null) : null,
    };
  });
}

const LyricStack = memo(function LyricStack({
  lines,
  currentIndex,
  perLine,
  lineCount,
}: {
  lines: LyricLine[];
  currentIndex: number;
  perLine: (string | null)[] | null;
  lineCount: number;
}) {
  const { above } = lyricWindowLayout(lineCount * SLOT_HEIGHT, SLOT_HEIGHT);
  const offsets = Array.from({ length: lineCount }, (_, i) => i - above);

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {buildWindow(lines, currentIndex, perLine, offsets).map((slot) =>
        slot.type === "blank" ? (
          <motion.div key={slot.key} className="lyric-slot" layout />
        ) : (
          <motion.div
            key={slot.key}
            layout
            className={`lyric-line${slot.isCurrent ? " lyric-line--current" : ""}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: slot.isCurrent ? 1 : 0.28 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            <span className="lyric-original">{slot.line.text || "♪"}</span>
            {slot.line.text.trim() !== "" &&
              slot.translation !== null &&
              !collapseEnglish(slot.translation, slot.line.text) && (
                <span className="lyric-translation">{slot.translation}</span>
              )}
          </motion.div>
        )
      )}
    </AnimatePresence>
  );
});

export function LyricPanel() {
  const [playback, setPlayback] = useState<Playback | undefined>(undefined);
  const [displayPosition, setDisplayPosition] = useState(0);
  const [lyrics, setLyrics] = useState<LyricsResult | "fetching" | null>(null);
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  // Integer line count; only updates when the count changes (not every resize pixel).
  const [lineCount, setLineCount] = useState(5);
  const [theme, setTheme] = useState<"minimal" | "immersive">("minimal");

  // Restore saved theme. Window starts hidden so the async read completes before first show.
  useEffect(() => {
    load("settings.json").then(async (store) => {
      const saved = await store.get<string>("theme");
      if (saved === "minimal" || saved === "immersive") setTheme(saved);
    });
  }, []);

  // Tray toggle: switch theme and persist the choice.
  useEffect(() => {
    const promise = listen<string>("set-theme", async (event) => {
      const t = event.payload as "minimal" | "immersive";
      setTheme(t);
      const store = await load("settings.json");
      await store.set("theme", t);
      await store.save();
    });
    return () => { promise.then((u) => u()); };
  }, []);

  const tickRef = useRef<{ positionMs: number; timestamp: number; playing: boolean } | null>(null);
  const fetchedKeyRef = useRef<string | null>(null);
  const linesRef = useRef<LyricLine[]>([]);
  const lastIndexRef = useRef<number>(-1);
  const lineCountRef = useRef(5);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const promise = listen<Playback>("playback", (event) => setPlayback(event.payload));
    return () => {
      promise.then((u) => u());
    };
  }, []);

  // Anchor interpolation to each incoming tick.
  useEffect(() => {
    if (playback == null) {
      tickRef.current = null;
      setDisplayPosition(0);
      return;
    }
    tickRef.current = {
      positionMs: playback.position_ms,
      timestamp: Date.now(),
      playing: playback.state === "playing",
    };
  }, [playback]);

  // Single 100ms interval: interpolate position for the progress bar; advance lyric
  // index only when it changes so LyricStack (memoized) re-renders per line, not per tick.
  useEffect(() => {
    const id = setInterval(() => {
      if (!tickRef.current) return;
      const { positionMs, timestamp, playing } = tickRef.current;
      const pos = positionMs + (playing ? Date.now() - timestamp : 0);
      setDisplayPosition(pos);
      const idx = findCurrentLine(linesRef.current, pos);
      if (idx !== lastIndexRef.current) {
        lastIndexRef.current = idx;
        setCurrentIndex(idx);
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  // Fetch lyrics when track identity changes, debounced 400ms to absorb rapid skips.
  // fetchedKeyRef is set eagerly (before the timer) so that A→B→A within 400ms
  // works: cancelling B's timer leaves ref="B", A's guard fails, A re-fetches correctly
  // instead of deadlocking on "fetching" with no timer in flight.
  useEffect(() => {
    if (!playback) {
      fetchedKeyRef.current = null;
      setLyrics(null);
      setTranslationResult(null);
      return;
    }
    const key = trackKey(playback);
    if (key === fetchedKeyRef.current) return;
    fetchedKeyRef.current = key;
    setLyrics("fetching");
    setTranslationResult(null);

    const timer = setTimeout(async () => {
      try {
        const ckey = buildCacheKey(playback.track, playback.artist);
        const cached = await cacheGet(ckey);
        if (cached) {
          setLyrics({ status: "synced", lines: cached.lines });
          setTranslationResult({ kind: "translated", perLine: cached.perLine });
          return;
        }

        const result = await fetchLyrics(
          playback.track,
          playback.artist,
          playback.album,
          playback.duration_ms,
        );
        setLyrics(result);

        if (result.status !== "synced") return;

        const t = await translateLines(result.lines);
        if (t.kind !== "failed") {
          setTranslationResult(t);
          await cacheSet(ckey, { lines: result.lines, perLine: t.perLine });
        }
      } catch {
        setLyrics({ status: "failed" });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [playback]);

  // Wire linesRef when synced lyrics arrive. Keyed on lyrics, not track change, because
  // lyrics resolve async — setting linesRef on track change would write stale empty lines.
  useEffect(() => {
    if (lyrics !== null && lyrics !== "fetching" && lyrics.status === "synced") {
      linesRef.current = lyrics.lines;
    } else {
      linesRef.current = [];
    }
    lastIndexRef.current = -1;
    setCurrentIndex(-1);
  }, [lyrics]);

  // Attached only to the real lyric-display div (not status divs) so observed height
  // reflects the area available for lines. Only triggers a re-render when the integer
  // count changes — not on every resize pixel — mirroring the lastIndexRef gate above.
  const lyricAreaCallbackRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    observerRef.current = new ResizeObserver((entries) => {
      const h = entries[0].contentRect.height;
      const next = lyricWindowLayout(h, SLOT_HEIGHT).count;
      if (next !== lineCountRef.current) {
        lineCountRef.current = next;
        setLineCount(next);
      }
    });
    observerRef.current.observe(el);
  }, []);

  const progress =
    playback && playback.duration_ms > 0
      ? Math.min(displayPosition / playback.duration_ms, 1)
      : 0;

  function renderLyricsArea() {
    if (lyrics === null || lyrics === "fetching") {
      return (
        <div className="lyric-area lyric-area--status">
          {lyrics === "fetching" && <p className="lyric-status">Fetching lyrics…</p>}
        </div>
      );
    }
    if (lyrics.status === "instrumental") {
      return (
        <div className="lyric-area lyric-area--status">
          <p className="lyric-status">♪</p>
        </div>
      );
    }
    if (lyrics.status === "none") {
      return (
        <div className="lyric-area lyric-area--status">
          <p className="lyric-status">No synced lyrics</p>
        </div>
      );
    }
    if (lyrics.status === "failed") {
      return (
        <div className="lyric-area lyric-area--status">
          <p className="lyric-status">Couldn't load lyrics</p>
        </div>
      );
    }
    const perLine =
      translationResult?.kind === "translated" ? translationResult.perLine : null;
    return (
      <div className="lyric-area" ref={lyricAreaCallbackRef}>
        <LyricStack lines={lyrics.lines} currentIndex={currentIndex} perLine={perLine} lineCount={lineCount} />
      </div>
    );
  }

  return (
    <div className="panel" data-theme={theme}>
      <img
        className="immersive-backing"
        src={playback?.artwork_data ?? ""}
        alt=""
      />
      <div className="panel-drag-spacer" data-tauri-drag-region />
      {playback === undefined ? (
        <p className="status-text">Loading…</p>
      ) : playback === null ? (
        <p className="status-text">Open Spotify to see lyrics</p>
      ) : (
        <>
          <div className="track-header" data-tauri-drag-region>
            <div className="track-info-row">
              {playback.artwork_data && (
                <img className="track-art" src={playback.artwork_data} alt="" />
              )}
              <p className="track-meta">
                {playback.track} · {playback.artist}
              </p>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
          {renderLyricsArea()}
        </>
      )}
      <div className="panel-drag-spacer" data-tauri-drag-region />
    </div>
  );
}
