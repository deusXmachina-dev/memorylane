use windows::Win32::System::Threading::{
    OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
};

const PARENT_PID_ARG: &str = "--parent-pid=";

/// Exit when the parent process dies. Installers terminate the Electron main
/// process without warning; a surviving watcher keeps a handle inside the
/// install directory and forces MSI to defer file replacement to a reboot.
pub fn spawn_parent_watchdog() {
    let Some(pid) = std::env::args().find_map(|arg| {
        arg.strip_prefix(PARENT_PID_ARG)
            .and_then(|v| v.parse::<u32>().ok())
    }) else {
        return;
    };

    std::thread::spawn(move || {
        let parent = match unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) } {
            Ok(handle) => handle,
            Err(_) => std::process::exit(0),
        };
        unsafe {
            let _ = WaitForSingleObject(parent, INFINITE);
        }
        std::process::exit(0);
    });
}
