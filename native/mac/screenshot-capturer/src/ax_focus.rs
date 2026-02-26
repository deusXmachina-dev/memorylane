use cidre::{arc, ax};

use crate::types::RectF64;

pub(crate) fn focused_window_rect() -> Result<RectF64, String> {
    if !ax::is_process_trusted() {
        return Err("Accessibility permission is not granted for screenshot-capturer-mac".to_string());
    }

    let sys_wide = ax::UiElement::sys_wide();
    let focused_app = sys_wide
        .focused_app()
        .map_err(|err| format!("AX focused app lookup failed: {err:?}"))?;

    let focused_window: arc::R<ax::UiElement> =
        match focused_app.focused_ui_element().and_then(|el| el.window()) {
            Ok(window) => window,
            Err(_) => {
                let window_type = focused_app
                    .attr_value(ax::attr::focused_window())
                    .map_err(|err| format!("AX focused window lookup failed: {err:?}"))?;
                unsafe { std::mem::transmute(window_type) }
            }
        };

    let position = focused_window
        .pos()
        .map_err(|err| format!("AX window position lookup failed: {err:?}"))?
        .cg_point()
        .ok_or_else(|| "AX window position is missing or invalid".to_string())?;

    let size = focused_window
        .size()
        .map_err(|err| format!("AX window size lookup failed: {err:?}"))?
        .cg_size()
        .ok_or_else(|| "AX window size is missing or invalid".to_string())?;

    Ok(RectF64 {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}
