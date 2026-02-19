import Cocoa
import CoreGraphics
import ImageIO

// screenshot - Native macOS screen capture utility
//
// Single mode: screenshot <output-path> [--format png|jpg] [--display <id>]
// Window mode: screenshot <output-path> --window-title "title" [--format png|jpg]
// Stream mode: screenshot --stream [--format png|jpg] [--display <id>]
//   Reads output paths from stdin (one per line), writes JSON results to stdout.

let args = CommandLine.arguments

// -- Parse options --------------------------------------------------------

var format = "png"
if let idx = args.firstIndex(of: "--format"), idx + 1 < args.count {
    format = args[idx + 1].lowercased()
}

var displayId: CGDirectDisplayID = CGMainDisplayID()
if let idx = args.firstIndex(of: "--display"), idx + 1 < args.count {
    if let id = UInt32(args[idx + 1]) {
        displayId = id
    }
}

var windowTitle: String? = nil
if let idx = args.firstIndex(of: "--window-title"), idx + 1 < args.count {
    windowTitle = args[idx + 1]
}

let utType: CFString = format == "jpg"
    ? ("public.jpeg" as CFString)
    : ("public.png" as CFString)

// -- Capture functions ----------------------------------------------------

func captureAndSave(outputPath: String) -> Bool {
    let start = CFAbsoluteTimeGetCurrent()

    guard let image = CGDisplayCreateImage(displayId) else {
        fputs("{\"error\":\"capture_failed\",\"path\":\"\(jsonEscape(outputPath))\"}\n", stderr)
        return false
    }

    return saveImage(image, outputPath: outputPath, start: start)
}

func captureWindowAndSave(title: String, outputPath: String) -> Bool {
    let start = CFAbsoluteTimeGetCurrent()

    // Find the window by title using CGWindowListCopyWindowInfo
    guard let windowList = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        print("{\"error\":\"window_list_failed\"}")
        fflush(stdout)
        return false
    }

    var windowId: CGWindowID? = nil
    for window in windowList {
        guard let name = window[kCGWindowName as String] as? String,
              let id = window[kCGWindowNumber as String] as? CGWindowID,
              let layer = window[kCGWindowLayer as String] as? Int,
              layer == 0 else { continue }

        if name == title {
            windowId = id
            break
        }
    }

    guard let wid = windowId else {
        print("{\"error\":\"window_not_found\",\"title\":\"\(jsonEscape(title))\"}")
        fflush(stdout)
        return false
    }

    guard let image = CGWindowListCreateImage(.null, .optionIncludingWindow, wid, [.boundsIgnoreFraming, .bestResolution]) else {
        print("{\"error\":\"window_capture_failed\",\"title\":\"\(jsonEscape(title))\"}")
        fflush(stdout)
        return false
    }

    return saveImage(image, outputPath: outputPath, start: start)
}

func saveImage(_ image: CGImage, outputPath: String, start: CFAbsoluteTime) -> Bool {
    let url = URL(fileURLWithPath: outputPath)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, utType, 1, nil) else {
        fputs("{\"error\":\"dest_create_failed\",\"path\":\"\(jsonEscape(outputPath))\"}\n", stderr)
        return false
    }

    var properties: CFDictionary? = nil
    if format == "jpg" {
        properties = [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary
    }

    CGImageDestinationAddImage(dest, image, properties)
    guard CGImageDestinationFinalize(dest) else {
        fputs("{\"error\":\"write_failed\",\"path\":\"\(jsonEscape(outputPath))\"}\n", stderr)
        return false
    }

    let elapsedMs = (CFAbsoluteTimeGetCurrent() - start) * 1000
    let w = image.width
    let h = image.height
    print("{\"width\":\(w),\"height\":\(h),\"elapsed_ms\":\(String(format: "%.2f", elapsedMs)),\"path\":\"\(jsonEscape(outputPath))\"}")
    fflush(stdout)
    return true
}

func jsonEscape(_ s: String) -> String {
    return s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
}

// -- Main -----------------------------------------------------------------

let isStream = args.contains("--stream")

if isStream {
    // Stream mode: read output paths from stdin, one per line
    while let line = readLine() {
        let outputPath = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if outputPath.isEmpty { continue }
        _ = captureAndSave(outputPath: outputPath)
    }
} else if let title = windowTitle {
    // Window capture mode
    let positionalArgs = args.dropFirst().filter { !$0.hasPrefix("--") }

    var flagValues = Set<String>()
    for (i, arg) in args.enumerated() {
        if (arg == "--format" || arg == "--display" || arg == "--window-title"), i + 1 < args.count {
            flagValues.insert(args[i + 1])
        }
    }

    guard let outputPath = positionalArgs.first(where: { !flagValues.contains($0) }) else {
        fputs("Usage: screenshot <output-path> --window-title \"title\" [--format png|jpg]\n", stderr)
        exit(1)
    }

    if !captureWindowAndSave(title: title, outputPath: outputPath) {
        exit(1)
    }
} else {
    // Single mode: first non-flag argument is the output path
    let positionalArgs = args.dropFirst().filter { !$0.hasPrefix("--") }

    // Skip values that follow a flag (e.g. --format png)
    var flagValues = Set<String>()
    for (i, arg) in args.enumerated() {
        if (arg == "--format" || arg == "--display"), i + 1 < args.count {
            flagValues.insert(args[i + 1])
        }
    }

    guard let outputPath = positionalArgs.first(where: { !flagValues.contains($0) }) else {
        fputs("Usage: screenshot <output-path> [--format png|jpg] [--display <id>]\n", stderr)
        fputs("       screenshot --stream [--format png|jpg] [--display <id>]\n", stderr)
        fputs("       screenshot <output-path> --window-title \"title\" [--format png|jpg]\n", stderr)
        exit(1)
    }

    if !captureAndSave(outputPath: outputPath) {
        exit(1)
    }
}
