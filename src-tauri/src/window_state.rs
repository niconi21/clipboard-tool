use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size};

// ── Pending state (written on every move/resize, flushed to DB after idle) ────

struct PendingPos {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone)]
pub struct WindowSaveState {
    pending: Arc<Mutex<Option<PendingPos>>>,
    /// Only track events after the user has explicitly shown the window at
    /// least once.  This prevents startup resize events (fired by Tauri /
    /// the X11 compositor while the window is still being initialised from
    /// overwriting the saved size in the DB with the default config values.
    ready: Arc<AtomicBool>,
}

impl WindowSaveState {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(None)),
            ready: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Call this once the user has opened the window for the first time so
    /// that subsequent move/resize events are tracked.
    pub fn mark_ready(&self) {
        self.ready.store(true, Ordering::Relaxed);
    }

    /// Called from on_window_event on every Moved / Resized event.
    pub fn update(&self, x: i32, y: i32, width: u32, height: u32) {
        if !self.ready.load(Ordering::Relaxed) {
            return;
        }
        if let Ok(mut lock) = self.pending.lock() {
            *lock = Some(PendingPos { x, y, width, height });
        }
    }

    /// Starts a background task that flushes to DB ~600 ms after the last change.
    /// Must be called after DbState is already managed on the app.
    pub fn start_flush_task(&self, app: AppHandle) {
        let pending = self.pending.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(600)).await;

                let state = pending.lock().ok().and_then(|mut l| l.take());
                let Some(pos) = state else { continue };

                let Some(db) = app.try_state::<crate::db::DbState>() else { continue };
                let pool = &db.0;

                let _ = crate::db::update_setting(pool, "window_x", &pos.x.to_string()).await;
                let _ = crate::db::update_setting(pool, "window_y", &pos.y.to_string()).await;
                let _ = crate::db::update_setting(pool, "window_width", &pos.width.to_string()).await;
                let _ = crate::db::update_setting(pool, "window_height", &pos.height.to_string()).await;
            }
        });
    }
}

// ── Startup: apply saved position/size or center on primary monitor ───────────

pub async fn apply_saved_state(pool: &SqlitePool, app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };

    let read = |key: &'static str| async move {
        crate::db::get_setting(pool, key)
            .await
            .ok()
            .flatten()
    };

    let saved_x = read("window_x").await.and_then(|v| v.parse::<i32>().ok());
    let saved_y = read("window_y").await.and_then(|v| v.parse::<i32>().ok());
    let saved_w = read("window_width").await.and_then(|v| v.parse::<u32>().ok());
    let saved_h = read("window_height").await.and_then(|v| v.parse::<u32>().ok());

    let width = saved_w.unwrap_or(720);
    let height = saved_h.unwrap_or(520);

    let _ = window.set_size(Size::Physical(PhysicalSize { width, height }));

    if let (Some(x), Some(y)) = (saved_x, saved_y) {
        let _ = window.set_position(Position::Physical(PhysicalPosition { x, y }));
    } else {
        center_on_primary(app, &window, width, height);
    }
}

fn center_on_primary(app: &AppHandle, window: &tauri::WebviewWindow, width: u32, height: u32) {
    let monitor = app.primary_monitor().ok().flatten();
    if let Some(m) = monitor {
        let mpos = m.position();
        let msize = m.size();
        let x = mpos.x + (msize.width as i32 - width as i32) / 2;
        let y = mpos.y + (msize.height as i32 - height as i32) / 2;
        let _ = window.set_position(Position::Physical(PhysicalPosition { x, y }));
    } else {
        let _ = window.center();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_before_mark_ready_is_noop() {
        let state = WindowSaveState::new();
        state.update(100, 200, 800, 600);
        let pending = state.pending.lock().unwrap();
        assert!(pending.is_none(), "update before mark_ready should not store anything");
    }

    #[test]
    fn update_after_mark_ready_stores_values() {
        let state = WindowSaveState::new();
        state.mark_ready();
        state.update(100, 200, 800, 600);
        let pending = state.pending.lock().unwrap();
        assert!(pending.is_some());
        let pos = pending.as_ref().unwrap();
        assert_eq!(pos.x, 100);
        assert_eq!(pos.y, 200);
        assert_eq!(pos.width, 800);
        assert_eq!(pos.height, 600);
    }

    #[test]
    fn update_overrides_previous() {
        let state = WindowSaveState::new();
        state.mark_ready();
        state.update(10, 20, 400, 300);
        state.update(50, 60, 1280, 720);
        let pending = state.pending.lock().unwrap();
        let pos = pending.as_ref().unwrap();
        assert_eq!(pos.x, 50);
        assert_eq!(pos.y, 60);
        assert_eq!(pos.width, 1280);
        assert_eq!(pos.height, 720);
    }

    #[test]
    fn mark_ready_idempotent() {
        let state = WindowSaveState::new();
        state.mark_ready();
        state.mark_ready(); // second call must not panic
        assert!(state.ready.load(std::sync::atomic::Ordering::Relaxed));
    }
}
