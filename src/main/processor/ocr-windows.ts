import { spawn } from 'child_process'

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

/**
 * Windows OCR backend implemented via local Tesseract CLI.
 * Keeps OCR fully offline when Tesseract is installed on the host machine.
 */
export async function extractTextWindows(filepath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tesseract = spawn('tesseract', [filepath, 'stdout'], {
      windowsHide: true,
    })

    let stdoutData = ''
    let stderrData = ''

    tesseract.stdout.on('data', (data) => {
      stdoutData += data.toString()
    })

    tesseract.stderr.on('data', (data) => {
      stderrData += data.toString()
    })

    tesseract.on('error', (error) => {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        reject(
          new Error(
            'Windows OCR requires Tesseract to be installed and available on PATH. Install it and retry.',
          ),
        )
        return
      }

      reject(new Error(`Failed to start Tesseract OCR process: ${error.message}`))
    })

    tesseract.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Tesseract OCR failed with code ${code}: ${stderrData.trim() || 'Unknown error'}`,
          ),
        )
        return
      }

      resolve(stdoutData.trim())
    })
  })
}
