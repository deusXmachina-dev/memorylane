import fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import path from 'node:path'
import * as yazl from 'yazl'

function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

/**
 * Build a timestamped zip filename like `${prefix}-20060102-150405.zip`.
 */
export function buildTimestampedZipName(prefix: string, now = new Date()): string {
  const timestamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(
    now.getHours(),
  )}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  return `${prefix}-${timestamp}.zip`
}

export function ensureZipExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith('.zip') ? filePath : `${filePath}.zip`
}

/**
 * Bundle `inputPaths` into a zip at `outputZipPath`, each as a flat entry named
 * by its basename. Creates the output directory if needed.
 */
export async function createZipWithFiles(
  inputPaths: string[],
  outputZipPath: string,
): Promise<void> {
  await fsPromises.mkdir(path.dirname(outputZipPath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const zipFile = new yazl.ZipFile()
    const output = fs.createWriteStream(outputZipPath)

    const onError = (error: unknown): void => {
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    output.once('error', onError)
    zipFile.outputStream.once('error', onError)
    output.once('close', resolve)

    zipFile.outputStream.pipe(output)
    for (const inputPath of inputPaths) {
      zipFile.addFile(inputPath, path.basename(inputPath))
    }
    zipFile.end()
  })
}
