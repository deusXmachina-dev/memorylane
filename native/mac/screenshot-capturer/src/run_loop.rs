use objc2_core_graphics as cg;
use std::fs;
use std::thread;
use std::time::{Duration, Instant};

use crate::capture::save_display_image;
use crate::cli::Config;
use crate::display::{list_active_displays, resolve_active_display};
use crate::events::{emit_display_change, emit_error_event, emit_ready, emit_screenshot_saved};

fn is_transient_ax_contention_error(err: &str) -> bool {
    err.contains("AXError(-25204)") || err.contains("AXError(-25212)")
}

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
    let mut use_initial_main_display = true;

    loop {
        let loop_started = Instant::now();
        let display = if use_initial_main_display {
            use_initial_main_display = false;
            cg::CGMainDisplayID()
        } else {
            match list_active_displays() {
                Ok(displays) => match resolve_active_display(&displays) {
                    Ok(display) => {
                        last_error = None;
                        display
                    }
                    Err(err) => {
                        if !is_transient_ax_contention_error(&err)
                            && last_error.as_deref() != Some(err.as_str())
                        {
                            emit_error_event(&err);
                            last_error = Some(err.clone());
                        }
                        cg::CGMainDisplayID()
                    }
                },
                Err(err) => {
                    if last_error.as_deref() != Some(err.as_str()) {
                        emit_error_event(&err);
                        last_error = Some(err.clone());
                    }
                    cg::CGMainDisplayID()
                }
            }
        };

        if last_display != Some(display) {
            emit_display_change(display);
            last_display = Some(display);
        }

        match save_display_image(display, &config.output_dir) {
            Ok(capture) => {
                last_error = None;
                emit_screenshot_saved(display, &capture);
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
