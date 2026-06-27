mod spotify;

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_store::StoreExt;
use tauri_plugin_positioner::{Position, WindowExt};

// Last known "Title · Artist" string; None when nothing is playing.
// Written by the poll thread, read by toggle_window for immediate tray updates.
struct NowPlayingText(Mutex<Option<String>>);

// Truncates to at most max_chars Unicode scalar values, appending "…" if cut.
// Uses chars(), not bytes, so CJK/multibyte titles are safe.
fn truncate_for_tray(s: &str, max_chars: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max_chars {
        s.to_string()
    } else {
        chars[..max_chars.saturating_sub(1)].iter().collect::<String>() + "…"
    }
}

// Sets or clears the menu-bar title beside the tray icon.
// Panel visible or nothing playing → clear (icon only).
// Panel hidden and track known → show truncated "Title · Artist".
fn apply_tray_title<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    full_text: Option<&str>,
    window_visible: bool,
) {
    let Some(tray) = app.tray_by_id("main") else { return };
    if window_visible || full_text.is_none() {
        // None is a no-op in tray-icon's macOS impl; empty string actually clears the title.
        let _ = tray.set_title(Some(""));
    } else {
        let truncated = truncate_for_tray(full_text.unwrap(), 35);
        let _ = tray.set_title(Some(truncated));
    }
}

#[cfg(target_os = "macos")]
fn start_poll<R: tauri::Runtime>(app: tauri::AppHandle<R>, now_playing_item: MenuItem<R>) {
    std::thread::spawn(move || loop {
        let state = spotify::fetch_playback();

        // Guard against empty track (Spotify running but no track loaded → stray " · ").
        let full_text: Option<String> = state.as_ref()
            .filter(|s| !s.track.is_empty())
            .map(|s| format!("{} · {}", s.track, s.artist));

        // Update the dropdown display item (always shows full text).
        let _ = now_playing_item.set_text(full_text.as_deref().unwrap_or("—"));

        // Cache for toggle_window's immediate update.
        if let Ok(mut guard) = app.state::<NowPlayingText>().0.lock() {
            *guard = full_text.clone();
        }

        // Set or clear the menu-bar title based on current window visibility.
        let window_visible = app
            .get_webview_window("main")
            .map(|w| w.is_visible().unwrap_or(false))
            .unwrap_or(false);
        apply_tray_title(&app, full_text.as_deref(), window_visible);

        app.emit("playback", state).ok();
        std::thread::sleep(std::time::Duration::from_secs(1));
    });
}

#[tauri::command]
fn get_playback() -> Option<spotify::SpotifyState> {
    #[cfg(target_os = "macos")]
    return spotify::fetch_playback();
    #[cfg(not(target_os = "macos"))]
    None
}

// Single source of truth for window bounds (logical pixels). Matches tauri.conf.json.
const MAX_WIDTH: u32 = 360;
const MAX_HEIGHT: u32 = 560;
const MIN_WIDTH: u32 = 280;
const MIN_HEIGHT: u32 = 275;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(
                    "sqlite:lyrics.db",
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "create_cached_lyrics",
                        sql: "CREATE TABLE IF NOT EXISTS cached_lyrics \
                              (key TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL)",
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .setup(|app| {
            app.manage(NowPlayingText(Mutex::new(None)));

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Read saved theme to set the initial checkmark state.
            let saved_theme = app
                .store("settings.json")
                .ok()
                .and_then(|s| s.get("theme"))
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "minimal".to_string());
            let is_immersive = saved_theme == "immersive";

            let theme_minimal = CheckMenuItem::with_id(
                app, "theme_minimal", "Minimal", true, !is_immersive, None::<&str>,
            )?;
            let theme_immersive = CheckMenuItem::with_id(
                app, "theme_immersive", "Immersive", true, is_immersive, None::<&str>,
            )?;
            let theme_menu = Submenu::with_items(
                app, "Theme", true, &[&theme_minimal, &theme_immersive],
            )?;

            // Disabled display item at the top of the dropdown; text updated by the poll.
            let now_playing =
                MenuItem::with_id(app, "now_playing", "—", false, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let show_hide =
                MenuItem::with_id(app, "show_hide", "Show/Hide", true, None::<&str>)?;
            // "Settings" is pre-existing dead code — disabled placeholder, not yet built.
            let settings =
                MenuItem::with_id(app, "settings", "Settings", false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&now_playing, &separator, &show_hide, &theme_menu, &settings, &quit],
            )?;

            // Clone items into the closure — Arc clones share the live menu item state.
            let minimal_ref = theme_minimal.clone();
            let immersive_ref = theme_immersive.clone();

            TrayIconBuilder::with_id("main")
                .icon(circle_icon(22))
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show_hide" => toggle_window(app),
                    "theme_minimal" => {
                        let _ = minimal_ref.set_checked(true);
                        let _ = immersive_ref.set_checked(false);
                        app.emit("set-theme", "minimal").ok();
                    }
                    "theme_immersive" => {
                        let _ = minimal_ref.set_checked(false);
                        let _ = immersive_ref.set_checked(true);
                        app.emit("set-theme", "immersive").ok();
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Required so positioner knows where the tray icon lives (for TrayCenter).
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            #[cfg(target_os = "macos")]
            if let Some(win) = app.get_webview_window("main") {
                apply_vibrancy(&win, NSVisualEffectMaterial::HudWindow, None, Some(14.0))
                    .expect("failed to apply vibrancy");
            }

            // Clamp the window-state-restored size to [min, max] in logical pixels.
            // macOS can double the saved size across relaunches (physical/logical confusion);
            // one clamped cycle corrects the on-disk value on next close.
            if let Some(win) = app.get_webview_window("main") {
                if let (Ok(size), Ok(sf)) = (win.inner_size(), win.scale_factor()) {
                    let lw = (size.width as f64 / sf).round() as u32;
                    let lh = (size.height as f64 / sf).round() as u32;
                    let cw = lw.clamp(MIN_WIDTH, MAX_WIDTH);
                    let ch = lh.clamp(MIN_HEIGHT, MAX_HEIGHT);
                    if cw != lw || ch != lh {
                        let _ = win.set_size(tauri::LogicalSize::new(cw, ch));
                    }
                }
            }

            #[cfg(target_os = "macos")]
            start_poll(app.handle().clone(), now_playing.clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_playback])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn circle_icon(size: u32) -> tauri::image::Image<'static> {
    let cx = (size as f32 - 1.0) / 2.0;
    let cy = (size as f32 - 1.0) / 2.0;
    let r = size as f32 / 2.0 - 2.5;
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - cx;
            let dy = y as f32 - cy;
            let alpha = if dx * dx + dy * dy <= r * r { 255 } else { 0 };
            rgba.extend_from_slice(&[0, 0, 0, alpha]);
        }
    }
    tauri::image::Image::new_owned(rgba, size, size)
}

fn toggle_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let will_be_visible = if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        false
    } else {
        // On first-ever launch there is no saved state file, so snap near the tray.
        // On subsequent launches window-state has already restored the saved position
        // during setup — do NOT override it here.
        let has_saved_position = app
            .path()
            .app_data_dir()
            .map(|d| d.join(".window-state.json").exists())
            .unwrap_or(true);
        if !has_saved_position {
            let _ = window.move_window(Position::TrayCenter);
        }
        let _ = window.show();
        let _ = window.set_focus();
        true
    };

    // Immediate tray update — don't wait up to 1s for the next poll tick.
    let full_text = app
        .state::<NowPlayingText>()
        .0
        .lock()
        .ok()
        .and_then(|g| g.clone());
    apply_tray_title(app, full_text.as_deref(), will_be_visible);
}

#[cfg(test)]
mod tests {
    use super::truncate_for_tray;

    #[test]
    fn short_string_unchanged() {
        assert_eq!(truncate_for_tray("Hello · World", 35), "Hello · World");
    }

    #[test]
    fn exactly_at_limit_unchanged() {
        let s = "a".repeat(35);
        assert_eq!(truncate_for_tray(&s, 35), s);
    }

    #[test]
    fn long_ascii_truncated() {
        let s = "a".repeat(36);
        let result = truncate_for_tray(&s, 35);
        assert_eq!(result.chars().count(), 35);
        assert!(result.ends_with('…'));
    }

    #[test]
    fn cjk_truncated_safely() {
        // Each CJK char is 3 bytes — byte slicing would panic; char slicing is safe.
        // String is 40 chars, so truncation must fire.
        let s = "夜に駆ける · YOASOBI · これは非常に長いタイトルです！！！！！";
        assert!(s.chars().count() > 35, "test string must exceed limit");
        let result = truncate_for_tray(s, 35);
        assert!(result.chars().count() <= 35);
        assert!(result.ends_with('…'));
    }

    #[test]
    fn empty_string_unchanged() {
        assert_eq!(truncate_for_tray("", 35), "");
    }
}
