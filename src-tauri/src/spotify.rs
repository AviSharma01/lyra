#[derive(Debug, Clone, serde::Serialize)]
pub struct SpotifyState {
    pub track: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u64,
    pub position_ms: u64,
    pub state: String,
    pub artwork_data: Option<String>,
}

pub fn parse_output(output: &str) -> Option<SpotifyState> {
    let output = output.trim();
    if output.is_empty() {
        return None;
    }
    let mut lines = output.lines();
    let track = lines.next()?.to_string();
    let artist = lines.next()?.to_string();
    let album = lines.next()?.to_string();
    let duration_ms: u64 = lines.next()?.trim().parse().ok()?;
    let position_secs: f64 = lines.next()?.trim().parse().ok()?;
    let position_ms = (position_secs * 1000.0) as u64;
    let state = lines.next()?.trim().to_string();
    Some(SpotifyState { track, artist, album, duration_ms, position_ms, state, artwork_data: None })
}

// Cache keyed by artwork URL: Some(data_url) = success, None = tried and failed / no art.
// Stored as (url, Option<data_url>) so both hits and misses avoid re-fetching every tick.
static ARTWORK_CACHE: std::sync::Mutex<Option<(String, Option<String>)>> =
    std::sync::Mutex::new(None);

fn fetch_artwork(url: &str) -> Option<String> {
    // Check cache first (covers both success and confirmed-miss entries).
    if let Ok(guard) = ARTWORK_CACHE.lock() {
        if let Some((cached_url, data)) = guard.as_ref() {
            if cached_url == url {
                return data.clone();
            }
        }
    }

    let result = fetch_artwork_inner(url);

    if let Ok(mut guard) = ARTWORK_CACHE.lock() {
        *guard = Some((url.to_string(), result.clone()));
    }

    result
}

fn fetch_artwork_inner(url: &str) -> Option<String> {
    let response = reqwest::blocking::get(url).ok()?;
    if !response.status().is_success() {
        return None;
    }

    // Capture content-type before consuming response with .bytes().
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(';').next())
        .map(|s| s.trim().to_string())
        .filter(|s| s.starts_with("image/"))
        .unwrap_or_else(|| "image/jpeg".to_string());

    let bytes = response.bytes().ok()?;
    if bytes.is_empty() {
        return None;
    }

    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{};base64,{}", mime, encoded))
}

#[cfg(target_os = "macos")]
pub fn fetch_playback() -> Option<SpotifyState> {
    let script = r#"
        if application "Spotify" is running then
            tell application "Spotify"
                set t to name of current track
                set a to artist of current track
                set al to album of current track
                set d to (duration of current track) as string
                set p to (player position) as string
                set s to (player state) as string
                set aw to artwork url of current track
                return t & linefeed & a & linefeed & al & linefeed & d & linefeed & p & linefeed & s & linefeed & aw
            end tell
        end if
    "#;

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()?;

    let text = String::from_utf8_lossy(&output.stdout);
    let text = text.trim();

    // Split at 6 lines for parse_output; 7th line is the artwork URL.
    let all_lines: Vec<&str> = text.lines().collect();
    if all_lines.len() < 6 {
        return None;
    }
    let six_line_text = all_lines[..6].join("\n");
    let artwork_url = all_lines
        .get(6)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && s.starts_with("http"));

    let mut state = parse_output(&six_line_text)?;
    state.artwork_data = artwork_url.and_then(fetch_artwork);
    Some(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_playing_track() {
        let raw = "夜に駆ける\nYOASOBI\nThe Book\n234000\n47.382\nplaying\n";
        let state = parse_output(raw).expect("should parse");
        assert_eq!(state.track, "夜に駆ける");
        assert_eq!(state.artist, "YOASOBI");
        assert_eq!(state.album, "The Book");
        assert_eq!(state.duration_ms, 234000);
        assert_eq!(state.position_ms, 47382);
        assert_eq!(state.state, "playing");
    }

    #[test]
    fn parses_paused_track() {
        let raw = "Some Song\nSome Artist\nSome Album\n180000\n90.0\npaused\n";
        let state = parse_output(raw).expect("should parse");
        assert_eq!(state.state, "paused");
    }

    #[test]
    fn empty_output_is_none() {
        assert!(parse_output("").is_none());
        assert!(parse_output("   \n  ").is_none());
    }
}
