# Lyra
 
A macOS menu-bar app that shows synced, translated lyrics for whatever you're playing in
Spotify. Local-first, private, and built to stay out of your way.
 
Lyra watches the Spotify desktop app, fetches time-synced lyrics, and translates them to English
on-device using a local LLM, then floats them in a frosted panel that sits above your other
windows. Everything happens on your machine: no accounts, no API keys, no cloud.
 
> This is a personal project, shared as source. It is not distributed as a downloadable app
> (see [Building](#building)).
 
## Features
 
- Synced lyrics that follow the current Spotify track, line by line.
- On-device English translation via a local Ollama model. Fully-English lines are left as-is;
  non-English and mixed lines are translated.
- Two themes: a neutral frosted glass look, and an immersive theme that uses the current song's
  album art, blurred, as a living backing that changes with each track.
- A floating panel you can drag anywhere and resize, with its position, size, and theme
  remembered between launches.
- Album art in the header, and a glanceable "Title · Artist" in the menu bar when the panel is
  hidden.
- Offline caching: once a song is translated, it loads instantly on every replay.
- Graceful degradation: if the translation model isn't running, lyrics still show in their
  original language.
## How it works
 
Lyra reads the currently playing track from the Spotify desktop app over AppleScript (no Spotify
account or web API involved). It fetches time-synced lyrics from [LRCLIB](https://lrclib.net),
with a strict matching gate so it never shows the wrong song's lyrics. Each song is translated in
a single pass by a local [Ollama](https://ollama.com) model, with results cached in a local
database so repeats are instant.
 
Nothing leaves your machine except the lyric lookup to LRCLIB and the album-art fetch. There are
no API keys, no analytics, and no cloud translation.
 
## Requirements
 
- macOS (Apple Silicon or Intel).
- The Spotify desktop app.
- [Ollama](https://ollama.com) running locally with a translation-capable model
  (developed against `qwen2.5:7b`; a larger model improves quality, especially for romanized
  lyrics).
## Building
 
Lyra is shared as source and is not distributed as a prebuilt app. To run it, build it yourself:
 
```bash
# install dependencies
npm install
 
# run in development
npm run tauri dev
 
# build a local .app bundle
npm run tauri build
```
 
On first launch macOS will ask for permission to control Spotify (for reading the current
track). An unsigned local build will also prompt Gatekeeper once; right-click the app and choose
Open to get past it.
 
## Technical details
 
- Built with [Tauri v2](https://tauri.app): a React + TypeScript + Vite frontend with a thin Rust
  core that owns the window, tray, and OS integration.
- Spotify state is read via AppleScript from Rust and polled once a second, with sub-second
  interpolation for smooth lyric progress.
- Synced lyrics come from LRCLIB via an exact lookup, then a strict-gated search (normalized title
  plus duration tolerance) so a near-miss never resolves to the wrong song.
- Translation uses a local Ollama model in a single whole-song call, with a numbered transport so
  individual lines stay aligned and a per-line fallback so a dropped line never desyncs the rest.
- Lyrics and translations are cached in SQLite; only validated results are stored.
- The frosted panel uses native macOS vibrancy (not CSS), with album art delivered through the
  Rust layer so the app's network surface stays scoped to LRCLIB and the local model only.
## Acknowledgements
 
- [LRCLIB](https://lrclib.net) by [tranxuanthang](https://github.com/tranxuanthang), the open
  lyric library Lyra depends on for synced lyrics.
- [Ollama](https://ollama.com) for making local model inference easy.
- [Tauri](https://tauri.app) and the `window-vibrancy` crate.