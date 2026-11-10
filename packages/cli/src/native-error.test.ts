import { describe, it, expect } from 'vitest'
import { isNativeBindingError } from './native-error'

function errorWithCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

describe('isNativeBindingError', () => {
  it('matches a missing build binary', () => {
    const err = errorWithCode(
      "Cannot find module '/usr/lib/node_modules/better-sqlite3/build/Release/better_sqlite3.node'",
      'MODULE_NOT_FOUND',
    )
    expect(isNativeBindingError(err)).toBe(true)
  })

  it('matches a prebuild that fails to load', () => {
    const err = errorWithCode(
      'The specified module could not be found.\r\n\\\\?\\C:\\npm\\node_modules\\better-sqlite3\\prebuilds\\win32-x64.node',
      'ERR_DLOPEN_FAILED',
    )
    expect(isNativeBindingError(err)).toBe(true)
  })

  it('ignores unrelated missing modules', () => {
    expect(
      isNativeBindingError(errorWithCode("Cannot find module 'zod'", 'MODULE_NOT_FOUND')),
    ).toBe(false)
  })
})
