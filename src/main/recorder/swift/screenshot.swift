import Cocoa
import CoreMedia
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

setbuf(stdout, nil)
setbuf(stderr, nil)

enum ScreenshotError: Error {
    case invalidArguments(String)
    case displayNotFound(UInt32)
    case captureFailed(String)
    case saveFailed(String)
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

// MARK: - CLI Argument Parsing

struct DaemonConfig {
    var outputDir: String
    var intervalMs: Int
    var maxDimension: Int?
    var format: String
    var quality: Int
}

func parseArgs() -> DaemonConfig {
    let args = CommandLine.arguments
    var outputDir: String? = nil
    var intervalMs = 1000
    var maxDimension: Int? = nil
    var format = "jpeg"
    var quality = 80

    var i = 1
    while i < args.count {
        switch args[i] {
        case "--outputDir":
            i += 1; guard i < args.count else { fail("Missing value for --outputDir") }
            outputDir = args[i]
        case "--intervalMs":
            i += 1; guard i < args.count, let v = Int(args[i]) else { fail("Invalid --intervalMs") }
            intervalMs = v
        case "--maxDimension":
            i += 1; guard i < args.count, let v = Int(args[i]) else { fail("Invalid --maxDimension") }
            maxDimension = v
        case "--format":
            i += 1; guard i < args.count else { fail("Missing value for --format") }
            format = args[i]
        case "--quality":
            i += 1; guard i < args.count, let v = Int(args[i]) else { fail("Invalid --quality") }
            quality = v
        default:
            fail("Unknown argument: \(args[i])")
        }
        i += 1
    }

    guard let dir = outputDir else {
        fail("--outputDir is required")
    }

    return DaemonConfig(
        outputDir: dir,
        intervalMs: intervalMs,
        maxDimension: maxDimension,
        format: format,
        quality: quality
    )
}

// MARK: - Image Writing

func writeImage(_ image: CGImage, to outputPath: String, format: String, quality: Int) throws {
    let outputURL = URL(fileURLWithPath: outputPath)

    let utType: UTType
    var properties: [CFString: Any]? = nil

    if format == "jpeg" {
        utType = .jpeg
        properties = [kCGImageDestinationLossyCompressionQuality: Double(quality) / 100.0]
    } else {
        utType = .png
    }

    guard let destination = CGImageDestinationCreateWithURL(
        outputURL as CFURL,
        utType.identifier as CFString,
        1,
        nil
    ) else {
        throw ScreenshotError.saveFailed("Could not create image destination for \(outputPath)")
    }

    CGImageDestinationAddImage(destination, image, properties as CFDictionary?)
    guard CGImageDestinationFinalize(destination) else {
        throw ScreenshotError.saveFailed("Could not finalize image write to \(outputPath)")
    }
}

func resizeIfNeeded(_ image: CGImage, maxDimension: Int?) throws -> CGImage {
    guard let maxDimension, maxDimension > 0 else {
        return image
    }

    let width = image.width
    let height = image.height
    let longestEdge = max(width, height)
    if longestEdge <= maxDimension {
        return image
    }

    let scale = Double(maxDimension) / Double(longestEdge)
    let targetWidth = max(1, Int((Double(width) * scale).rounded()))
    let targetHeight = max(1, Int((Double(height) * scale).rounded()))

    guard let context = CGContext(
        data: nil,
        width: targetWidth,
        height: targetHeight,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        throw ScreenshotError.captureFailed("Could not allocate resize context")
    }

    context.interpolationQuality = .medium
    context.draw(image, in: CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight))

    guard let resized = context.makeImage() else {
        throw ScreenshotError.captureFailed("Could not generate resized screenshot")
    }

    return resized
}

func listActiveDisplays() throws -> [CGDirectDisplayID] {
    var count: UInt32 = 0
    var status = CGGetActiveDisplayList(0, nil, &count)
    guard status == .success else {
        throw ScreenshotError.captureFailed("CGGetActiveDisplayList(count) failed: \(status.rawValue)")
    }

    guard count > 0 else {
        throw ScreenshotError.captureFailed("No active displays available")
    }

    var displays = Array(repeating: CGDirectDisplayID(), count: Int(count))
    status = CGGetActiveDisplayList(count, &displays, &count)
    guard status == .success else {
        throw ScreenshotError.captureFailed("CGGetActiveDisplayList(list) failed: \(status.rawValue)")
    }

    return Array(displays.prefix(Int(count)))
}

func resolveDisplayId(_ requestedDisplayId: UInt32?) throws -> CGDirectDisplayID {
    let displays = try listActiveDisplays()

    if let requestedDisplayId {
        if let display = displays.first(where: { $0 == requestedDisplayId }) {
            return display
        }
        throw ScreenshotError.displayNotFound(requestedDisplayId)
    }

    let mainDisplayId = CGMainDisplayID()
    if let mainDisplay = displays.first(where: { $0 == mainDisplayId }) {
        return mainDisplay
    }

    return displays[0]
}

// MARK: - Autonomous ScreenCaptureKit Daemon

class AutonomousCapture: NSObject, SCStreamOutput {
    private var stream: SCStream? = nil
    private var currentDisplayId: CGDirectDisplayID? = nil
    private var config: DaemonConfig
    private let ciContext = CIContext()
    private let captureQueue = DispatchQueue(label: "com.memorylane.screenshot.capture")
    private let writeQueue = DispatchQueue(label: "com.memorylane.screenshot.write")
    private let pendingWriteSemaphore = DispatchSemaphore(value: 1)
    private let stateQueue = DispatchQueue(label: "com.memorylane.screenshot.state")
    private var droppedFrameCount = 0

    init(config: DaemonConfig) {
        self.config = config
    }

    func startStream(displayId: CGDirectDisplayID? = nil) async throws {
        await stopStream()

        let resolvedDisplayId = try resolveDisplayId(displayId)
        let content = try await SCShareableContent.current
        guard let display = content.displays.first(where: { $0.displayID == resolvedDisplayId }) else {
            throw ScreenshotError.displayNotFound(resolvedDisplayId)
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])

        let streamConfig = SCStreamConfiguration()
        streamConfig.width = display.width * 2 // Retina
        streamConfig.height = display.height * 2
        streamConfig.minimumFrameInterval = CMTime(
            value: CMTimeValue(config.intervalMs),
            timescale: 1000
        )
        streamConfig.queueDepth = 2
        streamConfig.showsCursor = false
        streamConfig.pixelFormat = kCVPixelFormatType_32BGRA

        let newStream = SCStream(filter: filter, configuration: streamConfig, delegate: nil)
        try newStream.addStreamOutput(
            self,
            type: .screen,
            sampleHandlerQueue: captureQueue
        )
        try await newStream.startCapture()

        self.stream = newStream
        self.currentDisplayId = resolvedDisplayId
        fputs("[daemon] Stream started for display \(resolvedDisplayId) at \(config.intervalMs)ms interval\n", stderr)
    }

    func stopStream() async {
        if let stream = self.stream {
            try? await stream.stopCapture()
        }
        self.stream = nil
        self.currentDisplayId = nil
    }

    func updateIntervalMs(_ ms: Int) async {
        config.intervalMs = ms
        // Must recreate stream to change minimumFrameInterval
        if let displayId = currentDisplayId {
            do {
                try await startStream(displayId: displayId)
            } catch {
                fputs("[daemon] Failed to restart stream with new interval: \(error)\n", stderr)
            }
        }
    }

    func updateDisplayId(_ displayId: UInt32?) async {
        // Resolve first so we can compare against currentDisplayId
        let resolvedId: CGDirectDisplayID
        do {
            resolvedId = try resolveDisplayId(displayId)
        } catch {
            fputs("[daemon] Failed to resolve display: \(error)\n", stderr)
            return
        }

        if resolvedId == self.currentDisplayId {
            fputs("[daemon] Display \(resolvedId) already active, skipping stream restart\n", stderr)
            return
        }

        do {
            try await startStream(displayId: resolvedId)
        } catch {
            fputs("[daemon] Failed to switch display: \(error)\n", stderr)
        }
    }

    private func noteDroppedFrame() {
        stateQueue.sync {
            droppedFrameCount += 1
        }
    }

    private func takeDroppedFrameCount() -> Int {
        stateQueue.sync {
            let count = droppedFrameCount
            droppedFrameCount = 0
            return count
        }
    }

    // SCStreamOutput callback — called on each frame from ScreenCaptureKit
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen else { return }
        guard pendingWriteSemaphore.wait(timeout: .now()) == .success else {
            noteDroppedFrame()
            return
        }

        var shouldReleaseSemaphore = true
        defer {
            if shouldReleaseSemaphore {
                pendingWriteSemaphore.signal()
            }
        }

        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ciImage = CIImage(cvImageBuffer: imageBuffer)
        let width = CVPixelBufferGetWidth(imageBuffer)
        let height = CVPixelBufferGetHeight(imageBuffer)
        guard let cgImage = ciContext.createCGImage(ciImage, from: CGRect(x: 0, y: 0, width: width, height: height)) else {
            return
        }

        let displayId = self.currentDisplayId ?? CGMainDisplayID()
        let maxDimension = self.config.maxDimension
        let format = self.config.format
        let quality = self.config.quality
        let outputDir = self.config.outputDir
        let captureTimestamp = Int(Date().timeIntervalSince1970 * 1000)
        let droppedFrames = takeDroppedFrameCount()
        shouldReleaseSemaphore = false

        writeQueue.async {
            defer {
                self.pendingWriteSemaphore.signal()
            }

            let filename = "frame-\(captureTimestamp).jpg"
            let filepath = (outputDir as NSString).appendingPathComponent(filename)

            do {
                let resized = try resizeIfNeeded(cgImage, maxDimension: maxDimension)
                try writeImage(resized, to: filepath, format: format, quality: quality)

                if droppedFrames > 0 {
                    fputs("[daemon] Dropped \(droppedFrames) frame(s) while previous capture was still being written\n", stderr)
                }

                let payload: [String: Any] = [
                    "filepath": filepath,
                    "timestamp": captureTimestamp,
                    "width": resized.width,
                    "height": resized.height,
                    "displayId": Int(displayId),
                ]
                emitJSON(payload)
            } catch {
                fputs("[daemon] Frame write failed: \(error)\n", stderr)
            }
        }
    }
}

// MARK: - Stdin command listener

func listenForCommands(capture: AutonomousCapture) {
    DispatchQueue.global(qos: .utility).async {
        while let line = readLine(strippingNewline: true) {
            guard let data = line.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                fputs("[daemon] Invalid JSON on stdin: \(line)\n", stderr)
                continue
            }

            let newDisplayId = json["displayId"]
            let newIntervalMs = json["intervalMs"] as? Int

            Task {
                if let newIntervalMs {
                    await capture.updateIntervalMs(newIntervalMs)
                }

                if newDisplayId is NSNull {
                    // null = reset to main display
                    await capture.updateDisplayId(nil)
                } else if let id = newDisplayId as? UInt32 {
                    await capture.updateDisplayId(id)
                } else if let id = newDisplayId as? Int {
                    await capture.updateDisplayId(UInt32(id))
                }
            }
        }

        // stdin closed — clean shutdown
        Task {
            await capture.stopStream()
            exit(0)
        }
    }
}

// MARK: - Entry point

let config = parseArgs()

// Ensure output directory exists
try FileManager.default.createDirectory(
    atPath: config.outputDir,
    withIntermediateDirectories: true
)

let capture = AutonomousCapture(config: config)

let semaphore = DispatchSemaphore(value: 0)
Task {
    do {
        try await capture.startStream()
    } catch {
        fail("Failed to start capture stream: \(error)")
    }

    // Start listening for stdin commands
    listenForCommands(capture: capture)
}
semaphore.wait()
