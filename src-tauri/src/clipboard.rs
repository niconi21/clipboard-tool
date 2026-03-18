use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use arboard::Clipboard;
use sha2::{Digest, Sha256};
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

/// SHA256 hash of the most recently copied image from the app UI.
/// The watcher checks this and skips saving it to avoid duplicate entries.
#[derive(Clone)]
pub struct AppCopiedImageHash(pub Arc<Mutex<Option<String>>>);

impl AppCopiedImageHash {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}

/// Clipboard monitoring pause state.
#[derive(Debug)]
pub enum PauseState {
    Active,
    Indefinite,
    Until(Instant),
}

pub struct ClipboardPause(pub Arc<Mutex<PauseState>>);

impl ClipboardPause {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(PauseState::Active)))
    }
}

/// Returns `true` if the watcher should skip this tick (paused).
/// Handles auto-resume when a timed pause expires.
fn check_pause(app: &AppHandle) -> bool {
    let Some(pause) = app.try_state::<ClipboardPause>() else {
        return false;
    };
    let mut guard = pause.0.lock().unwrap();
    match &*guard {
        PauseState::Active => false,
        PauseState::Indefinite => true,
        PauseState::Until(until) => {
            if Instant::now() < *until {
                true
            } else {
                *guard = PauseState::Active;
                drop(guard);
                let _ = app.emit("clipboard-resumed", ());
                if let Some(tray) = app.try_state::<crate::TrayMenuState>() {
                    tray.set_paused(false);
                }
                let body = tauri::async_runtime::block_on(async {
                    if let Some(db) = app.try_state::<crate::db::DbState>() {
                        let lang = crate::db::get_setting(&db.0, "language")
                            .await.ok().flatten().unwrap_or_else(|| "en".to_string());
                        match lang.as_str() {
                            "es-MX" => "Monitoreo de portapapeles reanudado",
                            _ => "Clipboard monitoring resumed",
                        }.to_string()
                    } else {
                        "Clipboard monitoring resumed".to_string()
                    }
                });
                crate::notify(app, &body);
                false
            }
        }
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
        let mut last_image_hash: Option<String> = None;

        // Read max image size setting once before the loop
        let max_image_bytes: usize = tauri::async_runtime::block_on(async {
            let pool = &app.state::<DbState>().0;
            crate::db::get_setting(pool, "max_image_size_bytes")
                .await
                .ok()
                .flatten()
                .and_then(|v| v.parse().ok())
                .unwrap_or(36_700_160)
        });

        loop {
            let visible = app
                .get_webview_window("main")
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false);
            let poll_ms = if visible { 500 } else { 2000 };
            std::thread::sleep(Duration::from_millis(poll_ms));

            // ── Pause check — skip clipboard poll when paused ───────────
            if check_pause(&app) {
                continue;
            }

            // ── Try text first ──────────────────────────────────────────
            let got_text = match clipboard.get_text() {
                Ok(text) if !text.is_empty() => {
                    if text == last_content {
                        true // text unchanged, skip but don't try image
                    } else if text.len() > MAX_CLIPBOARD_BYTES {
                        let bytes = text.len();
                        if let Some(audit) = app.try_state::<AuditLog>() {
                            audit.log(
                                "entry_oversized",
                                serde_json::json!({ "bytes": bytes, "limit": MAX_CLIPBOARD_BYTES }),
                            );
                        }
                        if let Some(log) = app.try_state::<AppLog>() {
                            log.warn("watcher", &format!("entry dropped: {bytes} bytes exceeds {MAX_CLIPBOARD_BYTES} limit"));
                        }
                        last_content = text;
                        true
                    } else {
                        last_content = text.clone();

                        // Skip content copied from app itself
                        let is_self_copy = if let Some(state) = app.try_state::<AppCopiedContent>() {
                            let mut app_copied = state.0.lock().unwrap();
                            if app_copied.as_deref() == Some(text.as_str()) {
                                *app_copied = None;
                                true
                            } else {
                                false
                            }
                        } else {
                            false
                        };

                        if !is_self_copy {
                            let ctx = get_active_context();
                            let app_clone = app.clone();
                            tauri::async_runtime::spawn(async move {
                                handle_text_entry(app_clone, text, ctx).await;
                            });
                        }
                        true
                    }
                }
                _ => false, // no text — fall through to image
            };

            if got_text {
                continue;
            }

            // ── Try image ───────────────────────────────────────────────
            let img_data = match clipboard.get_image() {
                Ok(img) => img,
                _ => continue, // neither text nor image
            };

            // Compute SHA256 of raw RGBA bytes
            let mut hasher = Sha256::new();
            hasher.update(&img_data.bytes);
            let hash_hex = format!("{:x}", hasher.finalize());

            // Skip if same image as last poll
            if last_image_hash.as_deref() == Some(hash_hex.as_str()) {
                continue;
            }
            last_image_hash = Some(hash_hex.clone());

            // Check raw size
            let raw_size = img_data.bytes.len();
            if max_image_bytes > 0 && raw_size > max_image_bytes {
                if let Some(log) = app.try_state::<AppLog>() {
                    log.warn("watcher", &format!("image dropped: {raw_size} raw bytes exceeds {max_image_bytes} limit"));
                }
                continue;
            }

            // Check self-copy prevention
            if let Some(state) = app.try_state::<AppCopiedImageHash>() {
                let mut app_hash = state.0.lock().unwrap();
                if app_hash.as_deref() == Some(hash_hex.as_str()) {
                    *app_hash = None;
                    continue;
                }
            }

            let ctx = get_active_context();
            let app_clone = app.clone();
            let width = img_data.width as u32;
            let height = img_data.height as u32;
            let rgba_bytes = img_data.bytes.into_owned();

            tauri::async_runtime::spawn(async move {
                handle_image_entry(app_clone, hash_hex, width, height, rgba_bytes, ctx).await;
            });
        }
    });
}

async fn handle_text_entry(
    app: AppHandle,
    current: String,
    ctx: crate::context::AppContext,
) {
    let pool = &app.state::<DbState>().0;

    // Skip if identical to the most recently saved entry
    match crate::db::last_entry_content(pool).await {
        Ok(Some(last)) if last == current => return,
        _ => {}
    }

    let cache = app.state::<RulesCache>();
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
        Ok(mut entry) => {
            // Auto-assign to collections based on collection_rules
            if !result.collection_ids.is_empty() {
                let mut assigned: Vec<String> = Vec::new();
                for cid in &result.collection_ids {
                    if let Ok(()) =
                        crate::db::add_entry_to_collection(pool, entry.id, *cid).await
                    {
                        assigned.push(cid.to_string());
                    }
                }
                if !assigned.is_empty() {
                    entry.collection_ids = assigned.join(",");
                }
            }

            let _ = app.emit("clipboard-new-entry", &entry);
            if let Err(e) = crate::db::cleanup_entries(pool).await {
                if let Some(log) = app.try_state::<AppLog>() {
                    log.warn("watcher", &format!("cleanup failed: {e}"));
                }
            }
        }
        Err(e) => {
            if let Some(log) = app.try_state::<AppLog>() {
                log.error("watcher", &format!("save entry failed: {e}"));
            }
        }
    }
}

async fn handle_image_entry(
    app: AppHandle,
    hash_hex: String,
    width: u32,
    height: u32,
    rgba_bytes: Vec<u8>,
    ctx: crate::context::AppContext,
) {
    let pool = &app.state::<DbState>().0;
    let filename = format!("images/{hash_hex}.png");

    // Dedup: skip if latest entry already references this path
    match crate::db::last_entry_content(pool).await {
        Ok(Some(last)) if last == filename => return,
        _ => {}
    }

    // Resolve data dir and write PNG
    let data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            if let Some(log) = app.try_state::<AppLog>() {
                log.error("watcher", &format!("app data dir error: {e}"));
            }
            return;
        }
    };
    let file_path = data_dir.join(&filename);

    // Only encode if file doesn't exist (same hash = same content)
    if !file_path.exists() {
        let img_buf = match image::RgbaImage::from_raw(width, height, rgba_bytes) {
            Some(buf) => buf,
            None => {
                if let Some(log) = app.try_state::<AppLog>() {
                    log.error("watcher", "image: failed to create RgbaImage from raw bytes");
                }
                return;
            }
        };
        if let Err(e) = img_buf.save(&file_path) {
            if let Some(log) = app.try_state::<AppLog>() {
                log.error("watcher", &format!("image: failed to save PNG: {e}"));
            }
            return;
        }

        // Generate thumbnail (max 120px height, preserve aspect ratio)
        let thumb_path = data_dir.join(format!("images/{hash_hex}_thumb.png"));
        if !thumb_path.exists() {
            let thumb = image::DynamicImage::from(img_buf).resize(
                u32::MAX,
                120,
                image::imageops::FilterType::Triangle,
            );
            if let Err(e) = thumb.save(&thumb_path) {
                if let Some(log) = app.try_state::<AppLog>() {
                    log.warn("watcher", &format!("image: failed to save thumbnail: {e}"));
                }
            }
        }
    }

    // Image entries skip content classification — always "image", no category
    match save_entry(pool, filename, "image", None, ctx.app_name, ctx.window_title).await {
        Ok(entry) => {
            let _ = app.emit("clipboard-new-entry", &entry);
            if let Err(e) = crate::db::cleanup_entries(pool).await {
                if let Some(log) = app.try_state::<AppLog>() {
                    log.warn("watcher", &format!("cleanup failed: {e}"));
                }
            }
            // Clean up orphaned image files after retention cleanup
            if let Err(e) = crate::db::cleanup_orphaned_images(&data_dir, pool).await {
                if let Some(log) = app.try_state::<AppLog>() {
                    log.warn("watcher", &format!("orphan cleanup failed: {e}"));
                }
            }
        }
        Err(e) => {
            if let Some(log) = app.try_state::<AppLog>() {
                log.error("watcher", &format!("save image entry failed: {e}"));
            }
        }
    }
}
