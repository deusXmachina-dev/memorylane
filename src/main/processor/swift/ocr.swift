import Cocoa
import Vision

// Check if an argument is provided
guard CommandLine.arguments.count > 1 else {
    print("Error: No image path provided.")
    exit(1)
}

let imagePath = CommandLine.arguments[1]
let fileURL = URL(fileURLWithPath: imagePath)

// Check if file exists
guard FileManager.default.fileExists(atPath: imagePath) else {
    print("Error: File not found at \(imagePath)")
    exit(1)
}

// Request text recognition
let request = VNRecognizeTextRequest { (request, error) in
    if let error = error {
        print("Error recognizing text: \(error.localizedDescription)")
        exit(1)
    }

    guard let observations = request.results as? [VNRecognizedTextObservation] else {
        return
    }

    let recognizedText = observations.compactMap { observation in
        // Get the top candidate for each observation
        return observation.topCandidates(1).first?.string
    }.joined(separator: "\n")

    print(recognizedText)
}

// Configure request for accuracy
request.recognitionLevel = .accurate

// Create a handler for the image file
let handler = VNImageRequestHandler(url: fileURL, options: [:])

do {
    try handler.perform([request])
} catch {
    print("Error processing image: \(error.localizedDescription)")
    exit(1)
}
