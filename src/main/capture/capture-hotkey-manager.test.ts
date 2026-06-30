import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CAPTURE_HOTKEY_ACCELERATOR } from './hotkey-capture'

const electronMocks = vi.hoisted(() => ({
  register: vi.fn<(accelerator: string, callback: () => void) => boolean>(),
  unregister: vi.fn<(accelerator: string) => void>(),
}))

vi.mock('electron', () => ({
  globalShortcut: {
    register: electronMocks.register,
    unregister: electronMocks.unregister,
  },
}))

import { createCaptureHotkeyManager } from './capture-hotkey-manager'

describe('createCaptureHotkeyManager', () => {
  beforeEach(() => {
    electronMocks.register.mockReset()
    electronMocks.unregister.mockReset()
  })

  it('starts with default accelerator and empty label before registration', () => {
    const manager = createCaptureHotkeyManager({
      platform: 'darwin',
      onTriggered: vi.fn(),
    })

    expect(manager.getAccelerator()).toBe(DEFAULT_CAPTURE_HOTKEY_ACCELERATOR)
    expect(manager.getLabel()).toBe('')
  })

  it('registers a normalized accelerator and triggers callback with active accelerator', () => {
    const onTriggered = vi.fn()
    electronMocks.register.mockReturnValue(true)

    const manager = createCaptureHotkeyManager({
      platform: 'darwin',
      onTriggered,
    })

    const result = manager.reconfigure(' CommandOrControl+Alt+P ')
    expect(result).toEqual({ success: true })
    expect(electronMocks.register).toHaveBeenCalledWith(
      'CommandOrControl+Alt+P',
      expect.any(Function),
    )
    expect(manager.getAccelerator()).toBe('CommandOrControl+Alt+P')
    expect(manager.getLabel()).toBe('Cmd+Option+P')

    const callback = electronMocks.register.mock.calls[0]?.[1]
    expect(callback).toBeTypeOf('function')
    callback?.()
    expect(onTriggered).toHaveBeenCalledWith('CommandOrControl+Alt+P')
  })

  it('rolls back to previous accelerator when register throws', () => {
    const onTriggered = vi.fn()
    electronMocks.register
      .mockReturnValueOnce(true)
      .mockImplementationOnce(() => {
        throw new Error('bad accelerator')
      })
      .mockReturnValueOnce(true)

    const manager = createCaptureHotkeyManager({
      platform: 'win32',
      onTriggered,
    })

    expect(manager.reconfigure('CommandOrControl+Alt+P')).toEqual({ success: true })
    const result = manager.reconfigure('CommandOrControl+Alt+K')

    expect(result).toEqual({
      success: false,
      error: 'Failed to register start/stop shortcut: bad accelerator',
    })
    expect(electronMocks.unregister).toHaveBeenCalledWith('CommandOrControl+Alt+P')
    expect(electronMocks.register).toHaveBeenNthCalledWith(
      3,
      'CommandOrControl+Alt+P',
      expect.any(Function),
    )
    expect(manager.getAccelerator()).toBe('CommandOrControl+Alt+P')
  })

  it('rolls back when register returns false (likely conflict)', () => {
    electronMocks.register
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)

    const manager = createCaptureHotkeyManager({
      platform: 'darwin',
      onTriggered: vi.fn(),
    })

    expect(manager.reconfigure('CommandOrControl+Alt+P')).toEqual({ success: true })
    const result = manager.reconfigure('CommandOrControl+Alt+K')

    expect(result).toEqual({
      success: false,
      error: 'Failed to register start/stop shortcut. Shortcut may be in use.',
    })
    expect(electronMocks.unregister).toHaveBeenCalledWith('CommandOrControl+Alt+P')
    expect(electronMocks.register).toHaveBeenNthCalledWith(
      3,
      'CommandOrControl+Alt+P',
      expect.any(Function),
    )
    expect(manager.getAccelerator()).toBe('CommandOrControl+Alt+P')
  })
})
