use objc2_core_foundation::{CFString, CFURL};
use objc2_core_graphics as cg;
use objc2_image_io as iio;
use std::path::Path;

use crate::events::now_ms;
use crate::types::SavedCapture;

pub(crate) fn save_display_image(
    display: cg::CGDirectDisplayID,
    output_dir: &Path,
) -> Result<SavedCapture, String> {
    let image = cg::CGDisplayCreateImage(display)
        .ok_or_else(|| format!("CGDisplayCreateImage failed for display {display}"))?;

    let filename = format!("frame-{}-{}.png", now_ms(), display);
    let output_path = output_dir.join(filename);
    let output_url = CFURL::from_file_path(&output_path).ok_or_else(|| {
        format!(
            "Failed to create CFURL for output path {}",
            output_path.display()
        )
    })?;
    let png_type = CFString::from_static_str("public.png");

    let destination = unsafe { iio::CGImageDestination::with_url(&output_url, &png_type, 1, None) }
        .ok_or_else(|| {
            format!(
                "Failed to create image destination for {}",
                output_path.display()
            )
        })?;
    unsafe { destination.add_image(&image, None) };
    if unsafe { !destination.finalize() } {
        return Err(format!(
            "Failed to finalize PNG write for {}",
            output_path.display()
        ));
    }

    Ok(SavedCapture {
        filepath: output_path.to_string_lossy().to_string(),
        width: cg::CGImage::width(Some(&image)),
        height: cg::CGImage::height(Some(&image)),
    })
}
