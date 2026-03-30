#[derive(Debug, Default)]
pub struct AppContext {
    pub app_name: Option<String>,
    pub window_title: Option<String>,
}

pub fn get_active_context() -> AppContext {
    #[cfg(target_os = "linux")]
    return get_context_linux();

    #[cfg(target_os = "windows")]
    return get_context_windows();

    #[allow(unreachable_code)]
    AppContext::default()
}

#[cfg(target_os = "linux")]
fn get_context_linux() -> AppContext {
    use std::process::Command;

    // Get the active window ID via xdotool (best-effort, may not be installed)
    let window_id = Command::new("xdotool")
        .arg("getactivewindow")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let Some(wid) = window_id else {
        return AppContext::default();
    };

    let window_title = Command::new("xdotool")
        .args(["getwindowname", &wid])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Get PID → read process name from /proc
    let app_name = Command::new("xdotool")
        .args(["getwindowpid", &wid])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .and_then(|pid| std::fs::read_to_string(format!("/proc/{}/comm", pid)).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    AppContext {
        app_name,
        window_title,
    }
}

#[cfg(target_os = "windows")]
fn get_context_windows() -> AppContext {
    // TODO: implement via GetForegroundWindow + GetWindowText + GetWindowModuleFileName
    AppContext::default()
}

