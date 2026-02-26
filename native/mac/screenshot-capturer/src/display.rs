use std::sync::mpsc;
use std::time::Duration;

use cidre::{arc, blocks, cg, sc};

use crate::types::RectF64;

const SHAREABLE_CONTENT_TIMEOUT: Duration = Duration::from_millis(750);

pub(crate) struct SelectedDisplay {
    pub(crate) display: arc::R<sc::Display>,
    pub(crate) display_id: u32,
}

fn rect_from_cg(rect: cg::Rect) -> RectF64 {
    RectF64 {
        x: rect.origin.x,
        y: rect.origin.y,
        width: rect.size.width,
        height: rect.size.height,
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
    display_rects: &[(u32, RectF64)],
) -> Option<u32> {
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

    let mut best_display: Option<u32> = None;
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

fn load_shareable_content() -> Result<arc::R<sc::ShareableContent>, String> {
    let (tx, rx) = mpsc::sync_channel(1);
    let mut handler = blocks::ResultCh::<sc::ShareableContent>::new2(
        move |content: Option<&sc::ShareableContent>, error: Option<&cidre::ns::Error>| {
            let result = match error {
                Some(err) => Err(format!("ScreenCaptureKit content query failed: {err}")),
                None => content.map(|value| value.retained()).ok_or_else(|| {
                    "ScreenCaptureKit content query returned no content".to_string()
                }),
            };
            let _ = tx.send(result);
        },
    );
    sc::ShareableContent::current_with_ch_block(&mut handler);

    match rx.recv_timeout(SHAREABLE_CONTENT_TIMEOUT) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err("Timed out waiting for ScreenCaptureKit shareable content".to_string())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("ScreenCaptureKit shareable content callback disconnected".to_string())
        }
    }
}

pub(crate) fn resolve_active_display() -> Result<SelectedDisplay, String> {
    let content = load_shareable_content()?;
    let displays = content.displays();
    if displays.is_empty() {
        return Err("ScreenCaptureKit returned no displays".to_string());
    }

    let display_rects = displays
        .iter()
        .map(|display| (display.display_id().0, rect_from_cg(display.frame())))
        .collect::<Vec<_>>();

    let active_window_display_id = content
        .windows()
        .iter()
        .find(|window| window.is_on_screen() && window.is_active())
        .and_then(|window| {
            resolve_display_for_window_rects(rect_from_cg(window.frame()), &display_rects)
        });

    let main_display_id = cg::DirectDisplayId::main().0;
    let selected_display_id = active_window_display_id
        .or_else(|| {
            displays
                .iter()
                .any(|display| display.display_id().0 == main_display_id)
                .then_some(main_display_id)
        })
        .unwrap_or(display_rects[0].0);

    let selected_display = displays
        .iter()
        .find(|display| display.display_id().0 == selected_display_id)
        .map(|display| display.retained())
        .ok_or_else(|| format!("ScreenCaptureKit display {selected_display_id} is unavailable"))?;

    Ok(SelectedDisplay {
        display: selected_display,
        display_id: selected_display_id,
    })
}

#[cfg(test)]
mod tests {
    use super::{intersection_area, resolve_display_for_window_rects, RectF64};

    fn fake_display(id: u32, x: f64, y: f64, width: f64, height: f64) -> (u32, RectF64) {
        (
            id,
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
        assert_eq!(chosen, Some(2));
    }
}
