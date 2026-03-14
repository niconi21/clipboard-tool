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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use tempfile::NamedTempFile;

    fn read_lines(path: &std::path::Path) -> Vec<serde_json::Value> {
        let mut file = std::fs::File::open(path).expect("open file");
        let mut contents = String::new();
        file.read_to_string(&mut contents).expect("read file");
        contents
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::from_str(l).expect("parse json line"))
            .collect()
    }

    #[test]
    fn audit_log_writes_json_line() {
        let tmp = NamedTempFile::new().unwrap();
        let log = AuditLog::open(tmp.path().to_path_buf());
        log.log("test_event", serde_json::json!({ "key": "value" }));
        // Drop the log to flush writes
        drop(log);

        let lines = read_lines(tmp.path());
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["event"], "test_event");
        assert_eq!(lines[0]["key"], "value");
        assert!(lines[0]["ts"].is_number());
    }

    #[test]
    fn app_log_writes_error() {
        let tmp = NamedTempFile::new().unwrap();
        let log = AppLog::open(tmp.path().to_path_buf());
        log.error("test_src", "something went wrong");
        drop(log);

        let lines = read_lines(tmp.path());
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["level"], "error");
        assert_eq!(lines[0]["src"], "test_src");
        assert_eq!(lines[0]["msg"], "something went wrong");
    }

    #[test]
    fn app_log_warn() {
        let tmp = NamedTempFile::new().unwrap();
        let log = AppLog::open(tmp.path().to_path_buf());
        log.warn("watcher", "slow poll");
        drop(log);

        let lines = read_lines(tmp.path());
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["level"], "warn");
    }

    #[test]
    fn app_log_info() {
        let tmp = NamedTempFile::new().unwrap();
        let log = AppLog::open(tmp.path().to_path_buf());
        log.info("startup", "app started");
        drop(log);

        let lines = read_lines(tmp.path());
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["level"], "info");
    }

    #[test]
    fn audit_log_rotation() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();

        // Write more than 1 MB to the file so rotation triggers
        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .unwrap();
            let chunk = b"x".repeat(1_100_000);
            f.write_all(&chunk).unwrap();
        }

        // Opening AuditLog should trigger rotation because file > MAX_LOG_BYTES
        let _log = AuditLog::open(path.clone());

        let mut backup = path.clone().into_os_string();
        backup.push(".1");
        let backup_path = std::path::PathBuf::from(backup);
        assert!(backup_path.exists(), "backup file .1 should exist after rotation");
    }
}
