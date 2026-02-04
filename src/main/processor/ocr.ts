import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolves the path to the Swift OCR script.
 * In development, it looks in the src directory.
 * In production, it should be in the resources directory (not yet implemented).
 */
function getOcrScriptPath(): string {
  // Development path: resolve relative to CWD (project root)
  const devPath = path.resolve(process.cwd(), 'src', 'main', 'processor', 'swift', 'ocr.swift');
  
  if (fs.existsSync(devPath)) {
    return devPath;
  }
  
  // TODO: Add logic for production path resolution (e.g. process.resourcesPath)
  
  throw new Error(`OCR script not found at ${devPath}`);
}

/**
 * Extracts text from an image using the native macOS Vision framework via a Swift sidecar script.
 * 
 * @param filepath Absolute path to the image file
 * @returns Promise resolving to the extracted text
 * @throws Error if the file doesn't exist or the OCR process fails
 */
export async function extractText(filepath: string): Promise<string> {
  const scriptPath = getOcrScriptPath();
  
  return new Promise((resolve, reject) => {
    // Basic validation
    if (!fs.existsSync(filepath)) {
      return reject(new Error(`Image file not found: ${filepath}`));
    }

    const swift = spawn('swift', [scriptPath, filepath]);

    let stdoutData = '';
    let stderrData = '';

    swift.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    swift.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    swift.on('close', (code) => {
      if (code !== 0) {
        // The Swift script exits with 1 on known errors (missing file, Vision error)
        return reject(new Error(`OCR process failed with code ${code}: ${stderrData.trim() || 'Unknown error'}`));
      }
      
      // Success: return the trimmed text
      // Note: "No text found" results in empty string (exit code 0), which is valid.
      resolve(stdoutData.trim());
    });
    
    swift.on('error', (err) => {
        reject(new Error(`Failed to spawn swift process: ${err.message}`));
    });
  });
}
