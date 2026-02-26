use std::fs;
use std::thread;
use std::time::{Duration, Instant};

use crate::capture::save_display_image;
use crate::cli::Config;
use crate::display::resolve_active_display;
use crate::events::{emit_display_change, emit_error_event, emit_ready, emit_screenshot_saved};

pub(crate) fn run(config: Config) -> Result<(), String> {
    let output_dir_string = config.output_dir.to_string_lossy().to_string();
    fs::create_dir_all(&config.output_dir).map_err(|err| {
        format!(
            "Failed to create output directory {}: {err}",
            config.output_dir.display()
        )
    })?;
    emit_ready(&output_dir_string, config.interval_ms);

    let mut last_display: Option<u32> = None;
    let mut last_error: Option<String> = None;

    loop {
        let loop_started = Instant::now();
        match resolve_active_display() {
            Ok(selection) => {
                if last_display != Some(selection.display_id) {
                    emit_display_change(selection.display_id);
                    last_display = Some(selection.display_id);
                }

                match save_display_image(
                    &selection.display,
                    selection.display_id,
                    &config.output_dir,
                ) {
                    Ok(capture) => {
                        last_error = None;
                        emit_screenshot_saved(selection.display_id, &capture);
                    }
                    Err(err) => {
                        if last_error.as_deref() != Some(err.as_str()) {
                            emit_error_event(&err);
                            last_error = Some(err);
                        }
                    }
                }
            }
            Err(err) => {
                if last_error.as_deref() != Some(err.as_str()) {
                    emit_error_event(&err);
                    last_error = Some(err);
                }
            }
        }

        let elapsed = loop_started.elapsed();
        let interval = Duration::from_millis(config.interval_ms);
        if elapsed < interval {
            thread::sleep(interval - elapsed);
        }
    }
}
