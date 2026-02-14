export type OcrErrorCode = 'backend_unavailable' | 'image_decode_failed' | 'runtime_failed'

export function createOcrBackendError(
  backend: 'macos' | 'windows',
  code: OcrErrorCode,
  message: string,
): Error {
  return new Error(`[OCR:${backend}:${code}] ${message}`)
}
