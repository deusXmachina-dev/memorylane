use std::io::{self, Write};
use windows::Win32::Foundation::HWND;

use crate::snapshot::snapshot_window;
use crate::state::{
    should_emit_app_change, should_emit_window_change, update_last_state, LAST_WINDOW_STATE,
};
use crate::time::{event_time_to_wall_ms, now_ms};

pub fn emit_json_line(value: &serde_json::Value) {
    let mut stdout = io::stdout().lock();
    if serde_json::to_writer(&mut stdout, value).is_ok() {
        let _ = stdout.write_all(b"\n");
        let _ = stdout.flush();
    }
}

pub fn emit_error_event(error: &str) {
    emit_json_line(&serde_json::json!({
        "type": "error",
        "timestamp": now_ms(),
        "error": error,
    }));
}

pub fn emit_window_event(event_type: &str, hwnd: HWND, event_time: u32) {
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

    let mut payload = serde_json::Map::new();
    payload.insert(
        "type".to_string(),
        serde_json::Value::String(event_type.to_string()),
    );
    payload.insert(
        "timestamp".to_string(),
        serde_json::Value::Number(serde_json::Number::from(event_time_to_wall_ms(event_time))),
    );
    payload.insert("app".to_string(), serde_json::Value::String(snapshot.app));
    payload.insert(
        "hwnd".to_string(),
        serde_json::Value::String(format!("0x{:X}", snapshot.hwnd)),
    );
    payload.insert(
        "pid".to_string(),
        serde_json::Value::Number(serde_json::Number::from(snapshot.pid)),
    );
    payload.insert(
        "title".to_string(),
        serde_json::Value::String(snapshot.title),
    );
    payload.insert(
        "windowBounds".to_string(),
        serde_json::to_value(snapshot.window_bounds).unwrap_or(serde_json::Value::Null),
    );
    if let Some(url) = snapshot.url {
        payload.insert("url".to_string(), serde_json::Value::String(url));
    }

    emit_json_line(&serde_json::Value::Object(payload));
}
