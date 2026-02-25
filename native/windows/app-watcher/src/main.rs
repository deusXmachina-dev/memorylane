use once_cell::sync::Lazy;
use serde::Serialize;
use std::ffi::OsString;
use std::io::{self, Write};
use std::os::windows::ffi::OsStringExt;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, RECT};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, TranslateMessage, EVENT_OBJECT_NAMECHANGE, EVENT_SYSTEM_FOREGROUND, MSG,
    WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

const CHILD_ID_SELF: i32 = 0;
const OBJ_ID_WINDOW: i32 = 0;

#[derive(Debug, Clone, Serialize)]
struct WindowBoundsPayload {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Debug, Clone)]
struct WindowSnapshot {
    hwnd: usize,
    pid: u32,
    app: String,
    title: String,
    window_bounds: WindowBoundsPayload,
}

#[derive(Default)]
struct LastWindowState {
    hwnd: usize,
    pid: u32,
    app: String,
    title: String,
}

static LAST_WINDOW_STATE: Lazy<Mutex<LastWindowState>> =
    Lazy::new(|| Mutex::new(LastWindowState::default()));

fn now_ms() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as u64,
        Err(_) => 0,
    }
}

fn emit_json_line(value: &serde_json::Value) {
    let mut stdout = io::stdout().lock();
    if serde_json::to_writer(&mut stdout, value).is_ok() {
        let _ = stdout.write_all(b"\n");
        let _ = stdout.flush();
    }
}

fn emit_error_event(error: &str) {
    emit_json_line(&serde_json::json!({
        "type": "error",
        "timestamp": now_ms(),
        "error": error,
    }));
}

fn hwnd_is_valid(hwnd: HWND) -> bool {
    !hwnd.0.is_null()
}

fn read_window_title(hwnd: HWND) -> String {
    let title_len = unsafe { GetWindowTextLengthW(hwnd) };
    if title_len <= 0 {
        return String::new();
    }

    let mut utf16 = vec![0u16; title_len as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut utf16) };
    if copied <= 0 {
        return String::new();
    }

    OsString::from_wide(&utf16[..copied as usize])
        .to_string_lossy()
        .to_string()
}

fn read_window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe {
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
    }
    pid
}

fn close_handle(handle: HANDLE) {
    if !handle.is_invalid() {
        unsafe {
            let _ = CloseHandle(handle);
        }
    }
}

fn read_process_name(pid: u32) -> String {
    if pid == 0 {
        return String::new();
    }

    let process_handle =
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).unwrap_or(HANDLE::default()) };
    if process_handle.is_invalid() {
        return String::new();
    }

    let mut buffer = vec![0u16; 4096];
    let mut size = buffer.len() as u32;
    let mut process_name = String::new();

    let ok = unsafe {
        QueryFullProcessImageNameW(
            process_handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        )
    };
    if ok.is_ok() && size > 0 {
        let process_path = OsString::from_wide(&buffer[..size as usize])
            .to_string_lossy()
            .to_string();
        process_name = Path::new(&process_path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("")
            .to_string();
    }

    close_handle(process_handle);
    process_name
}

fn read_window_bounds(hwnd: HWND) -> Option<WindowBoundsPayload> {
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return None;
    }

    let width = rect.right.saturating_sub(rect.left);
    let height = rect.bottom.saturating_sub(rect.top);
    if width <= 0 || height <= 0 {
        return None;
    }

    Some(WindowBoundsPayload {
        x: rect.left,
        y: rect.top,
        width,
        height,
    })
}

fn snapshot_window(hwnd: HWND) -> Option<WindowSnapshot> {
    if !hwnd_is_valid(hwnd) {
        return None;
    }

    let pid = read_window_pid(hwnd);
    let title = read_window_title(hwnd);
    let app = read_process_name(pid);
    let bounds = read_window_bounds(hwnd)?;

    Some(WindowSnapshot {
        hwnd: hwnd.0 as usize,
        pid,
        app,
        title,
        window_bounds: bounds,
    })
}

fn should_emit_app_change(snapshot: &WindowSnapshot, state: &LastWindowState) -> bool {
    snapshot.hwnd != state.hwnd || snapshot.pid != state.pid || snapshot.app != state.app || snapshot.title != state.title
}

fn should_emit_window_change(snapshot: &WindowSnapshot, state: &LastWindowState) -> bool {
    snapshot.hwnd == state.hwnd && snapshot.pid == state.pid && snapshot.title != state.title
}

fn update_last_state(snapshot: &WindowSnapshot, state: &mut LastWindowState) {
    state.hwnd = snapshot.hwnd;
    state.pid = snapshot.pid;
    state.app = snapshot.app.clone();
    state.title = snapshot.title.clone();
}

fn emit_window_event(event_type: &str, hwnd: HWND) {
    let Some(snapshot) = snapshot_window(hwnd) else {
        return;
    };

    let mut state_guard = match LAST_WINDOW_STATE.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    let should_emit = match event_type {
        "app_change" => should_emit_app_change(&snapshot, &state_guard),
        "window_change" => should_emit_window_change(&snapshot, &state_guard),
        _ => false,
    };
    if !should_emit {
        return;
    }

    update_last_state(&snapshot, &mut state_guard);
    drop(state_guard);

    emit_json_line(&serde_json::json!({
        "type": event_type,
        "timestamp": now_ms(),
        "app": snapshot.app,
        "pid": snapshot.pid,
        "title": snapshot.title,
        "windowBounds": snapshot.window_bounds,
    }));
}

unsafe extern "system" fn win_event_callback(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    if !hwnd_is_valid(hwnd) {
        return;
    }
    if id_object != OBJ_ID_WINDOW || id_child != CHILD_ID_SELF {
        return;
    }

    let foreground_hwnd = GetForegroundWindow();
    if !hwnd_is_valid(foreground_hwnd) {
        return;
    }

    let event_type = if event == EVENT_SYSTEM_FOREGROUND {
        "app_change"
    } else if event == EVENT_OBJECT_NAMECHANGE {
        if foreground_hwnd.0 != hwnd.0 {
            return;
        }
        "window_change"
    } else {
        return;
    };

    emit_window_event(event_type, hwnd);
}

fn install_hooks() -> Result<(HWINEVENTHOOK, HWINEVENTHOOK), String> {
    let foreground_hook = unsafe {
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(win_event_callback),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        )
    };
    if foreground_hook.0.is_null() {
        return Err("Failed to install EVENT_SYSTEM_FOREGROUND hook".to_string());
    }

    let title_hook = unsafe {
        SetWinEventHook(
            EVENT_OBJECT_NAMECHANGE,
            EVENT_OBJECT_NAMECHANGE,
            None,
            Some(win_event_callback),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        )
    };
    if title_hook.0.is_null() {
        unsafe {
            let _ = UnhookWinEvent(foreground_hook);
        }
        return Err("Failed to install EVENT_OBJECT_NAMECHANGE hook".to_string());
    }

    Ok((foreground_hook, title_hook))
}

fn run_message_loop() {
    let mut msg = MSG::default();
    unsafe {
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            let _ = TranslateMessage(&msg);
            let _ = DispatchMessageW(&msg);
        }
    }
}

fn main() {
    emit_json_line(&serde_json::json!({
        "type": "ready",
        "timestamp": now_ms(),
    }));

    let initial_hwnd = unsafe { GetForegroundWindow() };
    if hwnd_is_valid(initial_hwnd) {
        emit_window_event("app_change", initial_hwnd);
    }

    let hooks = match install_hooks() {
        Ok(hooks) => hooks,
        Err(error) => {
            emit_error_event(&error);
            std::process::exit(1);
        }
    };

    run_message_loop();

    unsafe {
        let _ = UnhookWinEvent(hooks.0);
        let _ = UnhookWinEvent(hooks.1);
    }
}
