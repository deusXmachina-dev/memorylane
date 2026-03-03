use image::codecs::jpeg::JpegEncoder;
use image::{imageops::FilterType, DynamicImage, GenericImageView, ImageBuffer, Rgba};
use serde::Serialize;
use serde_json::Value;
use std::ffi::c_void;
use std::fs::{self, File};
use std::io::{self, BufRead, BufWriter, Write};
use std::mem::size_of;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    GetMonitorInfoW, MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HGDIOBJ, MONITORINFO, MONITOR_DEFAULTTOPRIMARY, SRCCOPY,
};
use windows::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};

#[derive(Clone, Copy, Debug, Serialize)]
struct DisplayBounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Clone, Debug)]
struct CaptureTarget {
    display_id: i64,
    display_bounds: DisplayBounds,
}

#[derive(Clone, Copy, Debug)]
enum OutputFormat {
    Jpeg,
    Png,
}

#[derive(Clone, Debug)]
struct DaemonConfig {
    output_dir: PathBuf,
    interval_ms: u64,
    max_dimension: Option<u32>,
    format: OutputFormat,
    quality: u8,
    initial_target: Option<CaptureTarget>,
}

#[derive(Clone, Debug)]
struct SharedState {
    interval_ms: u64,
    target: CaptureTarget,
}

#[derive(Serialize)]
struct FrameEvent {
    filepath: String,
    timestamp: u64,
    width: u32,
    height: u32,
    #[serde(rename = "displayId")]
    display_id: i64,
}

fn now_ms() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as u64,
        Err(_) => 0,
    }
}

fn emit_json_line<T: Serialize>(value: &T) {
    let mut stdout = io::stdout().lock();
    if serde_json::to_writer(&mut stdout, value).is_ok() {
        let _ = stdout.write_all(b"\n");
        let _ = stdout.flush();
    }
}

fn log_error(message: &str) {
    eprintln!("[screenshot-capturer] {message}");
}

fn parse_positive_u64(value: &str, flag: &str) -> Result<u64, String> {
    let parsed = value
        .parse::<u64>()
        .map_err(|_| format!("Invalid value for {flag}: {value}"))?;
    if parsed == 0 {
        return Err(format!("{flag} must be greater than zero"));
    }
    Ok(parsed)
}

fn parse_i32(value: &str, flag: &str) -> Result<i32, String> {
    value
        .parse::<i32>()
        .map_err(|_| format!("Invalid value for {flag}: {value}"))
}

fn parse_i64(value: &str, flag: &str) -> Result<i64, String> {
    value
        .parse::<i64>()
        .map_err(|_| format!("Invalid value for {flag}: {value}"))
}

fn parse_output_format(value: &str) -> Result<OutputFormat, String> {
    match value {
        "jpeg" | "jpg" => Ok(OutputFormat::Jpeg),
        "png" => Ok(OutputFormat::Png),
        other => Err(format!("Unsupported image format: {other}")),
    }
}

fn parse_args() -> Result<DaemonConfig, String> {
    let args: Vec<String> = std::env::args().collect();

    let mut output_dir: Option<PathBuf> = None;
    let mut interval_ms = 1000_u64;
    let mut max_dimension: Option<u32> = None;
    let mut format = OutputFormat::Jpeg;
    let mut quality = 80_u8;
    let mut display_id: Option<i64> = None;
    let mut x: Option<i32> = None;
    let mut y: Option<i32> = None;
    let mut width: Option<i32> = None;
    let mut height: Option<i32> = None;

    let mut i = 1_usize;
    while i < args.len() {
        let flag = args[i].as_str();
        i += 1;
        if i >= args.len() {
            return Err(format!("Missing value for {flag}"));
        }

        match flag {
            "--outputDir" => output_dir = Some(PathBuf::from(&args[i])),
            "--intervalMs" => interval_ms = parse_positive_u64(&args[i], flag)?,
            "--maxDimension" => {
                let parsed = parse_positive_u64(&args[i], flag)?;
                max_dimension = Some(u32::try_from(parsed).map_err(|_| {
                    format!("{flag} is too large to fit into a 32-bit dimension: {parsed}")
                })?)
            }
            "--format" => format = parse_output_format(&args[i])?,
            "--quality" => {
                let parsed = parse_positive_u64(&args[i], flag)?;
                if parsed > 100 {
                    return Err("--quality must be between 1 and 100".to_string());
                }
                quality = parsed as u8;
            }
            "--displayId" => display_id = Some(parse_i64(&args[i], flag)?),
            "--x" => x = Some(parse_i32(&args[i], flag)?),
            "--y" => y = Some(parse_i32(&args[i], flag)?),
            "--width" => width = Some(parse_i32(&args[i], flag)?),
            "--height" => height = Some(parse_i32(&args[i], flag)?),
            other => return Err(format!("Unknown argument: {other}")),
        }
        i += 1;
    }

    let output_dir = output_dir.ok_or_else(|| "--outputDir is required".to_string())?;

    let initial_target = match (display_id, x, y, width, height) {
        (Some(display_id), Some(x), Some(y), Some(width), Some(height)) => {
            if width <= 0 || height <= 0 {
                return Err("Initial display bounds must be positive".to_string());
            }
            Some(CaptureTarget {
                display_id,
                display_bounds: DisplayBounds {
                    x,
                    y,
                    width,
                    height,
                },
            })
        }
        (None, None, None, None, None) => None,
        _ => {
            return Err(
                "Initial display target requires --displayId, --x, --y, --width, and --height"
                    .to_string(),
            )
        }
    };

    Ok(DaemonConfig {
        output_dir,
        interval_ms,
        max_dimension,
        format,
        quality,
        initial_target,
    })
}

fn resolve_primary_target() -> Result<CaptureTarget, String> {
    unsafe {
        let monitor = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        if monitor.is_invalid() {
            return Err("Could not resolve primary monitor".to_string());
        }

        let mut info = MONITORINFO::default();
        info.cbSize = size_of::<MONITORINFO>() as u32;
        if !GetMonitorInfoW(monitor, &mut info as *mut MONITORINFO as *mut _).as_bool() {
            return Err("GetMonitorInfoW failed for primary monitor".to_string());
        }

        let rect = info.rcMonitor;
        let width = rect.right.saturating_sub(rect.left);
        let height = rect.bottom.saturating_sub(rect.top);
        if width <= 0 || height <= 0 {
            return Err("Primary monitor reported invalid bounds".to_string());
        }

        Ok(CaptureTarget {
            display_id: 0,
            display_bounds: DisplayBounds {
                x: rect.left,
                y: rect.top,
                width,
                height,
            },
        })
    }
}

fn parse_command_display_bounds(value: &Value) -> Result<DisplayBounds, String> {
    let x = value
        .get("x")
        .and_then(Value::as_i64)
        .ok_or_else(|| "displayBounds.x is required".to_string())?;
    let y = value
        .get("y")
        .and_then(Value::as_i64)
        .ok_or_else(|| "displayBounds.y is required".to_string())?;
    let width = value
        .get("width")
        .and_then(Value::as_i64)
        .ok_or_else(|| "displayBounds.width is required".to_string())?;
    let height = value
        .get("height")
        .and_then(Value::as_i64)
        .ok_or_else(|| "displayBounds.height is required".to_string())?;

    let x = i32::try_from(x).map_err(|_| "displayBounds.x is out of range".to_string())?;
    let y = i32::try_from(y).map_err(|_| "displayBounds.y is out of range".to_string())?;
    let width =
        i32::try_from(width).map_err(|_| "displayBounds.width is out of range".to_string())?;
    let height =
        i32::try_from(height).map_err(|_| "displayBounds.height is out of range".to_string())?;

    if width <= 0 || height <= 0 {
        return Err("displayBounds must have positive width and height".to_string());
    }

    Ok(DisplayBounds {
        x,
        y,
        width,
        height,
    })
}

fn apply_command(line: &str, shared_state: &Arc<Mutex<SharedState>>) -> Result<(), String> {
    let value: Value = serde_json::from_str(line)
        .map_err(|error| format!("Invalid JSON command: {line} ({error})"))?;

    let mut state = shared_state
        .lock()
        .map_err(|_| "Shared state mutex was poisoned".to_string())?;

    if let Some(interval_ms) = value.get("intervalMs").and_then(Value::as_u64) {
        if interval_ms == 0 {
            return Err("intervalMs must be greater than zero".to_string());
        }
        state.interval_ms = interval_ms;
    }

    let Some(display_id_value) = value.get("displayId") else {
        return Ok(());
    };

    if display_id_value.is_null() {
        state.target = resolve_primary_target()?;
        return Ok(());
    }

    let display_id = display_id_value
        .as_i64()
        .ok_or_else(|| "displayId must be an integer or null".to_string())?;

    let Some(display_bounds_value) = value.get("displayBounds") else {
        if state.target.display_id == display_id {
            return Ok(());
        }
        return Err(format!(
            "displayBounds is required when switching to displayId {display_id}"
        ));
    };

    if display_bounds_value.is_null() {
        if state.target.display_id == display_id {
            return Ok(());
        }
        return Err(format!(
            "displayBounds cannot be null when switching to displayId {display_id}"
        ));
    }

    state.target = CaptureTarget {
        display_id,
        display_bounds: parse_command_display_bounds(display_bounds_value)?,
    };

    Ok(())
}

fn capture_bitmap(bounds: DisplayBounds) -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String> {
    unsafe {
        let screen_dc = GetDC(Some(HWND::default()));
        if screen_dc.is_invalid() {
            return Err("GetDC failed".to_string());
        }

        let memory_dc = CreateCompatibleDC(Some(screen_dc));
        if memory_dc.is_invalid() {
            let _ = ReleaseDC(Some(HWND::default()), screen_dc);
            return Err("CreateCompatibleDC failed".to_string());
        }

        let bitmap = CreateCompatibleBitmap(screen_dc, bounds.width, bounds.height);
        if bitmap.is_invalid() {
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(Some(HWND::default()), screen_dc);
            return Err("CreateCompatibleBitmap failed".to_string());
        }

        let previous = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
        let result = (|| {
            if BitBlt(
                memory_dc,
                0,
                0,
                bounds.width,
                bounds.height,
                Some(screen_dc),
                bounds.x,
                bounds.y,
                SRCCOPY | CAPTUREBLT,
            )
            .is_err()
            {
                return Err("BitBlt failed".to_string());
            }

            let mut bitmap_info = BITMAPINFO::default();
            bitmap_info.bmiHeader = BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: bounds.width,
                biHeight: -bounds.height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            };

            let pixel_len = bounds
                .width
                .checked_mul(bounds.height)
                .and_then(|pixels| pixels.checked_mul(4))
                .ok_or_else(|| "Bitmap dimensions overflowed buffer size".to_string())?;
            let mut pixels = vec![0_u8; pixel_len as usize];

            let scan_lines = GetDIBits(
                memory_dc,
                bitmap,
                0,
                bounds.height as u32,
                Some(pixels.as_mut_ptr() as *mut c_void),
                &mut bitmap_info,
                DIB_RGB_COLORS,
            );
            if scan_lines == 0 {
                return Err("GetDIBits failed".to_string());
            }

            for pixel in pixels.chunks_exact_mut(4) {
                pixel.swap(0, 2);
            }

            ImageBuffer::<Rgba<u8>, Vec<u8>>::from_raw(
                bounds.width as u32,
                bounds.height as u32,
                pixels,
            )
            .ok_or_else(|| "Could not construct RGBA image buffer".to_string())
        })();

        let _ = SelectObject(memory_dc, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(Some(HWND::default()), screen_dc);

        result
    }
}

fn resize_if_needed(image: DynamicImage, max_dimension: Option<u32>) -> DynamicImage {
    let Some(max_dimension) = max_dimension else {
        return image;
    };

    if max_dimension == 0 {
        return image;
    }

    let width = image.width();
    let height = image.height();
    let longest_edge = width.max(height);
    if longest_edge <= max_dimension {
        return image;
    }

    let scale = max_dimension as f64 / longest_edge as f64;
    let target_width = ((width as f64 * scale).round() as u32).max(1);
    let target_height = ((height as f64 * scale).round() as u32).max(1);
    image.resize_exact(target_width, target_height, FilterType::Triangle)
}

fn write_image(
    image: &DynamicImage,
    output_path: &Path,
    format: OutputFormat,
    quality: u8,
) -> Result<(), String> {
    let file = File::create(output_path).map_err(|error| {
        format!(
            "Could not create output file {}: {error}",
            output_path.display()
        )
    })?;
    let mut writer = BufWriter::new(file);

    match format {
        OutputFormat::Jpeg => {
            let mut encoder = JpegEncoder::new_with_quality(&mut writer, quality);
            encoder
                .encode_image(image)
                .map_err(|error| format!("JPEG encode failed: {error}"))?;
        }
        OutputFormat::Png => {
            image
                .write_to(&mut writer, image::ImageFormat::Png)
                .map_err(|error| format!("PNG encode failed: {error}"))?;
        }
    }

    writer
        .flush()
        .map_err(|error| format!("Failed to flush output image: {error}"))?;
    Ok(())
}

fn capture_once(
    config: &DaemonConfig,
    shared_state: &Arc<Mutex<SharedState>>,
    sequence: &AtomicU64,
) -> Result<(), String> {
    let state = shared_state
        .lock()
        .map_err(|_| "Shared state mutex was poisoned".to_string())?
        .clone();

    let image = capture_bitmap(state.target.display_bounds)?;
    let resized = resize_if_needed(DynamicImage::ImageRgba8(image), config.max_dimension);
    let timestamp = now_ms();
    let sequence_number = sequence.fetch_add(1, Ordering::Relaxed);
    let extension = match config.format {
        OutputFormat::Jpeg => "jpg",
        OutputFormat::Png => "png",
    };
    let output_path = config
        .output_dir
        .join(format!("frame-{timestamp}-{sequence_number}.{extension}"));

    write_image(&resized, &output_path, config.format, config.quality)?;

    let (width, height) = resized.dimensions();
    emit_json_line(&FrameEvent {
        filepath: output_path.to_string_lossy().to_string(),
        timestamp,
        width,
        height,
        display_id: state.target.display_id,
    });

    Ok(())
}

fn sleep_for_interval(interval_ms: u64, running: &AtomicBool) {
    let interval = Duration::from_millis(interval_ms.max(1));
    let deadline = Instant::now() + interval;

    while running.load(Ordering::Relaxed) {
        let now = Instant::now();
        if now >= deadline {
            break;
        }

        let remaining = deadline.saturating_duration_since(now);
        let step = remaining.min(Duration::from_millis(50));
        thread::sleep(step);
    }
}

fn run_capture_loop(
    config: DaemonConfig,
    shared_state: Arc<Mutex<SharedState>>,
    running: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let sequence = AtomicU64::new(0);

        while running.load(Ordering::Relaxed) {
            if let Err(error) = capture_once(&config, &shared_state, &sequence) {
                log_error(&error);
            }

            let interval_ms = match shared_state.lock() {
                Ok(state) => state.interval_ms,
                Err(_) => {
                    log_error("Shared state mutex was poisoned");
                    break;
                }
            };
            sleep_for_interval(interval_ms, &running);
        }
    })
}

fn main() {
    if let Err(error) =
        unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) }
    {
        log_error(&format!("Could not set DPI awareness: {error}"));
    }

    let config = match parse_args() {
        Ok(config) => config,
        Err(error) => {
            log_error(&error);
            std::process::exit(1);
        }
    };

    if let Err(error) = fs::create_dir_all(&config.output_dir) {
        log_error(&format!(
            "Could not create output directory {}: {error}",
            config.output_dir.display()
        ));
        std::process::exit(1);
    }

    let initial_target = match config.initial_target.clone() {
        Some(target) => target,
        None => match resolve_primary_target() {
            Ok(target) => target,
            Err(error) => {
                log_error(&error);
                std::process::exit(1);
            }
        },
    };

    let shared_state = Arc::new(Mutex::new(SharedState {
        interval_ms: config.interval_ms,
        target: initial_target,
    }));
    let running = Arc::new(AtomicBool::new(true));
    let capture_thread = run_capture_loop(config, Arc::clone(&shared_state), Arc::clone(&running));

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        match line {
            Ok(line) => {
                if let Err(error) = apply_command(&line, &shared_state) {
                    log_error(&error);
                }
            }
            Err(error) => {
                log_error(&format!("Failed to read stdin: {error}"));
                break;
            }
        }
    }

    running.store(false, Ordering::Relaxed);
    let _ = capture_thread.join();
}
