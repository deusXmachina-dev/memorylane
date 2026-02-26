use cidre::cg;
use std::thread;
use std::time::{Duration, Instant};

use crate::capture::save_display_image;
use crate::cli::Config;
use crate::display::{list_active_displays, resolve_active_display};
use crate::events::{emit_display_change, emit_error_event, emit_ready, emit_screenshot_saved};

pub(crate) fn run(config: Config) -> Result<(), String> {
    let output_dir_string = config.output_dir.to_string_lossy().to_string();
    emit_ready(&output_dir_string, config.interval_ms);

    let mut last_display: Option<u32> = None;
    let mut last_error: Option<String> = None;

    loop {
        let loop_started = Instant::now();
        let displays = match list_active_displays() {
            Ok(displays) => displays,
            Err(err) => {
                if last_error.as_deref() != Some(err.as_str()) {
                    emit_error_event(&err);
                    last_error = Some(err.clone());
                }
                thread::sleep(Duration::from_millis(config.interval_ms));
                continue;
            }
        };

        let display = match resolve_active_display(&displays) {
            Ok(display) => {
                last_error = None;
                display
            }
            Err(err) => {
                if last_error.as_deref() != Some(err.as_str()) {
                    emit_error_event(&err);
                    last_error = Some(err.clone());
                }
                cg::DirectDisplayId::main()
            }
        };

        if last_display != Some(display.0) {
            emit_display_change(display.0);
            last_display = Some(display.0);
        }

        match save_display_image(display, &config.output_dir) {
            Ok(capture) => {
                last_error = None;
                emit_screenshot_saved(display.0, &capture);
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
