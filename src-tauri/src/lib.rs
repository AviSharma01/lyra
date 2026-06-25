mod spotify;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_positioner::{Position, WindowExt};

#[cfg(target_os = "macos")]
fn start_poll<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    std::thread::spawn(move || loop {
        let state = spotify::fetch_playback();
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
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            #[cfg(target_os = "macos")]
            start_poll(app.handle().clone());

            let show_hide =
                MenuItem::with_id(app, "show_hide", "Show/Hide", true, None::<&str>)?;
            let settings =
                MenuItem::with_id(app, "settings", "Settings", false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_hide, &settings, &quit])?;

            TrayIconBuilder::new()
                .icon(circle_icon(22))
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_hide" => toggle_window(app),
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
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
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
    }
}
