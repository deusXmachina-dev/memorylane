import { describe, expect, it } from 'vitest'
import { buildCreateTaskArgs, buildDisableTaskArgs } from './watchdog-win'

describe('watchdog-win schtasks arguments', () => {
  it('creates a repeating task that relaunches the app hidden via the script', () => {
    const args = buildCreateTaskArgs(
      'C:\\Program Files\\MemoryLane Enterprise\\resources\\assets\\watchdog-relaunch.vbs',
      'C:\\Program Files\\MemoryLane Enterprise\\MemoryLane Enterprise.exe',
    )

    expect(args).toEqual([
      '/Create',
      '/F',
      '/TN',
      'MemoryLane Enterprise Watchdog',
      '/SC',
      'MINUTE',
      '/MO',
      '5',
      '/TR',
      'wscript.exe //B "C:\\Program Files\\MemoryLane Enterprise\\resources\\assets\\watchdog-relaunch.vbs" "C:\\Program Files\\MemoryLane Enterprise\\MemoryLane Enterprise.exe" --memorylane-hidden',
    ])
  })

  it('disables the same task by name', () => {
    expect(buildDisableTaskArgs()).toEqual([
      '/Change',
      '/TN',
      'MemoryLane Enterprise Watchdog',
      '/DISABLE',
    ])
  })
})
