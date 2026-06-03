use std::time::{SystemTime, UNIX_EPOCH};
use windows::Win32::System::SystemInformation::GetTickCount;

pub fn now_ms() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as u64,
        Err(_) => 0,
    }
}

/// Convert a WinEvent `dwmsEventTime` (the OS tick-count, in ms since boot, of
/// when the event was generated) into a wall-clock Unix timestamp in ms.
///
/// We do this so an `app_change` boundary reflects when the foreground switch
/// actually happened rather than when we finished reading the window's title,
/// process, bounds, and URL. `GetTickCount` shares the same 32-bit tick domain
/// as `dwmsEventTime`, so `wrapping_sub` yields the correct elapsed time across
/// the ~49.7-day counter wrap. A bogus/zero event time falls back to now.
pub fn event_time_to_wall_ms(event_time_ticks: u32) -> u64 {
    let now_ticks = unsafe { GetTickCount() };
    let elapsed_ms = now_ticks.wrapping_sub(event_time_ticks) as u64;
    if elapsed_ms > 60_000 {
        return now_ms();
    }
    now_ms().saturating_sub(elapsed_ms)
}
