use std::fs;
use std::thread;
use std::time::{Duration, Instant};

use crate::capture::DisplayStreamSession;
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
    let mut session: Option<DisplayStreamSession> = None;

    loop {
        let loop_started = Instant::now();
        match resolve_active_display() {
            Ok(selection) => {
                let current_display = session.as_ref().map(|active| active.display_id());
                if current_display != Some(selection.display_id) {
                    match DisplayStreamSession::start(&selection.display, selection.display_id) {
                        Ok(new_session) => {
                            session = Some(new_session);
                            if last_display != Some(selection.display_id) {
                                emit_display_change(selection.display_id);
                                last_display = Some(selection.display_id);
                            }
                        }
                        Err(err) => {
                            if last_error.as_deref() != Some(err.as_str()) {
                                emit_error_event(&err);
                                last_error = Some(err);
                            }
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

        if let Some(active_session) = session.as_ref() {
            match active_session.save_latest_display_image(&config.output_dir) {
                Ok(Some(capture)) => {
                    last_error = None;
                    emit_screenshot_saved(active_session.display_id(), &capture);
                }
                Ok(None) => {}
                Err(err) => {
                    if last_error.as_deref() != Some(err.as_str()) {
                        emit_error_event(&err);
                        last_error = Some(err);
                    }
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
