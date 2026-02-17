import Cocoa
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import VideoToolbox

// Flush stdout after every write
setbuf(stdout, nil)

// MARK: - Helpers

func emit(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          let json = String(data: data, encoding: .utf8) else { return }
    print(json)
}

func nowMs() -> Int64 {
    return Int64(Date().timeIntervalSince1970 * 1000)
}

// MARK: - CLI argument parsing

struct Config {
    var outputPath: String
    var width: Int = 1280
    var height: Int = 720
    var fps: Int = 5
    var displayID: UInt32? = nil
}

func parseArgs() -> Config? {
    let args = CommandLine.arguments
    guard args.count >= 2 else {
        emit(["status": "error", "message": "Usage: screen-recorder <output-path> [--width N] [--height N] [--fps N] [--display ID]", "timestamp": nowMs()])
        return nil
    }

    var config = Config(outputPath: args[1])
    var i = 2
    while i < args.count {
        switch args[i] {
        case "--width":
            i += 1; if i < args.count { config.width = Int(args[i]) ?? config.width }
        case "--height":
            i += 1; if i < args.count { config.height = Int(args[i]) ?? config.height }
        case "--fps":
            i += 1; if i < args.count { config.fps = Int(args[i]) ?? config.fps }
        case "--display":
            i += 1; if i < args.count { config.displayID = UInt32(args[i]) }
        default:
            break
        }
        i += 1
    }
    return config
}

// MARK: - Screen Recorder

class ScreenRecorder: NSObject, SCStreamOutput {
    private let config: Config
    private var stream: SCStream?
    private var assetWriter: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var startTime: CMTime?
    private var started = false
    private var stopping = false

    init(config: Config) {
        self.config = config
    }

    func start() async {
        do {
            // Get available content
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

            // Find the target display
            guard let display = findDisplay(in: content) else {
                emit(["status": "error", "message": "No matching display found", "timestamp": nowMs()])
                exit(1)
            }

            // Configure stream
            let streamConfig = SCStreamConfiguration()
            streamConfig.width = config.width
            streamConfig.height = config.height
            streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(config.fps))
            streamConfig.pixelFormat = kCVPixelFormatType_32BGRA
            streamConfig.showsCursor = true
            streamConfig.queueDepth = 5

            // Create filter for the target display
            let filter = SCContentFilter(display: display, excludingWindows: [])

            // Set up AVAssetWriter
            let outputURL = URL(fileURLWithPath: config.outputPath)
            assetWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)

            let videoSettings: [String: Any] = [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: config.width,
                AVVideoHeightKey: config.height,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: 1_000_000,
                    AVVideoProfileLevelKey: AVVideoProfileLevelH264BaselineAutoLevel,
                    AVVideoExpectedSourceFrameRateKey: config.fps,
                ],
            ]

            videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
            videoInput!.expectsMediaDataInRealTime = true

            assetWriter!.add(videoInput!)
            assetWriter!.startWriting()
            assetWriter!.startSession(atSourceTime: .zero)

            // Start capture
            stream = SCStream(filter: filter, configuration: streamConfig, delegate: nil)
            try stream!.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue(label: "screen-recorder"))
            try await stream!.startCapture()

            started = true
            emit(["status": "recording", "timestamp": nowMs()])

        } catch {
            emit(["status": "error", "message": error.localizedDescription, "timestamp": nowMs()])
            exit(1)
        }
    }

    func stop() {
        guard started, !stopping else { return }
        stopping = true

        Task {
            // Stop the stream
            if let stream = stream {
                try? await stream.stopCapture()
            }

            // Finalize the asset writer
            videoInput?.markAsFinished()

            guard let writer = assetWriter else {
                emit(["status": "error", "message": "No asset writer", "timestamp": nowMs()])
                exit(1)
            }

            await writer.finishWriting()

            if writer.status == .completed {
                emit([
                    "status": "stopped",
                    "filepath": config.outputPath,
                    "timestamp": nowMs(),
                ])
            } else {
                emit([
                    "status": "error",
                    "message": writer.error?.localizedDescription ?? "Unknown write error",
                    "timestamp": nowMs(),
                ])
            }

            exit(0)
        }
    }

    private func findDisplay(in content: SCShareableContent) -> SCDisplay? {
        if let targetID = config.displayID {
            return content.displays.first { $0.displayID == targetID }
        }
        // Default to main display
        return content.displays.first { $0.displayID == CGMainDisplayID() }
            ?? content.displays.first
    }

    // MARK: - SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, started, !stopping else { return }
        guard let videoInput = videoInput, videoInput.isReadyForMoreMediaData else { return }

        // Retime sample buffers relative to first frame
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if startTime == nil {
            startTime = pts
        }

        let adjustedPTS = CMTimeSubtract(pts, startTime!)

        // Create a retimed copy of the sample buffer
        var timingInfo = CMSampleTimingInfo(
            duration: CMSampleBufferGetDuration(sampleBuffer),
            presentationTimeStamp: adjustedPTS,
            decodeTimeStamp: .invalid
        )

        var retimedBuffer: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(
            allocator: kCFAllocatorDefault,
            sampleBuffer: sampleBuffer,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timingInfo,
            sampleBufferOut: &retimedBuffer
        )

        if let buffer = retimedBuffer {
            videoInput.append(buffer)
        }
    }
}

// MARK: - Main

guard let config = parseArgs() else {
    exit(1)
}

let recorder = ScreenRecorder(config: config)

// Start recording
Task {
    await recorder.start()
}

// Listen for stop signal on stdin (newline)
DispatchQueue.global().async {
    while let line = readLine() {
        _ = line
        recorder.stop()
        break
    }
    // stdin closed — also stop
    recorder.stop()
}

// Keep alive
RunLoop.main.run()
