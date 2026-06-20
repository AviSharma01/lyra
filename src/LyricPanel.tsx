import { useEffect, useRef, useState, memo } from "react";
import { listen } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "motion/react";
import { fetchLyrics, type LyricsResult } from "./lyrics/fetchLyrics";
import { type LyricLine } from "./lyrics/parseLrc";
import { findCurrentLine } from "./lyrics/findCurrentLine";

interface SpotifyState {
  track: string;
  artist: string;
  album: string;
  duration_ms: number;
  position_ms: number;
  state: "playing" | "paused" | "stopped";
}

type Playback = SpotifyState | null;

// Stable key representing a track identity — changes trigger a new fetch.
function trackKey(p: SpotifyState): string {
  return `${p.track}::${p.artist}`;
}

type WindowSlot =
  | { type: "blank"; key: string }
  | { type: "line"; key: string; line: LyricLine; isCurrent: boolean };

// 5 slots: [above, current, +1, +2, +3]. Out-of-bounds positions become blank spacers.
// Lines are keyed by their global index so Framer Motion tracks identity across window shifts.
function buildWindow(lines: LyricLine[], currentIndex: number): WindowSlot[] {
  return [-1, 0, 1, 2, 3].map((offset) => {
    const idx = currentIndex + offset;
    if (idx < 0 || idx >= lines.length) {
      return { type: "blank", key: `blank-${offset}` };
    }
    return {
      type: "line",
      key: String(idx),
      line: lines[idx],
      isCurrent: offset === 0 && currentIndex >= 0,
    };
  });
}

const LyricStack = memo(function LyricStack({
  lines,
  currentIndex,
}: {
  lines: LyricLine[];
  currentIndex: number;
}) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {buildWindow(lines, currentIndex).map((slot) =>
        slot.type === "blank" ? (
          <motion.div key={slot.key} className="lyric-slot" layout />
        ) : (
          <motion.p
            key={slot.key}
            layout
            className={`lyric-line${slot.isCurrent ? " lyric-line--current" : ""}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: slot.isCurrent ? 1 : 0.28 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            {slot.line.text || "♪"}
          </motion.p>
        )
      )}
    </AnimatePresence>
  );
});

export function LyricPanel() {
  const [playback, setPlayback] = useState<Playback | undefined>(undefined);
  const [displayPosition, setDisplayPosition] = useState(0);
  const [lyrics, setLyrics] = useState<LyricsResult | "fetching" | null>(null);
  const [currentIndex, setCurrentIndex] = useState(-1);

  const tickRef = useRef<{ positionMs: number; timestamp: number; playing: boolean } | null>(null);
  const fetchedKeyRef = useRef<string | null>(null);
  const linesRef = useRef<LyricLine[]>([]);
  const lastIndexRef = useRef<number>(-1);

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
      return;
    }
    const key = trackKey(playback);
    if (key === fetchedKeyRef.current) return;
    fetchedKeyRef.current = key;
    setLyrics("fetching");
    const timer = setTimeout(() => {
      fetchLyrics(playback.track, playback.artist, playback.album, playback.duration_ms)
        .then(setLyrics)
        .catch(() => setLyrics({ status: "failed" }));
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
    return (
      <div className="lyric-area">
        <LyricStack lines={lyrics.lines} currentIndex={currentIndex} />
      </div>
    );
  }

  return (
    <div className="panel">
      {playback === undefined ? (
        <p className="status-text">Loading…</p>
      ) : playback === null ? (
        <p className="status-text">Open Spotify to see lyrics</p>
      ) : (
        <>
          <div className="track-header">
            <p className="track-meta">
              {playback.track} · {playback.artist}
            </p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
          {renderLyricsArea()}
        </>
      )}
    </div>
  );
}
