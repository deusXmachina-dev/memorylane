use image::imageops::FilterType;
use serde::Deserialize;
use serde_json::json;
use std::cmp;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use xcap::Monitor;

#[derive(Debug, Clone, Deserialize)]
struct BoundsPx {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum Command {
    #[serde(rename = "start")]
    Start {
        #[serde(rename = "outputDir")]
        output_dir: String,
        #[serde(rename = "intervalMs")]
        interval_ms: u64,
        #[serde(rename = "maxDimensionPx")]
        max_dimension_px: Option<u32>,
        #[serde(rename = "displayId")]
        display_id: Option<u32>,
        #[serde(rename = "targetBoundsPx")]
        target_bounds_px: Option<BoundsPx>,
    },
    #[serde(rename = "set_display")]
    SetDisplay {
        #[serde(rename = "displayId")]
        display_id: Option<u32>,
        #[serde(rename = "targetBoundsPx")]
        target_bounds_px: Option<BoundsPx>,
    },
    #[serde(rename = "stop")]
    Stop,
}

enum CommandMessage {
    Parsed(Command),
    ParseError(String),
}

#[derive(Debug)]
struct CaptureState {
    active: bool,
    stop_requested: bool,
    output_dir: PathBuf,
    interval_ms: u64,
    max_dimension_px: Option<u32>,
    display_id: Option<u32>,
    target_bounds_px: Option<BoundsPx>,
    next_frame_index: u64,
}

impl Default for CaptureState {
    fn default() -> Self {
        Self {
            active: false,
            stop_requested: false,
            output_dir: PathBuf::new(),
            interval_ms: 1000,
            max_dimension_px: None,
            display_id: None,
            target_bounds_px: None,
            next_frame_index: 0,
        }
    }
}

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

fn emit_ready_event() {
    emit_json_line(&json!({
        "type": "ready",
        "timestamp": now_ms(),
    }));
}

fn emit_error_event(error: &str) {
    emit_json_line(&json!({
        "type": "error",
        "timestamp": now_ms(),
        "error": error,
    }));
}

fn emit_frame_event(
    filepath: &Path,
    width: u32,
    height: u32,
    display_id: u32,
    timestamp: u64,
) {
    emit_json_line(&json!({
        "type": "frame",
        "timestamp": timestamp,
        "filepath": filepath.to_string_lossy().to_string(),
        "width": width,
        "height": height,
        "displayId": display_id,
    }));
}

fn spawn_command_reader() -> Receiver<CommandMessage> {
    let (tx, rx) = mpsc::channel::<CommandMessage>();
    thread::spawn(move || {
        let stdin = io::stdin();
        let reader = io::BufReader::new(stdin.lock());

        for line in reader.lines() {
            let Ok(line) = line else {
                let _ = tx.send(CommandMessage::ParseError(
                    "Failed to read command from stdin".to_string(),
                ));
                continue;
            };

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            match serde_json::from_str::<Command>(trimmed) {
                Ok(command) => {
                    let _ = tx.send(CommandMessage::Parsed(command));
                }
                Err(err) => {
                    let _ = tx.send(CommandMessage::ParseError(format!(
                        "Invalid command payload: {err}"
                    )));
                }
            }
        }
    });

    rx
}

fn format_bounds(bounds: &BoundsPx) -> String {
    format!(
        "x={}, y={}, width={}, height={}",
        bounds.x, bounds.y, bounds.width, bounds.height
    )
}

fn monitor_matches_target(monitor: &Monitor, target: &BoundsPx) -> bool {
    let x = match monitor.x() {
        Ok(value) => value,
        Err(_) => return false,
    };
    let y = match monitor.y() {
        Ok(value) => value,
        Err(_) => return false,
    };
    let width = match monitor.width() {
        Ok(value) => value,
        Err(_) => return false,
    };
    let height = match monitor.height() {
        Ok(value) => value,
        Err(_) => return false,
    };

    x == target.x && y == target.y && width == target.width && height == target.height
}

fn monitor_bounds_description(monitor: &Monitor) -> String {
    let x = monitor
        .x()
        .map(|value| value.to_string())
        .unwrap_or_else(|_| "?".to_string());
    let y = monitor
        .y()
        .map(|value| value.to_string())
        .unwrap_or_else(|_| "?".to_string());
    let width = monitor
        .width()
        .map(|value| value.to_string())
        .unwrap_or_else(|_| "?".to_string());
    let height = monitor
        .height()
        .map(|value| value.to_string())
        .unwrap_or_else(|_| "?".to_string());
    format!("x={x}, y={y}, width={width}, height={height}")
}

fn select_monitor(target_bounds_px: Option<&BoundsPx>) -> Result<Monitor, String> {
    let monitors = Monitor::all().map_err(|err| format!("Failed to enumerate monitors: {err}"))?;
    if monitors.is_empty() {
        return Err("No screen sources available".to_string());
    }

    if let Some(target) = target_bounds_px {
        if let Some(monitor) = monitors
            .iter()
            .find(|monitor| monitor_matches_target(monitor, target))
        {
            return Ok(monitor.clone());
        }

        let available = monitors
            .iter()
            .map(monitor_bounds_description)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!(
            "Requested display not found. requested={} available=[{}]",
            format_bounds(target),
            available
        ));
    }

    Ok(monitors[0].clone())
}

fn apply_max_dimension(
    image: image::RgbaImage,
    max_dimension_px: Option<u32>,
) -> image::RgbaImage {
    let Some(max_dimension_px) = max_dimension_px else {
        return image;
    };

    let width = image.width();
    let height = image.height();
    let max_side = cmp::max(width, height);
    if max_side <= max_dimension_px {
        return image;
    }

    let scale = max_dimension_px as f64 / max_side as f64;
    let new_width = cmp::max(1, (width as f64 * scale).round() as u32);
    let new_height = cmp::max(1, (height as f64 * scale).round() as u32);
    image::imageops::resize(&image, new_width, new_height, FilterType::Triangle)
}

fn capture_once(state: &mut CaptureState) -> Result<(), String> {
    let monitor = select_monitor(state.target_bounds_px.as_ref())?;

    let image = monitor
        .capture_image()
        .map_err(|err| format!("Failed to capture screen: {err}"))?;
    let image = apply_max_dimension(image, state.max_dimension_px);

    fs::create_dir_all(&state.output_dir)
        .map_err(|err| format!("Failed to create output directory: {err}"))?;

    let filename = format!("frame-{}.png", state.next_frame_index);
    state.next_frame_index = state.next_frame_index.saturating_add(1);
    let filepath = state.output_dir.join(filename);

    let dynamic_image = image::DynamicImage::ImageRgba8(image);
    dynamic_image
        .save_with_format(&filepath, image::ImageFormat::Png)
        .map_err(|err| format!("Failed to write PNG: {err}"))?;

    let fallback_display_id = monitor.id().unwrap_or(0);
    let display_id = state.display_id.unwrap_or(fallback_display_id);
    emit_frame_event(
        &filepath,
        dynamic_image.width(),
        dynamic_image.height(),
        display_id,
        now_ms(),
    );
    Ok(())
}

fn apply_start_command(
    state: &mut CaptureState,
    output_dir: String,
    interval_ms: u64,
    max_dimension_px: Option<u32>,
    display_id: Option<u32>,
    target_bounds_px: Option<BoundsPx>,
) -> Result<(), String> {
    if interval_ms == 0 {
        return Err("intervalMs must be > 0".to_string());
    }
    if let Some(max_dimension_px) = max_dimension_px {
        if max_dimension_px == 0 {
            return Err("maxDimensionPx must be > 0".to_string());
        }
    }

    state.active = true;
    state.output_dir = PathBuf::from(output_dir);
    state.interval_ms = interval_ms;
    state.max_dimension_px = max_dimension_px;
    state.display_id = display_id;
    state.target_bounds_px = target_bounds_px;
    Ok(())
}

fn apply_set_display_command(
    state: &mut CaptureState,
    display_id: Option<u32>,
    target_bounds_px: Option<BoundsPx>,
) {
    state.display_id = display_id;
    state.target_bounds_px = target_bounds_px;
}

fn main() {
    emit_ready_event();
    let command_rx = spawn_command_reader();
    let mut state = CaptureState::default();
    let mut next_capture_at = Instant::now();

    loop {
        while let Ok(message) = command_rx.try_recv() {
            match message {
                CommandMessage::Parsed(Command::Start {
                    output_dir,
                    interval_ms,
                    max_dimension_px,
                    display_id,
                    target_bounds_px,
                }) => {
                    match apply_start_command(
                        &mut state,
                        output_dir,
                        interval_ms,
                        max_dimension_px,
                        display_id,
                        target_bounds_px,
                    ) {
                        Ok(()) => {
                            next_capture_at = Instant::now();
                        }
                        Err(error) => emit_error_event(&error),
                    }
                }
                CommandMessage::Parsed(Command::SetDisplay {
                    display_id,
                    target_bounds_px,
                }) => {
                    apply_set_display_command(&mut state, display_id, target_bounds_px);
                }
                CommandMessage::Parsed(Command::Stop) => {
                    state.stop_requested = true;
                }
                CommandMessage::ParseError(error) => emit_error_event(&error),
            }
        }

        if state.stop_requested {
            break;
        }

        if !state.active {
            thread::sleep(Duration::from_millis(25));
            continue;
        }

        let now = Instant::now();
        if now >= next_capture_at {
            if let Err(error) = capture_once(&mut state) {
                emit_error_event(&error);
            }
            next_capture_at = Instant::now() + Duration::from_millis(state.interval_ms);
            continue;
        }

        let wait_until_next = next_capture_at.saturating_duration_since(now);
        thread::sleep(cmp::min(wait_until_next, Duration::from_millis(25)));
    }
}
