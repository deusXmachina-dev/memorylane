use cidre::{arc, cf, cg};
use std::fs;
use std::path::Path;

use crate::events::now_ms;
use crate::types::SavedCapture;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C-unwind" {
    fn CGDisplayCreateImage(display: cg::DirectDisplayId) -> Option<arc::R<cg::Image>>;
}

pub(crate) fn save_display_image(
    display: cg::DirectDisplayId,
    output_dir: &Path,
) -> Result<SavedCapture, String> {
    let image = unsafe { CGDisplayCreateImage(display) }
        .ok_or_else(|| format!("CGDisplayCreateImage failed for display {}", display.0))?;

    fs::create_dir_all(output_dir)
        .map_err(|err| format!("Failed to create output directory {}: {err}", output_dir.display()))?;

    let filename = format!("frame-{}-{}.png", now_ms(), display.0);
    let output_path = output_dir.join(filename);
    let output_url = cf::Url::with_file_path(&output_path).ok_or_else(|| {
        format!(
            "Failed to create CFURL for output path {}",
            output_path.display()
        )
    })?;
    let png_type = cf::String::from_str("public.png");

    let mut destination = cg::ImageDst::with_url(&output_url, &png_type, 1)
        .ok_or_else(|| format!("Failed to create image destination for {}", output_path.display()))?;
    destination.as_mut().add_image(&image, None);
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
