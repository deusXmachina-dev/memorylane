use serde::Serialize;
use std::io::{self, Write};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::types::SavedCapture;

#[derive(Serialize)]
struct ReadyEvent<'a> {
    #[serde(rename = "type")]
    event_type: &'a str,
    timestamp: u64,
    #[serde(rename = "outputDir")]
    output_dir: &'a str,
    #[serde(rename = "intervalMs")]
    interval_ms: u64,
}

#[derive(Serialize)]
struct DisplayChangeEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    timestamp: u64,
    #[serde(rename = "displayId")]
    display_id: u32,
}

#[derive(Serialize)]
struct ScreenshotSavedEvent<'a> {
    #[serde(rename = "type")]
    event_type: &'static str,
    timestamp: u64,
    #[serde(rename = "displayId")]
    display_id: u32,
    filepath: &'a str,
    width: usize,
    height: usize,
}

#[derive(Serialize)]
struct ErrorEvent<'a> {
    #[serde(rename = "type")]
    event_type: &'static str,
    timestamp: u64,
    error: &'a str,
}

pub(crate) fn now_ms() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as u64,
        Err(_) => 0,
    }
}

fn emit_json_line<T: Serialize>(event: &T) {
    let mut stdout = io::stdout().lock();
    if serde_json::to_writer(&mut stdout, event).is_ok() {
        let _ = stdout.write_all(b"\n");
        let _ = stdout.flush();
    }
}

pub(crate) fn emit_ready(output_dir: &str, interval_ms: u64) {
    emit_json_line(&ReadyEvent {
        event_type: "ready",
        timestamp: now_ms(),
        output_dir,
        interval_ms,
    });
}

pub(crate) fn emit_display_change(display_id: u32) {
    emit_json_line(&DisplayChangeEvent {
        event_type: "display_change",
        timestamp: now_ms(),
        display_id,
    });
}

pub(crate) fn emit_screenshot_saved(display_id: u32, capture: &SavedCapture) {
    emit_json_line(&ScreenshotSavedEvent {
        event_type: "screenshot_saved",
        timestamp: now_ms(),
        display_id,
        filepath: &capture.filepath,
        width: capture.width,
        height: capture.height,
    });
}

pub(crate) fn emit_error_event(error: &str) {
    emit_json_line(&ErrorEvent {
        event_type: "error",
        timestamp: now_ms(),
        error,
    });
}
