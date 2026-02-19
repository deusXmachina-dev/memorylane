import Cocoa
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

setbuf(stdout, nil)
setbuf(stderr, nil)

enum ScreenshotError: Error {
    case invalidArguments(String)
    case displayNotFound(UInt32)
    case captureFailed(String)
    case saveFailed(String)
    case windowNotFound(String)
}

func emitJSON(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let json = String(data: data, encoding: .utf8) else {
        fputs("Failed to encode JSON payload\n", stderr)
        exit(1)
    }
    print(json)
}

func fail(_ message: String, exitCode: Int32 = 1) -> Never {
    fputs("\(message)\n", stderr)
    exit(exitCode)
}

func parseOptions(_ args: [String]) throws -> [String: String] {
    var options: [String: String] = [:]
    var i = 0

    while i < args.count {
        let key = args[i]
        guard key.hasPrefix("--") else {
            throw ScreenshotError.invalidArguments("Unexpected argument: \(key)")
        }
        guard i + 1 < args.count else {
            throw ScreenshotError.invalidArguments("Missing value for option: \(key)")
        }
        options[key] = args[i + 1]
        i += 2
    }

    return options
}

func ensureOutputDirectory(for outputPath: String) throws {
    let outputURL = URL(fileURLWithPath: outputPath)
    let directoryURL = outputURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(
        at: directoryURL,
        withIntermediateDirectories: true
    )
}

func writePNG(_ image: CGImage, to outputPath: String) throws {
    try ensureOutputDirectory(for: outputPath)

    let outputURL = URL(fileURLWithPath: outputPath)
    guard let destination = CGImageDestinationCreateWithURL(
        outputURL as CFURL,
        UTType.png.identifier as CFString,
        1,
        nil
    ) else {
        throw ScreenshotError.saveFailed("Could not create PNG destination for \(outputPath)")
    }

    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw ScreenshotError.saveFailed("Could not finalize PNG write to \(outputPath)")
    }
}

func resolveDisplayId(_ requestedDisplayId: UInt32?) throws -> CGDirectDisplayID {
    if let requestedDisplayId {
        var displayCount: UInt32 = 0
        CGGetOnlineDisplayList(0, nil, &displayCount)
        var displayIds = Array(repeating: CGDirectDisplayID(), count: Int(displayCount))
        CGGetOnlineDisplayList(displayCount, &displayIds, &displayCount)

        if displayIds.contains(requestedDisplayId) {
            return requestedDisplayId
        }

        throw ScreenshotError.displayNotFound(requestedDisplayId)
    }

    return CGMainDisplayID()
}

func captureScreen(outputPath: String, requestedDisplayId: UInt32?) throws -> [String: Any] {
    let displayId = try resolveDisplayId(requestedDisplayId)

    guard let image = CGDisplayCreateImage(displayId) else {
        throw ScreenshotError.captureFailed("Could not capture display \(displayId)")
    }

    try writePNG(image, to: outputPath)

    return [
        "status": "ok",
        "mode": "screen",
        "filepath": outputPath,
        "width": image.width,
        "height": image.height,
        "displayId": Int(displayId),
    ]
}

func captureWindow(outputPath: String, title: String) throws -> [String: Any] {
    guard let rawWindowInfo = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID),
          let windowInfos = rawWindowInfo as? [[String: Any]] else {
        throw ScreenshotError.captureFailed("Could not list windows")
    }

    let exactMatch = windowInfos.first { info in
        guard let name = info[kCGWindowName as String] as? String, name == title else {
            return false
        }

        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
        return layer == 0 && alpha > 0
    } ?? windowInfos.first { info in
        guard let name = info[kCGWindowName as String] as? String else {
            return false
        }
        return name == title
    }

    guard let matchedWindow = exactMatch else {
        throw ScreenshotError.windowNotFound(title)
    }

    guard let windowNumber = matchedWindow[kCGWindowNumber as String] as? Int else {
        throw ScreenshotError.captureFailed("Matched window did not include a valid window number")
    }

    let windowId = CGWindowID(windowNumber)
    guard let image = CGWindowListCreateImage(
        .null,
        [.optionIncludingWindow],
        windowId,
        [.boundsIgnoreFraming, .bestResolution]
    ) else {
        throw ScreenshotError.captureFailed("Could not capture window \(windowNumber) (\(title))")
    }

    try writePNG(image, to: outputPath)

    return [
        "status": "ok",
        "mode": "window",
        "filepath": outputPath,
        "width": image.width,
        "height": image.height,
        "windowId": windowNumber,
        "title": title,
    ]
}

let usage = """
Usage:
  screenshot.swift screen --output <path> [--display-id <id>]
  screenshot.swift window --output <path> --title <window title>
"""

do {
    let args = Array(CommandLine.arguments.dropFirst())
    guard let mode = args.first else {
        throw ScreenshotError.invalidArguments(usage)
    }

    let options = try parseOptions(Array(args.dropFirst()))

    switch mode {
    case "screen":
        guard let outputPath = options["--output"], !outputPath.isEmpty else {
            throw ScreenshotError.invalidArguments("Missing required --output for screen mode")
        }

        let requestedDisplayId: UInt32?
        if let displayIdRaw = options["--display-id"] {
            guard let parsed = UInt32(displayIdRaw) else {
                throw ScreenshotError.invalidArguments("Invalid --display-id value: \(displayIdRaw)")
            }
            requestedDisplayId = parsed
        } else {
            requestedDisplayId = nil
        }

        emitJSON(try captureScreen(outputPath: outputPath, requestedDisplayId: requestedDisplayId))

    case "window":
        guard let outputPath = options["--output"], !outputPath.isEmpty else {
            throw ScreenshotError.invalidArguments("Missing required --output for window mode")
        }
        guard let title = options["--title"], !title.isEmpty else {
            throw ScreenshotError.invalidArguments("Missing required --title for window mode")
        }

        do {
            emitJSON(try captureWindow(outputPath: outputPath, title: title))
        } catch ScreenshotError.windowNotFound(let missingTitle) {
            emitJSON([
                "status": "not_found",
                "mode": "window",
                "title": missingTitle,
            ])
            exit(0)
        }

    default:
        throw ScreenshotError.invalidArguments("Unknown mode: \(mode)\n\(usage)")
    }
} catch ScreenshotError.invalidArguments(let message) {
    fail(message, exitCode: 2)
} catch ScreenshotError.displayNotFound(let displayId) {
    fail("Display not found: \(displayId)")
} catch ScreenshotError.captureFailed(let message) {
    fail(message)
} catch ScreenshotError.saveFailed(let message) {
    fail(message)
} catch ScreenshotError.windowNotFound(let title) {
    fail("Window not found: \(title)", exitCode: 3)
} catch {
    fail("Unexpected error: \(error)")
}
