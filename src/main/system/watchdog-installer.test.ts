import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The Windows watchdog is entirely installer-owned: the patched WiX template
// runs the registration script, which schedules the relaunch VBS. These files
// never import each other; these tests pin their shared names together.
const asset = (name: string): string =>
  readFileSync(path.join(process.cwd(), 'assets', name), 'utf8')

describe('Windows watchdog installer contract', () => {
  const vbs = asset('watchdog-relaunch.vbs')
  const ps1 = asset('watchdog-task.ps1')
  const template = readFileSync(
    path.join(process.cwd(), 'node_modules', 'app-builder-lib', 'templates', 'msi', 'template.xml'),
    'utf8',
  )

  it('relaunch script spawns outside the Task Scheduler job', () => {
    expect(vbs).toContain('Win32_Process").Create')
    expect(vbs).not.toContain('shell.Run "')
  })

  it('registration script configures the task to actually fire', () => {
    expect(ps1).toContain("$taskName = 'MemoryLane Enterprise Watchdog'")
    expect(ps1).toContain('watchdog-relaunch.vbs')
    expect(ps1).toContain('--memorylane-hidden')
    expect(ps1).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>')
    expect(ps1).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>')
    expect(ps1).toContain('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>')
  })

  it('MSI template patch is applied and wired to the scripts', () => {
    expect(template).toContain('killAppProcesses')
    expect(template).toContain('watchdog-task.ps1')
    expect(template).toContain('/Delete /F /TN "${productName} Watchdog"')
  })
})
