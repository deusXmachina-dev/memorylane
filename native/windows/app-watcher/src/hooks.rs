use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetForegroundWindow, GetMessageW, TranslateMessage, EVENT_OBJECT_NAMECHANGE,
    EVENT_SYSTEM_FOREGROUND, MSG, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

use crate::output::emit_window_event;
use crate::win32_window::hwnd_is_valid;

const CHILD_ID_SELF: i32 = 0;
const OBJ_ID_WINDOW: i32 = 0;

unsafe extern "system" fn win_event_callback(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _event_thread: u32,
    event_time: u32,
) {
    if !hwnd_is_valid(hwnd) {
        return;
    }
    if id_object != OBJ_ID_WINDOW || id_child != CHILD_ID_SELF {
        return;
    }

    let foreground_hwnd = GetForegroundWindow();
    if !hwnd_is_valid(foreground_hwnd) {
        return;
    }

    let event_type = if event == EVENT_SYSTEM_FOREGROUND {
        "app_change"
    } else if event == EVENT_OBJECT_NAMECHANGE {
        if foreground_hwnd.0 != hwnd.0 {
            return;
        }
        "window_change"
    } else {
        return;
    };

    emit_window_event(event_type, hwnd, event_time);
}

pub fn install_hooks() -> Result<(HWINEVENTHOOK, HWINEVENTHOOK), String> {
    let foreground_hook = unsafe {
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(win_event_callback),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        )
    };
    if foreground_hook.0.is_null() {
        return Err("Failed to install EVENT_SYSTEM_FOREGROUND hook".to_string());
    }

    let title_hook = unsafe {
        SetWinEventHook(
            EVENT_OBJECT_NAMECHANGE,
            EVENT_OBJECT_NAMECHANGE,
            None,
            Some(win_event_callback),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        )
    };
    if title_hook.0.is_null() {
        unsafe {
            let _ = UnhookWinEvent(foreground_hook);
        }
        return Err("Failed to install EVENT_OBJECT_NAMECHANGE hook".to_string());
    }

    Ok((foreground_hook, title_hook))
}

pub fn run_message_loop() {
    let mut msg = MSG::default();
    unsafe {
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            let _ = TranslateMessage(&msg);
            let _ = DispatchMessageW(&msg);
        }
    }
}
