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
    var initialOutputDir: String
    var width: Int = 1280
    var height: Int = 720
    var fps: Int = 5
}

func parseArgs() -> Config? {
    let args = CommandLine.arguments
    guard args.count >= 2 else {
        emit(["status": "error", "message": "Usage: screen-recorder <output-dir> [--width N] [--height N] [--fps N]", "timestamp": nowMs()])
        return nil
    }

    var config = Config(initialOutputDir: args[1])
    var i = 2
    while i < args.count {
        switch args[i] {
        case "--width":
            i += 1; if i < args.count { config.width = Int(args[i]) ?? config.width }
        case "--height":
            i += 1; if i < args.count { config.height = Int(args[i]) ?? config.height }
        case "--fps":
            i += 1; if i < args.count { config.fps = Int(args[i]) ?? config.fps }
        default:
            break
        }
        i += 1
    }
    return config
}

// MARK: - Per-display recorder

class DisplayRecorder: NSObject, SCStreamOutput {
    let displayID: UInt32
    let config: Config
    private var stream: SCStream?
    private let displayQueue: DispatchQueue

    private var assetWriter: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var outputPath: String = ""
    private var firstPTS: CMTime?
    private var segmentStartTimestamp: Int64 = 0
    private var started = false

    init(displayID: UInt32, config: Config) {
        self.displayID = displayID
        self.config = config
        self.displayQueue = DispatchQueue(label: "screen-recorder-display-\(displayID)")
    }

    func createWriter(outputPath: String) throws -> (AVAssetWriter, AVAssetWriterInput) {
        let outputURL = URL(fileURLWithPath: outputPath)
        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)

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

        let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        input.expectsMediaDataInRealTime = true

        writer.add(input)
        writer.startWriting()
        writer.startSession(atSourceTime: .zero)

        return (writer, input)
    }

    func startStream(display: SCDisplay) async throws {
        let initialFilename = "\(nowMs())_\(displayID).mp4"
        let initialPath = (config.initialOutputDir as NSString).appendingPathComponent(initialFilename)
        outputPath = initialPath
        segmentStartTimestamp = nowMs()

        let (writer, input) = try createWriter(outputPath: initialPath)
        assetWriter = writer
        videoInput = input

        let streamConfig = SCStreamConfiguration()
        streamConfig.width = config.width
        streamConfig.height = config.height
        streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(config.fps))
        streamConfig.pixelFormat = kCVPixelFormatType_32BGRA
        streamConfig.showsCursor = true
        streamConfig.queueDepth = 5

        let filter = SCContentFilter(display: display, excludingWindows: [])
        stream = SCStream(filter: filter, configuration: streamConfig, delegate: nil)
        try stream!.addStreamOutput(self, type: .screen, sampleHandlerQueue: displayQueue)
        try await stream!.startCapture()
        started = true
    }

    func split(newOutputPath: String) {
        displayQueue.async { [self] in
            guard started else { return }
            do {
                let (newWriter, newInput) = try createWriter(outputPath: newOutputPath)

                let oldWriter = assetWriter
                let oldInput = videoInput
                let oldPath = outputPath
                let segStart = segmentStartTimestamp

                // Atomic swap on the serial queue — new frames go to the new writer
                assetWriter = newWriter
                videoInput = newInput
                outputPath = newOutputPath
                firstPTS = nil
                segmentStartTimestamp = nowMs()

                // markAsFinished on the same queue where append() was called
                oldInput?.markAsFinished()

                // Finalize asynchronously — moov atom is written here
                guard let writer = oldWriter else { return }
                writer.finishWriting { [displayID] in
                    let endTs = nowMs()
                    if writer.status == .completed {
                        emit([
                            "status": "segment_complete",
                            "displayId": Int(displayID),
                            "filepath": oldPath,
                            "startTimestamp": segStart,
                            "endTimestamp": endTs,
                        ])
                    } else {
                        emit([
                            "status": "error",
                            "message": "Segment finalization failed (\(writer.status.rawValue)): \(writer.error?.localizedDescription ?? "unknown")",
                            "displayId": Int(displayID),
                            "timestamp": nowMs(),
                        ])
                    }
                }
            } catch {
                emit(["status": "error", "message": "Failed to create new writer for split: \(error.localizedDescription)", "timestamp": nowMs()])
            }
        }
    }

    func stop() async {
        started = false

        if let stream = stream {
            try? await stream.stopCapture()
        }

        // Finalize on displayQueue to serialize with any pending frame callbacks
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            displayQueue.async { [self] in
                let oldInput = videoInput
                let oldWriter = assetWriter
                let oldPath = outputPath
                let segStart = segmentStartTimestamp

                videoInput = nil
                assetWriter = nil

                oldInput?.markAsFinished()
                guard let writer = oldWriter else {
                    continuation.resume()
                    return
                }
                writer.finishWriting { [displayID] in
                    if writer.status == .completed {
                        emit([
                            "status": "segment_complete",
                            "displayId": Int(displayID),
                            "filepath": oldPath,
                            "startTimestamp": segStart,
                            "endTimestamp": nowMs(),
                        ])
                    } else {
                        emit([
                            "status": "error",
                            "message": "Final segment failed (\(writer.status.rawValue)): \(writer.error?.localizedDescription ?? "unknown")",
                            "displayId": Int(displayID),
                            "timestamp": nowMs(),
                        ])
                    }
                    continuation.resume()
                }
            }
        }
    }

    // MARK: - SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, started else { return }
        guard let videoInput = videoInput, videoInput.isReadyForMoreMediaData else { return }

        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if firstPTS == nil {
            firstPTS = pts
        }

        let adjustedPTS = CMTimeSubtract(pts, firstPTS!)

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

// MARK: - Coordinator

class RecordingCoordinator {
    let config: Config
    var displayRecorders: [UInt32: DisplayRecorder] = [:]

    init(config: Config) {
        self.config = config
    }

    func start() async {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

            guard !content.displays.isEmpty else {
                emit(["status": "error", "message": "No displays found", "timestamp": nowMs()])
                exit(1)
            }

            // Create output directory if needed
            let fm = FileManager.default
            if !fm.fileExists(atPath: config.initialOutputDir) {
                try fm.createDirectory(atPath: config.initialOutputDir, withIntermediateDirectories: true)
            }

            for display in content.displays {
                let recorder = DisplayRecorder(displayID: display.displayID, config: config)
                try await recorder.startStream(display: display)
                displayRecorders[display.displayID] = recorder
            }

            let displayIds = Array(displayRecorders.keys.map { Int($0) })
            emit(["status": "recording", "displays": displayIds, "timestamp": nowMs()])
        } catch {
            emit(["status": "error", "message": error.localizedDescription, "timestamp": nowMs()])
            exit(1)
        }
    }

    func split(displayId: UInt32, outputPath: String) {
        guard let recorder = displayRecorders[displayId] else {
            emit(["status": "error", "message": "No recorder for display \(displayId)", "timestamp": nowMs()])
            return
        }
        recorder.split(newOutputPath: outputPath)
    }

    func stop() async {
        for (_, recorder) in displayRecorders {
            await recorder.stop()
        }
        emit(["status": "stopped", "timestamp": nowMs()])
        exit(0)
    }
}

// MARK: - Stdin command handler

func handleStdinCommands(coordinator: RecordingCoordinator) {
    DispatchQueue.global().async {
        while let line = readLine() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }

            guard let data = trimmed.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let command = json["command"] as? String else {
                continue
            }

            switch command {
            case "split":
                guard let displayId = json["displayId"] as? Int,
                      let outputPath = json["outputPath"] as? String else {
                    emit(["status": "error", "message": "split requires displayId and outputPath", "timestamp": nowMs()])
                    continue
                }
                coordinator.split(displayId: UInt32(displayId), outputPath: outputPath)

            case "stop":
                Task {
                    await coordinator.stop()
                }

            default:
                emit(["status": "error", "message": "Unknown command: \(command)", "timestamp": nowMs()])
            }
        }
        // stdin closed — stop
        Task {
            await coordinator.stop()
        }
    }
}

// MARK: - Main

guard let config = parseArgs() else {
    exit(1)
}

let coordinator = RecordingCoordinator(config: config)

Task {
    await coordinator.start()
}

handleStdinCommands(coordinator: coordinator)

RunLoop.main.run()
