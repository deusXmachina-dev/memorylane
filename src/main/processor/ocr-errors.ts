export type OcrErrorCode =
  | 'backend_unavailable'
  | 'not_ready'
  | 'image_decode_failed'
  | 'timeout'
  | 'runtime_failed'

export function createOcrBackendError(
  backend: 'macos' | 'windows',
  code: OcrErrorCode,
  message: string,
): Error {
  return new Error(`[OCR:${backend}:${code}] ${message}`)
}
