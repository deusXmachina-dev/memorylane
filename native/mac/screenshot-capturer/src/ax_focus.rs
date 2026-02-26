use std::ffi::c_void;
use std::ptr::NonNull;
use std::thread;
use std::time::Duration;

use objc2_application_services as ax;
use objc2_core_foundation::{CFRetained, CFString, CFType, CGPoint, CGSize};

use crate::types::RectF64;

fn copy_attribute_value(
    element: &ax::AXUIElement,
    attribute: &str,
) -> Result<CFRetained<CFType>, String> {
    let attribute_name = CFString::from_str(attribute);
    let mut last_status: Option<ax::AXError> = None;

    for attempt in 0..3 {
        let mut raw_value: *const CFType = std::ptr::null();
        let status =
            unsafe { element.copy_attribute_value(&attribute_name, NonNull::from(&mut raw_value)) };
        if status == ax::AXError::Success {
            let raw_value = NonNull::new(raw_value as *mut CFType)
                .ok_or_else(|| format!("AX attribute {attribute} returned null value"))?;
            return Ok(unsafe { CFRetained::from_raw(raw_value) });
        }

        last_status = Some(status);
        if status == ax::AXError::CannotComplete && attempt < 2 {
            // UI accessibility can be briefly unavailable when focus changes rapidly.
            thread::sleep(Duration::from_millis(15));
            continue;
        }
        break;
    }

    Err(format!(
        "AX attribute lookup failed for {attribute}: {:?}",
        last_status.unwrap_or(ax::AXError::Failure)
    ))
}

fn copy_element_attribute(
    element: &ax::AXUIElement,
    attribute: &str,
    context: &str,
) -> Result<CFRetained<ax::AXUIElement>, String> {
    let value =
        copy_attribute_value(element, attribute).map_err(|err| format!("{context}: {err}"))?;
    value
        .downcast::<ax::AXUIElement>()
        .map_err(|_| format!("{context}: AX attribute {attribute} was not an AXUIElement"))
}

fn decode_point(value: CFRetained<CFType>, attribute: &str) -> Result<CGPoint, String> {
    let ax_value = value
        .downcast::<ax::AXValue>()
        .map_err(|_| format!("AX attribute {attribute} was not an AXValue"))?;
    let value_type = unsafe { ax_value.r#type() };
    if value_type != ax::AXValueType::CGPoint {
        return Err(format!(
            "AX attribute {attribute} had unexpected AXValueType {value_type:?}, expected CGPoint"
        ));
    }

    let mut point = CGPoint::ZERO;
    let decoded = unsafe {
        ax_value.value(
            ax::AXValueType::CGPoint,
            NonNull::from(&mut point).cast::<c_void>(),
        )
    };
    if !decoded {
        return Err(format!(
            "AX attribute {attribute} could not be decoded as CGPoint"
        ));
    }
    Ok(point)
}

fn decode_size(value: CFRetained<CFType>, attribute: &str) -> Result<CGSize, String> {
    let ax_value = value
        .downcast::<ax::AXValue>()
        .map_err(|_| format!("AX attribute {attribute} was not an AXValue"))?;
    let value_type = unsafe { ax_value.r#type() };
    if value_type != ax::AXValueType::CGSize {
        return Err(format!(
            "AX attribute {attribute} had unexpected AXValueType {value_type:?}, expected CGSize"
        ));
    }

    let mut size = CGSize::ZERO;
    let decoded = unsafe {
        ax_value.value(
            ax::AXValueType::CGSize,
            NonNull::from(&mut size).cast::<c_void>(),
        )
    };
    if !decoded {
        return Err(format!(
            "AX attribute {attribute} could not be decoded as CGSize"
        ));
    }
    Ok(size)
}

pub(crate) fn focused_window_rect() -> Result<RectF64, String> {
    if unsafe { !ax::AXIsProcessTrusted() } {
        return Err(
            "Accessibility permission is not granted for screenshot-capturer-mac".to_string(),
        );
    }

    let sys_wide = unsafe { ax::AXUIElement::new_system_wide() };
    // Keep AX lookups responsive so capture can fall back quickly under contention.
    let _ = unsafe { sys_wide.set_messaging_timeout(0.05) };
    let focused_app = copy_element_attribute(
        &sys_wide,
        "AXFocusedApplication",
        "AX focused app lookup failed",
    )?;

    let focused_window = match copy_element_attribute(
        &focused_app,
        "AXFocusedUIElement",
        "AX focused UI element lookup failed",
    ) {
        Ok(focused_ui) => {
            match copy_element_attribute(&focused_ui, "AXWindow", "AX focused window lookup failed")
            {
                Ok(window) => window,
                Err(_) => focused_ui,
            }
        }
        Err(_) => copy_element_attribute(
            &focused_app,
            "AXFocusedWindow",
            "AX focused window lookup failed",
        )?,
    };

    let position = decode_point(
        copy_attribute_value(&focused_window, "AXPosition")
            .map_err(|err| format!("AX window position lookup failed: {err}"))?,
        "AXPosition",
    )
    .map_err(|err| format!("AX window position lookup failed: {err}"))?;

    let size = decode_size(
        copy_attribute_value(&focused_window, "AXSize")
            .map_err(|err| format!("AX window size lookup failed: {err}"))?,
        "AXSize",
    )
    .map_err(|err| format!("AX window size lookup failed: {err}"))?;

    Ok(RectF64 {
        x: position.x as f64,
        y: position.y as f64,
        width: size.width as f64,
        height: size.height as f64,
    })
}
