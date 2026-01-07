use log::info;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id("show", "Show Comine").build(app)?;
    let download = MenuItemBuilder::with_id("download", "Download from clipboard").build(app)?;
    let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&download)
        .item(&separator)
        .item(&quit)
        .build()?;

    #[cfg(target_os = "windows")]
    let icon = Image::from_path("icons/icon.ico")
        .or_else(|_| Image::from_path("icons/32x32.png"))
        .unwrap_or_else(|_| {
            Image::from_bytes(include_bytes!("../icons/icon.ico"))
                .expect("Failed to load embedded icon")
        });

    #[cfg(not(target_os = "windows"))]
    let icon = Image::from_path("icons/icon.png")
        .or_else(|_| Image::from_path("icons/32x32.png"))
        .unwrap_or_else(|_| {
            Image::from_bytes(include_bytes!("../icons/32x32.png"))
                .expect("Failed to load embedded icon")
        });

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Comine")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("window-shown", ());
                }
            }
            "download" => {
                let _ = app.emit("tray-download-clipboard", ());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("window-shown", ());
                }
            }
        })
        .build(app)?;

    info!("System tray initialized");
    Ok(())
}
