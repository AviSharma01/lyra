import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { fetchLyrics, type LyricsResult } from "./lyrics/fetchLyrics";

interface SpotifyState {
  track: string;
  artist: string;
  album: string;
  duration_ms: number;
  position_ms: number;
  state: "playing" | "paused" | "stopped";
}

type Playback = SpotifyState | null;

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Stable key representing a track identity — changes trigger a new fetch.
function trackKey(p: SpotifyState): string {
  return `${p.track}::${p.artist}`;
}

export function LyricPanel() {
  const [playback, setPlayback] = useState<Playback | undefined>(undefined);
  const [displayPosition, setDisplayPosition] = useState(0);
  const [lyrics, setLyrics] = useState<LyricsResult | "fetching" | null>(null);

  const tickRef = useRef<{
    positionMs: number;
    timestamp: number;
    playing: boolean;
  } | null>(null);
  const fetchedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const promise = listen<Playback>("playback", (event) => {
      setPlayback(event.payload);
    });
    return () => {
      promise.then((unlisten) => unlisten());
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

  // Interpolate position at 100ms for smooth progress.
  useEffect(() => {
    const id = setInterval(() => {
      if (!tickRef.current) return;
      const { positionMs, timestamp, playing } = tickRef.current;
      const elapsed = playing ? Date.now() - timestamp : 0;
      setDisplayPosition(positionMs + elapsed);
    }, 100);
    return () => clearInterval(id);
  }, []);

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

    fetchLyrics(playback.track, playback.artist, playback.album, playback.duration_ms)
      .then(setLyrics)
      .catch(() => setLyrics({ status: "none" }));
  }, [playback]);

  const stateIcon =
    playback?.state === "playing" ? "▶" : playback?.state === "stopped" ? "■" : "⏸";

  const progress =
    playback && playback.duration_ms > 0
      ? Math.min(displayPosition / playback.duration_ms, 1)
      : 0;

  function renderLyricsStatus() {
    if (lyrics === null) return null;
    if (lyrics === "fetching") return <p className="lyric-placeholder">Fetching lyrics…</p>;
    if (lyrics.status === "instrumental")
      return <p className="lyric-placeholder">♪ Instrumental</p>;
    if (lyrics.status === "none")
      return <p className="lyric-placeholder">No synced lyrics available</p>;
    return (
      <p className="lyric-placeholder">
        Synced lyrics loaded — {lyrics.lines.length} lines
      </p>
    );
  }

  return (
    <div className="panel">
      {playback === undefined ? (
        <p className="status-text">Loading…</p>
      ) : playback === null ? (
        <p className="status-text">Open Spotify to see lyrics</p>
      ) : (
        <div className="track-section">
          <span className="play-state">{stateIcon}</span>
          <p className="track-title">{playback.track}</p>
          <p className="track-artist">{playback.artist}</p>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="progress-time">
            <span>{formatTime(displayPosition)}</span>
            <span>{formatTime(playback.duration_ms)}</span>
          </div>
        </div>
      )}
      {playback != null && renderLyricsStatus()}
    </div>
  );
}
