import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The post-install launch is entirely installer-owned: the msiProjectCreated
// hook injects the custom actions into the wxs electron-builder renders, the
// registration script starts the launch VBS via a one-shot scheduled task.
// These files never import each other; these tests pin their shared names
// together.
const require = createRequire(import.meta.url)
const asset = (name: string): string =>
  readFileSync(path.join(process.cwd(), 'assets', name), 'utf8')

const { injectMsiCustomActions } = require(
  path.join(process.cwd(), 'build', 'msi-custom-actions.js'),
) as { injectMsiCustomActions: (wxs: string) => string }

// Mirrors the two parts of the rendered project.wxs the injection relies on:
// the Product name and the anchor property.
const renderedWxs = [
  '<Wix>',
  '  <Product Id="*" Name="MemoryLane Enterprise" UpgradeCode="x" Version="1.0.0" Language="1033">',
  '    <Property Id="WIXUI_INSTALLDIR" Value="APPLICATIONFOLDER"/>',
  '  </Product>',
  '</Wix>',
].join('\n')

describe('MSI launch installer contract', () => {
  const vbs = asset('msi-launch-app.vbs')
  const ps1 = asset('msi-launch-task.ps1')
  const injected = injectMsiCustomActions(renderedWxs)

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('launch script spawns outside the Task Scheduler job', () => {
    expect(vbs).toContain('Win32_Process").Create')
    expect(vbs).not.toContain('shell.Run "')
  })

  it('launch script waits out active installer work but launches on timeout', () => {
    expect(vbs).toContain('WScript.Sleep')
    // The cap lives in the loop condition — timing out must fall through to
    // the launch, never quit.
    expect(vbs).toContain('Do While waits < 20')
    expect(vbs).not.toContain('If waits >=')
    // The idle Installer service ("msiexec /V") lingers after installs;
    // without this filter the wait always runs the full 5 minutes.
    expect(vbs).toContain("NOT CommandLine LIKE '%/V'")
  })

  it('registration script configures a one-shot task that can start anywhere', () => {
    expect(ps1).toContain('$taskName = "$ProductName Launcher"')
    expect(ps1).toContain('msi-launch-app.vbs')
    expect(ps1).toContain('--memorylane-hidden')
    // Install paths land inside the task XML; & in a path must not break it.
    expect(ps1).toContain('SecurityElement]::Escape')
    expect(ps1).toContain('<Triggers/>')
    expect(ps1).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>')
    expect(ps1).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>')
    expect(ps1).toContain('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>')
  })

  it('config wires the injection into the MSI build', () => {
    vi.stubEnv('EDITION', 'enterprise')
    const builderConfig = require(path.join(process.cwd(), 'electron-builder.config.js')) as {
      msiProjectCreated: string
      msi: { additionalWixArgs: string[] }
    }
    expect(builderConfig.msiProjectCreated).toBe('build/msi-custom-actions.js')
    // WixQuietExec64 lives in WixUtilExtension; without it light fails on WixCA.
    expect(builderConfig.msi.additionalWixArgs).toEqual(['-ext', 'WixUtilExtension'])
  })

  it('injection expands the product name from the wxs and wires the scripts', () => {
    expect(injected).toContain('killAppProcesses')
    expect(injected).toContain('msi-launch-task.ps1')
    expect(injected).toContain('-ProductName "MemoryLane Enterprise"')
    expect(injected).toContain('/Delete /F /TN "MemoryLane Enterprise Launcher"')
    // The anchor stays put so a re-run cannot silently double-inject.
    expect(injected).toContain('<Property Id="WIXUI_INSTALLDIR"')
  })

  it('injection fails loudly when the rendered wxs drifts', () => {
    expect(() => injectMsiCustomActions('<Wix><Product Id="*"/></Wix>')).toThrow(/Product Name/)
    expect(() => injectMsiCustomActions('<Wix><Product Id="*" Name="MemoryLane"/></Wix>')).toThrow(
      /anchor/,
    )
  })

  it('custom actions use fully qualified executables, not PATH lookup', () => {
    expect(injected).toContain('"[System64Folder]WindowsPowerShell\\v1.0\\powershell.exe"')
    expect(injected).toContain('"[System64Folder]schtasks.exe"')
  })

  it('actions run through WixQuietExec so no console window flashes', () => {
    // A plain EXE custom action pops a terminal per console binary during
    // interactive installs.
    expect(injected).not.toContain('ExeCommand')
    for (const action of [
      'killAppProcesses',
      'registerLaunchTask',
      'rollbackLaunchTask',
      'deleteLaunchTask',
    ]) {
      expect(injected).toMatch(
        new RegExp(`Id="${action}" BinaryKey="WixCA" DllEntry="WixQuietExec64"`),
      )
    }
    // The immediate action reads WixQuietExec64CmdLine; deferred/rollback ones
    // read CustomActionData, so the type-51 property must equal the action id.
    expect(injected).toContain('Property="WixQuietExec64CmdLine"')
    expect(injected).toContain('Property="registerLaunchTask"')
    expect(injected).toContain('Property="rollbackLaunchTask"')
    expect(injected).toContain('Property="deleteLaunchTask"')
    // Each quiet action needs its command set earlier in the same sequence.
    expect(injected).toMatch(/Custom Action="setKillAppProcesses" Before="killAppProcesses"/)
    expect(injected).toMatch(/Custom Action="setRegisterLaunchTask" Before="setRollbackLaunchTask"/)
    expect(injected).toMatch(/Custom Action="setRollbackLaunchTask" Before="rollbackLaunchTask"/)
    expect(injected).toMatch(/Custom Action="setDeleteLaunchTask" After="InstallInitialize"/)
  })

  it('setter conditions match their actions', () => {
    // A drifted condition leaves the action with an empty command line, and
    // Return="ignore" hides the failure.
    const conditions = new Map(
      [...injected.matchAll(/<Custom Action="(\w+)"[^>]*>([^<]*)<\/Custom>/g)].map((m) => [
        m[1],
        m[2],
      ]),
    )
    for (const action of [
      'killAppProcesses',
      'registerLaunchTask',
      'rollbackLaunchTask',
      'deleteLaunchTask',
    ]) {
      const setter = `set${action[0].toUpperCase()}${action.slice(1)}`
      expect(conditions.get(setter), setter).toBeTruthy()
      expect(conditions.get(setter), setter).toBe(conditions.get(action))
    }
  })

  it('kill action matches paths literally, not as wildcards', () => {
    expect(injected).toContain('.StartsWith($d, &apos;OrdinalIgnoreCase&apos;)')
    expect(injected).not.toContain('$_.Path -like')
  })

  it('register has a rollback twin and uninstall deletes the task', () => {
    expect(injected).toContain('Id="rollbackLaunchTask"')
    expect(injected).toContain('Id="deleteLaunchTask"')
    expect(injected).toMatch(/Custom Action="rollbackLaunchTask" Before="registerLaunchTask"/)
    expect(injected).toMatch(/Custom Action="deleteLaunchTask" After="setDeleteLaunchTask"/)
  })

  it('default product name matches the enterprise product the MSI expands', () => {
    vi.stubEnv('EDITION', 'enterprise')
    const builderConfig = require(path.join(process.cwd(), 'electron-builder.config.js')) as {
      productName: string
    }
    expect(ps1).toContain(`[string]$ProductName = '${builderConfig.productName}'`)
  })
})
