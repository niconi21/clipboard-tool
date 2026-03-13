mod audit;
mod categorizer;
mod clipboard;
mod commands;
mod context;
mod db;
mod window_state;

use audit::{AppLog, AuditLog};
use db::DbState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use window_state::WindowSaveState;

pub struct TrayMenuState(pub MenuItem<tauri::Wry>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--minimized"])
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            let pool = tauri::async_runtime::block_on(db::init_pool(app.handle()))?;
            let rules_cache =
                tauri::async_runtime::block_on(categorizer::RulesCache::new(&pool));

            let data_dir = app.path().app_data_dir()?;
            let audit_log = AuditLog::open(data_dir.join("security.log"));
            let app_log = AppLog::open(data_dir.join("app.log"));
            audit_log.log("app_started", serde_json::json!({}));
            app_log.info("startup", "app started");

            // Run retention cleanup on startup (silently ignore errors)
            let _ = tauri::async_runtime::block_on(db::cleanup_entries(&pool));

            // Apply saved window position/size (or center on primary monitor if first run)
            tauri::async_runtime::block_on(window_state::apply_saved_state(&pool, app.handle()));

            app.manage(DbState(pool));
            app.manage(rules_cache);
            app.manage(audit_log);
            app.manage(app_log);
            app.manage(clipboard::AppCopiedContent::new());

            // Window save state: tracks pending position/size changes, flushes to DB
            let win_save = WindowSaveState::new();
            win_save.start_flush_task(app.handle().clone());
            app.manage(win_save);

            clipboard::start_watcher(app.handle().clone());

            // Issue #2: periodic dedup task
            let dedup_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let pool = &dedup_handle.state::<DbState>().0;
                    let log = dedup_handle.state::<AppLog>();
                    let interval_mins: u64 = db::get_setting(pool, "dedup_interval_minutes")
                        .await
                        .ok()
                        .flatten()
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0);

                    if interval_mins > 0 {
                        match db::dedup_entries(pool).await {
                            Ok(n) if n > 0 => log.info("dedup", &format!("removed {n} duplicate entries")),
                            Ok(_) => {}
                            Err(e) => log.error("dedup", &format!("dedup failed: {e}")),
                        }
                    }

                    let wait = if interval_mins > 0 { interval_mins } else { 5 };
                    tokio::time::sleep(std::time::Duration::from_secs(wait * 60)).await;
                }
            });

            let toggle_i = MenuItem::with_id(app, "toggle", "Open", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_i, &quit_i])?;

            app.manage(TrayMenuState(toggle_i));

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip(if cfg!(debug_assertions) { "Clipboard Tool [dev]" } else { "Clipboard Tool" })
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
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

            if let Some(window) = app.get_webview_window("main") {
                window.hide()?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_entries,
            commands::delete_entry,
            commands::toggle_favorite,
            commands::get_entry_counts,
            commands::get_apps,
            commands::get_context_rules,
            commands::get_content_rules,
            commands::get_settings,
            commands::update_setting,
            commands::get_themes,
            commands::set_active_theme,
            commands::get_content_types,
            commands::update_content_type_color,
            commands::copy_to_clipboard,
            commands::write_clipboard_raw,
            commands::get_categories,
            commands::get_all_categories,
            commands::get_window_titles,
            commands::get_collections,
            commands::create_collection,
            commands::update_collection,
            commands::delete_collection,
            commands::get_entry_collection_ids,
            commands::set_entry_collections,
            commands::get_collection_counts,
            commands::create_content_type,
            commands::delete_content_type,
            commands::create_category,
            commands::update_category,
            commands::delete_category,
            commands::get_all_context_rules,
            commands::create_context_rule,
            commands::delete_context_rule,
            commands::get_all_content_type_rules,
            commands::create_content_type_rule,
            commands::delete_content_type_rule,
            commands::set_context_rule_enabled,
            commands::set_content_type_rule_enabled,
            commands::log_security_event,
            commands::get_languages,
            commands::bootstrap,
            commands::hide_window,
        ])
        .on_window_event(|window, event| {
            let app = window.app_handle();
            match event {
                tauri::WindowEvent::Moved(pos) => {
                    // Only track when the user actually has the window visible
                    if !window.is_visible().unwrap_or(false) {
                        return;
                    }
                    if let (Ok(size), Some(state)) = (
                        window.outer_size(),
                        app.try_state::<WindowSaveState>(),
                    ) {
                        state.update(pos.x, pos.y, size.width, size.height);
                    }
                }
                tauri::WindowEvent::Resized(size) => {
                    // Ignore zero-size events (minimized / hidden state changes)
                    if size.width < 100 || size.height < 100 {
                        return;
                    }
                    if !window.is_visible().unwrap_or(false) {
                        return;
                    }
                    if let (Ok(pos), Some(state)) = (
                        window.outer_position(),
                        app.try_state::<WindowSaveState>(),
                    ) {
                        state.update(pos.x, pos.y, size.width, size.height);
                    }
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.set_skip_taskbar(true);
                    let _ = window.hide();
                    if let Some(state) = app.try_state::<TrayMenuState>() {
                        let _ = state.0.set_text("Open");
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);

        if visible {
            let _ = window.set_skip_taskbar(true);
            let _ = window.hide();
            if let Some(state) = app.try_state::<TrayMenuState>() {
                let _ = state.0.set_text("Open");
            }
        } else {
            // No center() here — window appears at its last saved position.
            // On first launch, apply_saved_state() already centered it.
            let _ = window.set_skip_taskbar(false);
            let _ = window.show();
            let _ = window.set_focus();
            if let Some(state) = app.try_state::<WindowSaveState>() {
                state.mark_ready();
            }
            if let Some(state) = app.try_state::<TrayMenuState>() {
                let _ = state.0.set_text("Close");
            }
            let w = window.clone();
            std::thread::spawn(move || {
                let _ = w.set_always_on_top(true);
                std::thread::sleep(std::time::Duration::from_millis(100));
                let _ = w.set_always_on_top(false);
            });
        }
    }
}
