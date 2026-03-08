use std::sync::{Arc, Mutex};
use std::time::Duration;

use arboard::Clipboard;
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    audit::{AppLog, AuditLog},
    categorizer::RulesCache,
    context::get_active_context,
    db::{save_entry, DbState},
};

/// Content most recently copied *from* the app UI.
/// The watcher checks this and skips saving it to avoid duplicate entries.
#[derive(Clone)]
pub struct AppCopiedContent(pub Arc<Mutex<Option<String>>>);

impl AppCopiedContent {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}

/// Clipboard entries larger than this are silently dropped.
const MAX_CLIPBOARD_BYTES: usize = 10 * 1024 * 1024; // 10 MB

pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut clipboard = match Clipboard::new() {
            Ok(cb) => cb,
            Err(e) => {
                if let Some(log) = app.try_state::<AppLog>() {
                    log.error("watcher", &format!("clipboard init failed: {e}"));
                }
                return;
            }
        };

        let initial = clipboard.get_text().unwrap_or_default();
        let mut last_content = initial;

        loop {
            std::thread::sleep(Duration::from_millis(500));

            let current = match clipboard.get_text() {
                Ok(text) if !text.is_empty() => text,
                _ => continue,
            };

            if current == last_content {
                continue;
            }

            if current.len() > MAX_CLIPBOARD_BYTES {
                let bytes = current.len();
                if let Some(audit) = app.try_state::<AuditLog>() {
                    audit.log(
                        "entry_oversized",
                        serde_json::json!({ "bytes": bytes, "limit": MAX_CLIPBOARD_BYTES }),
                    );
                }
                if let Some(log) = app.try_state::<AppLog>() {
                    log.warn("watcher", &format!("entry dropped: {bytes} bytes exceeds {MAX_CLIPBOARD_BYTES} limit"));
                }
                last_content = current; // still update so we don't re-log every poll
                continue;
            }

            last_content = current.clone();

            // Skip content that was copied from the app itself
            if let Some(state) = app.try_state::<AppCopiedContent>() {
                let mut app_copied = state.0.lock().unwrap();
                if app_copied.as_deref() == Some(current.as_str()) {
                    *app_copied = None; // consume the mark (one-shot)
                    continue;
                }
            }

            let ctx = get_active_context();
            let app_clone = app.clone();

            tauri::async_runtime::spawn(async move {
                let pool = &app_clone.state::<DbState>().0;

                // Issue #1: skip if identical to the most recently saved entry
                match crate::db::last_entry_content(pool).await {
                    Ok(Some(last)) if last == current => return,
                    _ => {}
                }

                let cache = app_clone.state::<RulesCache>();

                let result = cache.classify(
                    &current,
                    ctx.app_name.as_deref(),
                    ctx.window_title.as_deref(),
                );

                match save_entry(
                    pool,
                    current,
                    &result.content_type,
                    result.category_id,
                    ctx.app_name,
                    ctx.window_title,
                )
                .await
                {
                    Ok(entry) => {
                        let _ = app_clone.emit("clipboard-new-entry", &entry);
                        if let Err(e) = crate::db::cleanup_entries(pool).await {
                            if let Some(log) = app_clone.try_state::<AppLog>() {
                                log.warn("watcher", &format!("cleanup failed: {e}"));
                            }
                        }
                    }
                    Err(e) => {
                        if let Some(log) = app_clone.try_state::<AppLog>() {
                            log.error("watcher", &format!("save entry failed: {e}"));
                        }
                    }
                }
            });
        }
    });
}
