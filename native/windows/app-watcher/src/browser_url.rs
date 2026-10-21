use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, CUIAutomation8, IUIAutomation, IUIAutomationElement, IUIAutomationValuePattern,
    TreeScope_Subtree, UIA_EditControlTypeId, UIA_ValuePatternId,
};

const MAX_UIA_ELEMENTS_TO_SCAN: i32 = 512;
const BROWSER_PROCESS_NAMES: &[&str] = &[
    "arc", "brave", "chrome", "chromium", "firefox", "msedge", "opera", "vivaldi",
];

fn is_browser_process_name(process_name: &str) -> bool {
    let normalized = process_name.to_ascii_lowercase();
    BROWSER_PROCESS_NAMES
        .iter()
        .any(|candidate| *candidate == normalized)
}

fn normalize_candidate_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("about:blank") {
        return None;
    }

    if trimmed.chars().any(char::is_whitespace) {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    let has_supported_scheme = lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("file://")
        || lower.starts_with("chrome://")
        || lower.starts_with("edge://")
        || lower.starts_with("about:")
        || lower.starts_with("moz-extension://")
        || lower.starts_with("moz://")
        || lower.starts_with("view-source:");
    if has_supported_scheme {
        return Some(trimmed.to_string());
    }

    let host = trimmed
        .split(|ch| matches!(ch, '/' | '?' | '#'))
        .next()
        .unwrap_or_default();
    let host_like = host.contains('.')
        && host
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | ':' | '@' | '_'));
    if host_like {
        return Some(format!("https://{}", trimmed));
    }

    None
}

fn element_has_address_bar_hint(element: &IUIAutomationElement) -> bool {
    let automation_id = unsafe { element.CurrentAutomationId() }
        .ok()
        .map(|value| value.to_string().to_ascii_lowercase())
        .unwrap_or_default();
    let name = unsafe { element.CurrentName() }
        .ok()
        .map(|value| value.to_string().to_ascii_lowercase())
        .unwrap_or_default();

    let hints = [
        "address",
        "address and search",
        "location",
        "omnibox",
        "url",
        "urlbar",
    ];
    hints
        .iter()
        .any(|hint| automation_id.contains(hint) || name.contains(hint))
}

fn try_extract_url_from_element(element: &IUIAutomationElement) -> Option<String> {
    if let Ok(pattern) =
        unsafe { element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) }
    {
        if let Ok(value) = unsafe { pattern.CurrentValue() } {
            if let Some(normalized) = normalize_candidate_url(&value.to_string()) {
                return Some(normalized);
            }
        }
    }

    if let Ok(name) = unsafe { element.CurrentName() } {
        if let Some(normalized) = normalize_candidate_url(&name.to_string()) {
            return Some(normalized);
        }
    }

    None
}

pub fn read_browser_url(hwnd: HWND, app: &str) -> Option<String> {
    if !is_browser_process_name(app) {
        return None;
    }

    let automation: IUIAutomation = unsafe {
        CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)
            .or_else(|_| CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER))
            .ok()?
    };
    let root = unsafe { automation.ElementFromHandle(hwnd).ok()? };
    let true_condition = unsafe { automation.CreateTrueCondition().ok()? };
    let all_elements = unsafe { root.FindAll(TreeScope_Subtree, &true_condition).ok()? };
    let total_len = unsafe { all_elements.Length().ok()? };
    if total_len <= 0 {
        return None;
    }

    let capped_len = total_len.min(MAX_UIA_ELEMENTS_TO_SCAN);
    let mut fallback_candidate: Option<String> = None;

    for index in 0..capped_len {
        let element = match unsafe { all_elements.GetElement(index) } {
            Ok(element) => element,
            Err(_) => continue,
        };
        let control_type = match unsafe { element.CurrentControlType() } {
            Ok(control_type) => control_type,
            Err(_) => continue,
        };
        if control_type != UIA_EditControlTypeId {
            continue;
        }

        if element_has_address_bar_hint(&element) {
            if let Some(url) = try_extract_url_from_element(&element) {
                return Some(url);
            }
            continue;
        }

        if fallback_candidate.is_none() {
            fallback_candidate = try_extract_url_from_element(&element);
        }
    }

    fallback_candidate
}

#[cfg(test)]
mod tests {
    use super::normalize_candidate_url;

    #[test]
    fn accepts_scheme_less_urls_with_free_form_paths() {
        for (raw, expected) in [
            (
                "google.com/maps/place/Prague+Castle/@50.0910,14.4016,17z/data=!3m1!4b1!4m6",
                "https://google.com/maps/place/Prague+Castle/@50.0910,14.4016,17z/data=!3m1!4b1!4m6",
            ),
            (
                "google.com/maps/search/prague+castle/@50.0910,14.4016,15z",
                "https://google.com/maps/search/prague+castle/@50.0910,14.4016,15z",
            ),
            (
                "google.com/maps/place/Pražský+hrad",
                "https://google.com/maps/place/Pražský+hrad",
            ),
            (
                "google.com/search?q=prague+castle&sca_esv=abc",
                "https://google.com/search?q=prague+castle&sca_esv=abc",
            ),
            (
                "mail.google.com/mail/u/0/#inbox",
                "https://mail.google.com/mail/u/0/#inbox",
            ),
            (
                "drive.google.com/drive/my-drive",
                "https://drive.google.com/drive/my-drive",
            ),
            ("localhost.test:5173", "https://localhost.test:5173"),
        ] {
            assert_eq!(normalize_candidate_url(raw).as_deref(), Some(expected), "{raw}");
        }
    }

    #[test]
    fn rejects_search_text_and_non_hosts() {
        for raw in ["prague castle", "foo", "foo/bar.baz", "", "about:blank", "ex!ample.com/x"] {
            assert_eq!(normalize_candidate_url(raw), None, "{raw}");
        }
    }
}
