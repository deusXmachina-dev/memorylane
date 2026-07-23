mod browser_url;
mod hooks;
mod output;
mod parent_watch;
mod snapshot;
mod state;
mod time;
mod types;
mod win32_window;

use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Accessibility::UnhookWinEvent;
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

use crate::hooks::{install_hooks, run_message_loop};
use crate::output::{emit_error_event, emit_json_line, emit_window_event};
use crate::time::now_ms;
use crate::win32_window::hwnd_is_valid;

fn main() {
    parent_watch::spawn_parent_watchdog();

    let com_init_result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let com_needs_uninit = com_init_result.is_ok();
    let _com_available = com_needs_uninit || com_init_result == RPC_E_CHANGED_MODE;

    emit_json_line(&serde_json::json!({
        "type": "ready",
        "timestamp": now_ms(),
    }));

    let initial_hwnd = unsafe { GetForegroundWindow() };
    if hwnd_is_valid(initial_hwnd) {
        emit_window_event("app_change", initial_hwnd);
    }

    let hooks = match install_hooks() {
        Ok(hooks) => hooks,
        Err(error) => {
            emit_error_event(&error);
            std::process::exit(1);
        }
    };

    run_message_loop();

    unsafe {
        let _ = UnhookWinEvent(hooks.0);
        let _ = UnhookWinEvent(hooks.1);
    }

    if com_needs_uninit {
        unsafe {
            CoUninitialize();
        }
    }
}
