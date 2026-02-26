use cidre::cg;

use crate::ax_focus::focused_window_rect;
use crate::types::RectF64;

const CG_OK: i32 = 0;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C-unwind" {
    fn CGGetActiveDisplayList(
        max_displays: u32,
        active_displays: *mut cg::DirectDisplayId,
        display_count: *mut u32,
    ) -> i32;
}

pub(crate) fn list_active_displays() -> Result<Vec<cg::DirectDisplayId>, String> {
    let mut count = 0u32;
    let count_status = unsafe { CGGetActiveDisplayList(0, std::ptr::null_mut(), &mut count) };
    if count_status != CG_OK {
        return Err(format!("CGGetActiveDisplayList(count) failed: {count_status}"));
    }
    if count == 0 {
        return Err("No active displays reported by CoreGraphics".to_string());
    }

    let mut displays = vec![cg::DirectDisplayId::NULL; count as usize];
    let list_status = unsafe { CGGetActiveDisplayList(count, displays.as_mut_ptr(), &mut count) };
    if list_status != CG_OK {
        return Err(format!("CGGetActiveDisplayList(list) failed: {list_status}"));
    }

    displays.truncate(count as usize);
    Ok(displays)
}

fn display_rect(display_id: cg::DirectDisplayId) -> RectF64 {
    let bounds = display_id.bounds();
    RectF64 {
        x: bounds.origin.x,
        y: bounds.origin.y,
        width: bounds.size.width,
        height: bounds.size.height,
    }
}

fn contains_point(rect: RectF64, x: f64, y: f64) -> bool {
    x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height
}

fn intersection_area(a: RectF64, b: RectF64) -> f64 {
    let left = a.x.max(b.x);
    let top = a.y.max(b.y);
    let right = (a.x + a.width).min(b.x + b.width);
    let bottom = (a.y + a.height).min(b.y + b.height);
    let width = (right - left).max(0.0);
    let height = (bottom - top).max(0.0);
    width * height
}

fn resolve_display_for_window_rects(
    window_rect: RectF64,
    display_rects: &[(cg::DirectDisplayId, RectF64)],
) -> Option<cg::DirectDisplayId> {
    if window_rect.width <= 0.0 || window_rect.height <= 0.0 {
        return None;
    }

    let center_x = window_rect.x + (window_rect.width / 2.0);
    let center_y = window_rect.y + (window_rect.height / 2.0);

    if let Some(center_hit) = display_rects
        .iter()
        .find(|(_, rect)| contains_point(*rect, center_x, center_y))
        .map(|(display_id, _)| *display_id)
    {
        return Some(center_hit);
    }

    let mut best_display: Option<cg::DirectDisplayId> = None;
    let mut best_overlap = 0.0f64;
    for (display_id, rect) in display_rects {
        let overlap = intersection_area(window_rect, *rect);
        if overlap > best_overlap {
            best_overlap = overlap;
            best_display = Some(*display_id);
        }
    }
    if best_overlap > 0.0 {
        best_display
    } else {
        None
    }
}

pub(crate) fn resolve_active_display(displays: &[cg::DirectDisplayId]) -> Result<cg::DirectDisplayId, String> {
    let focused_rect = focused_window_rect()?;
    let display_rects = displays
        .iter()
        .map(|display| (*display, display_rect(*display)))
        .collect::<Vec<_>>();
    resolve_display_for_window_rects(focused_rect, &display_rects)
        .ok_or_else(|| "Could not map focused window to an active display".to_string())
}

#[cfg(test)]
mod tests {
    use super::{intersection_area, resolve_display_for_window_rects, RectF64};
    use cidre::cg;

    fn fake_display(
        id: u32,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> (cg::DirectDisplayId, RectF64) {
        (
            cg::DirectDisplayId(id),
            RectF64 {
                x,
                y,
                width,
                height,
            },
        )
    }

    #[test]
    fn overlap_area_is_zero_for_disjoint_rects() {
        let a = RectF64 {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
        };
        let b = RectF64 {
            x: 200.0,
            y: 200.0,
            width: 50.0,
            height: 50.0,
        };
        assert_eq!(intersection_area(a, b), 0.0);
    }

    #[test]
    fn overlap_area_is_positive_for_intersection() {
        let a = RectF64 {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
        };
        let b = RectF64 {
            x: 50.0,
            y: 20.0,
            width: 100.0,
            height: 100.0,
        };
        assert_eq!(intersection_area(a, b), 50.0 * 80.0);
    }

    #[test]
    fn chooses_display_by_center_point_when_inside() {
        let d1 = fake_display(1, 0.0, 0.0, 100.0, 100.0);
        let d2 = fake_display(2, 100.0, 0.0, 100.0, 100.0);
        let display_rects = vec![d1, d2];

        let window = RectF64 {
            x: 120.0,
            y: 20.0,
            width: 60.0,
            height: 60.0,
        };

        let chosen = resolve_display_for_window_rects(window, &display_rects);
        assert_eq!(chosen.map(|display| display.0), Some(2));
    }
}
