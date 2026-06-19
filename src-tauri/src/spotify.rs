#[derive(Debug, serde::Serialize)]
pub struct SpotifyState {
    pub track: String,
    pub artist: String,
    pub duration_ms: u64,
    pub position_ms: u64,
    pub is_playing: bool,
}

pub fn parse_output(output: &str) -> Option<SpotifyState> {
    let output = output.trim();
    if output.is_empty() {
        return None;
    }
    let mut lines = output.lines();
    let track = lines.next()?.to_string();
    let artist = lines.next()?.to_string();
    let duration_ms: u64 = lines.next()?.trim().parse().ok()?;
    let position_secs: f64 = lines.next()?.trim().parse().ok()?;
    let position_ms = (position_secs * 1000.0) as u64;
    let state = lines.next()?.trim();
    let is_playing = state == "playing";
    Some(SpotifyState { track, artist, duration_ms, position_ms, is_playing })
}

#[cfg(target_os = "macos")]
pub fn fetch_playback() -> Option<SpotifyState> {
    let script = r#"
        if application "Spotify" is running then
            tell application "Spotify"
                set t to name of current track
                set a to artist of current track
                set d to (duration of current track) as string
                set p to (player position) as string
                set s to (player state) as string
                return t & linefeed & a & linefeed & d & linefeed & p & linefeed & s
            end tell
        end if
    "#;

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()?;

    parse_output(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_playing_track() {
        let raw = "夜に駆ける\nYOASOBI\n234000\n47.382\nplaying\n";
        let state = parse_output(raw).expect("should parse");
        assert_eq!(state.track, "夜に駆ける");
        assert_eq!(state.artist, "YOASOBI");
        assert_eq!(state.duration_ms, 234000);
        assert_eq!(state.position_ms, 47382);
        assert!(state.is_playing);
    }

    #[test]
    fn parses_paused_track() {
        let raw = "Some Song\nSome Artist\n180000\n90.0\npaused\n";
        let state = parse_output(raw).expect("should parse");
        assert!(!state.is_playing);
    }

    #[test]
    fn empty_output_is_none() {
        assert!(parse_output("").is_none());
        assert!(parse_output("   \n  ").is_none());
    }
}
