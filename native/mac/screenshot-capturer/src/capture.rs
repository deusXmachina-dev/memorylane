use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use cidre::{arc, blocks, cf, cg, ns, sc};

use crate::events::now_ms;
use crate::types::SavedCapture;

const CAPTURE_TIMEOUT: Duration = Duration::from_secs(2);

fn capture_image(
    filter: &sc::ContentFilter,
    cfg: &sc::StreamCfg,
) -> Result<arc::R<cg::Image>, String> {
    let (tx, rx) = mpsc::sync_channel(1);
    let mut handler = blocks::ResultCh::<cg::Image>::new2(
        move |image: Option<&cg::Image>, error: Option<&ns::Error>| {
            let result = match error {
                Some(err) => Err(format!("ScreenCaptureKit image capture failed: {err}")),
                None => image
                    .map(|value| value.retained())
                    .ok_or_else(|| "ScreenCaptureKit returned no image".to_string()),
            };
            let _ = tx.send(result);
        },
    );
    unsafe { sc::ScreenshotManager::capture_image_ch(filter, cfg, Some(&mut handler)) };

    match rx.recv_timeout(CAPTURE_TIMEOUT) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err("Timed out waiting for ScreenCaptureKit image capture".to_string())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("ScreenCaptureKit image capture callback disconnected".to_string())
        }
    }
}

pub(crate) fn save_display_image(
    display: &sc::Display,
    display_id: u32,
    output_dir: &Path,
) -> Result<SavedCapture, String> {
    let empty_windows = ns::Array::new();
    let filter = sc::ContentFilter::with_display_excluding_windows(display, &empty_windows);
    let mut cfg = sc::StreamCfg::new();
    cfg.set_shows_cursor(false);

    let image = capture_image(&filter, &cfg)?;
    let filename = format!("frame-{}-{}.png", now_ms(), display_id);
    let output_path = output_dir.join(filename);
    let output_url = cf::Url::with_file_path(&output_path).ok_or_else(|| {
        format!(
            "Failed to create CFURL for output path {}",
            output_path.display()
        )
    })?;
    let png_type = cf::String::from_str("public.png");

    let mut destination = cg::ImageDst::with_url(&output_url, &png_type, 1).ok_or_else(|| {
        format!(
            "Failed to create image destination for {}",
            output_path.display()
        )
    })?;
    destination.add_image(&image, None);
    if !destination.finalize() {
        return Err(format!(
            "Failed to finalize PNG write for {}",
            output_path.display()
        ));
    }

    Ok(SavedCapture {
        filepath: output_path.to_string_lossy().to_string(),
        width: image.width(),
        height: image.height(),
    })
}
