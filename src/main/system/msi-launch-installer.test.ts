import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The post-install launch is entirely installer-owned: the patched WiX
// template runs the registration script, which starts the launch VBS via a
// one-shot scheduled task. These files never import each other; these tests
// pin their shared names together.
const asset = (name: string): string =>
  readFileSync(path.join(process.cwd(), 'assets', name), 'utf8')

describe('MSI launch installer contract', () => {
  const vbs = asset('msi-launch-app.vbs')
  const ps1 = asset('msi-launch-task.ps1')
  const template = readFileSync(
    path.join(process.cwd(), 'node_modules', 'app-builder-lib', 'templates', 'msi', 'template.xml'),
    'utf8',
  )

  it('launch script spawns outside the Task Scheduler job', () => {
    expect(vbs).toContain('Win32_Process").Create')
    expect(vbs).not.toContain('shell.Run "')
  })

  it('launch script waits out an active installer instead of skipping', () => {
    expect(vbs).toContain('WScript.Sleep')
  })

  it('registration script configures a one-shot task that can start anywhere', () => {
    expect(ps1).toContain("$taskName = 'MemoryLane Enterprise Launcher'")
    expect(ps1).toContain('msi-launch-app.vbs')
    expect(ps1).toContain('--memorylane-hidden')
    expect(ps1).toContain('<Triggers/>')
    expect(ps1).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>')
    expect(ps1).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>')
    expect(ps1).toContain('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>')
  })

  it('MSI template patch is applied and wired to the scripts', () => {
    expect(template).toContain('killAppProcesses')
    expect(template).toContain('msi-launch-task.ps1')
    expect(template).toContain('/Delete /F /TN "${productName} Launcher"')
  })

  it('register has a rollback twin and uninstall deletes the task', () => {
    expect(template).toContain('Id="rollbackLaunchTask"')
    expect(template).toContain('Id="deleteLaunchTask"')
    expect(template).toMatch(/Custom Action="rollbackLaunchTask" Before="registerLaunchTask"/)
    expect(template).toMatch(/Custom Action="deleteLaunchTask" After="InstallInitialize"/)
  })

  it('task name matches the enterprise product name the MSI expands', () => {
    process.env.EDITION = 'enterprise'
    const builderConfig = createRequire(import.meta.url)(
      path.join(process.cwd(), 'electron-builder.config.js'),
    ) as { productName: string }
    expect(ps1).toContain(`$taskName = '${builderConfig.productName} Launcher'`)
  })
})
