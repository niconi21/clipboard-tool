use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_LOG_BYTES: u64 = 1_000_000; // 1 MB — rotate on startup if exceeded

// ── Core writer ───────────────────────────────────────────────────────────────

/// Thread-safe JSON-lines file writer with single-backup rotation on open.
/// If the file cannot be opened, all writes are silently dropped.
#[derive(Clone)]
struct JsonLineLog(Arc<Mutex<Option<File>>>);

impl JsonLineLog {
    fn open(log_path: PathBuf) -> Self {
        if std::fs::metadata(&log_path)
            .map(|m| m.len())
            .unwrap_or(0)
            > MAX_LOG_BYTES
        {
            let mut backup = log_path.clone().into_os_string();
            backup.push(".1");
            let _ = std::fs::rename(&log_path, PathBuf::from(backup));
        }

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| eprintln!("[log] cannot open {}: {e}", log_path.display()))
            .ok();

        Self(Arc::new(Mutex::new(file)))
    }

    fn write(&self, entry: serde_json::Value) {
        let mut line = entry.to_string();
        line.push('\n');
        if let Ok(mut guard) = self.0.lock() {
            if let Some(ref mut file) = *guard {
                let _ = file.write_all(line.as_bytes());
            }
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn merge_extra(entry: &mut serde_json::Value, extra: &serde_json::Value) {
    if let (Some(obj), Some(extra_obj)) = (entry.as_object_mut(), extra.as_object()) {
        for (k, v) in extra_obj {
            obj.insert(k.clone(), v.clone());
        }
    }
}

// ── Security audit log ────────────────────────────────────────────────────────

/// Security-relevant event log: mutations, blocked actions, validation failures.
/// Never logs clipboard content or submitted values.
/// Writes to `<app_data>/security.log`.
#[derive(Clone)]
pub struct AuditLog(JsonLineLog);

impl AuditLog {
    pub fn open(log_path: PathBuf) -> Self {
        Self(JsonLineLog::open(log_path))
    }

    /// Log a security event. `extra` must be a JSON object — never pass user content.
    pub fn log(&self, event: &str, extra: serde_json::Value) {
        let mut entry = serde_json::json!({ "ts": now_secs(), "event": event });
        merge_extra(&mut entry, &extra);
        self.0.write(entry);
    }
}

// ── Operational application log ───────────────────────────────────────────────

/// Operational log for errors, warnings, and lifecycle events.
/// Captures background errors (watcher, dedup, cleanup) that go to stderr and are
/// invisible when the app runs headlessly via autostart or the system tray.
/// Writes to `<app_data>/app.log`.
#[derive(Clone)]
pub struct AppLog(JsonLineLog);

impl AppLog {
    pub fn open(log_path: PathBuf) -> Self {
        Self(JsonLineLog::open(log_path))
    }

    pub fn error(&self, src: &str, msg: &str) {
        self.write_entry("error", src, msg);
    }

    pub fn warn(&self, src: &str, msg: &str) {
        self.write_entry("warn", src, msg);
    }

    pub fn info(&self, src: &str, msg: &str) {
        self.write_entry("info", src, msg);
    }

    fn write_entry(&self, level: &str, src: &str, msg: &str) {
        self.0.write(serde_json::json!({
            "ts":    now_secs(),
            "level": level,
            "src":   src,
            "msg":   msg,
        }));
    }
}
