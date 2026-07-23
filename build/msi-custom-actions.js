'use strict'
const fs = require('fs')

// Fleet-upgrade custom actions, injected into the rendered project.wxs via the
// msiProjectCreated hook — electron-builder's MSI template has no extension
// point for custom actions. The hook sees the wxs after template substitution,
// so the product name is read back out of the document itself.
//
// killAppProcesses: helpers surviving from old versions hold handles in the
// install dir; without this kill before files-in-use validation, a silent
// upgrade defers file replacement to reboot (3010) and leaves a half-applied
// install. Runs on install, upgrade, repair and uninstall. The path-length
// guard keeps a hypothetically unresolved APPLICATIONFOLDER from matching
// every process on the machine. The dir is spliced into a PS double-quoted
// string (an apostrophe in the path would end a single-quoted one; a path
// containing $ or a backtick would interpolate and turn the kill into a no-op
// — acceptable, install dirs are fixed), padded with a space so its trailing
// backslash cannot escape the closing \" (TrimEnd removes it), and matched
// with StartsWith because -like treats [ ] in the path as wildcards.
//
// registerLaunchTask: starts the app once after install/upgrade/repair via a
// trigger-less scheduled task (assets/msi-launch-task.ps1) — a SYSTEM custom
// action cannot spawn into the user session directly. The task never fires on
// its own; rollback and uninstall delete it so no orphan is left behind.
//
// All actions run through WixQuietExec64 (WixUtilExtension, linked via
// additionalWixArgs) instead of ExeCommand: a plain EXE custom action pops a
// visible console window for every console binary, so an interactive
// install/reinstall flashed one terminal per action. QuietExec captures the
// output into the MSI log instead. Each action reads its command line from a
// property — WixQuietExec64CmdLine for the immediate kill, the action's own
// name (CustomActionData) for the deferred/rollback ones — set by a type-51
// action sequenced just before it, which also formats [APPLICATIONFOLDER] and
// [System64Folder] (the Installer service must not depend on PATH).
function buildCustomActionsXml(productName) {
  const killCmd = `"[System64Folder]WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$d = \\"[APPLICATIONFOLDER] \\".TrimEnd(); if ($d.Length -gt 3) { Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, &apos;OrdinalIgnoreCase&apos;) } | Stop-Process -Force -ErrorAction SilentlyContinue }"`
  const registerCmd = `"[System64Folder]WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "[APPLICATIONFOLDER]resources\\assets\\msi-launch-task.ps1" -ProductName "${productName}"`
  const deleteCmd = `"[System64Folder]schtasks.exe" /Delete /F /TN "${productName} Launcher"`
  // A setter must share its action's condition — if they drift, the action
  // runs with an empty command and Return="ignore" hides the failure.
  const installCond = 'NOT (REMOVE~="ALL")'
  const uninstallCond = 'REMOVE~="ALL" AND NOT UPGRADINGPRODUCTCODE'
  return [
    `    <CustomAction Id="setKillAppProcesses" Property="WixQuietExec64CmdLine" Value='${killCmd}'/>`,
    `    <CustomAction Id="killAppProcesses" BinaryKey="WixCA" DllEntry="WixQuietExec64" Execute="immediate" Return="ignore"/>`,
    `    <CustomAction Id="setRegisterLaunchTask" Property="registerLaunchTask" Value='${registerCmd}'/>`,
    `    <CustomAction Id="registerLaunchTask" BinaryKey="WixCA" DllEntry="WixQuietExec64" Execute="deferred" Impersonate="no" Return="ignore"/>`,
    `    <CustomAction Id="setRollbackLaunchTask" Property="rollbackLaunchTask" Value='${deleteCmd}'/>`,
    `    <CustomAction Id="rollbackLaunchTask" BinaryKey="WixCA" DllEntry="WixQuietExec64" Execute="rollback" Impersonate="no" Return="ignore"/>`,
    `    <CustomAction Id="setDeleteLaunchTask" Property="deleteLaunchTask" Value='${deleteCmd}'/>`,
    `    <CustomAction Id="deleteLaunchTask" BinaryKey="WixCA" DllEntry="WixQuietExec64" Execute="deferred" Impersonate="no" Return="ignore"/>`,
    '    <InstallExecuteSequence>',
    '      <Custom Action="setKillAppProcesses" Before="killAppProcesses">1</Custom>',
    '      <Custom Action="killAppProcesses" Before="InstallValidate">1</Custom>',
    `      <Custom Action="setDeleteLaunchTask" After="InstallInitialize">${uninstallCond}</Custom>`,
    `      <Custom Action="deleteLaunchTask" After="setDeleteLaunchTask">${uninstallCond}</Custom>`,
    `      <Custom Action="setRegisterLaunchTask" Before="setRollbackLaunchTask">${installCond}</Custom>`,
    `      <Custom Action="setRollbackLaunchTask" Before="rollbackLaunchTask">${installCond}</Custom>`,
    `      <Custom Action="rollbackLaunchTask" Before="registerLaunchTask">${installCond}</Custom>`,
    `      <Custom Action="registerLaunchTask" Before="InstallFinalize">${installCond}</Custom>`,
    '    </InstallExecuteSequence>',
    '',
  ].join('\n')
}

const ANCHOR = '    <Property Id="WIXUI_INSTALLDIR"'

function injectMsiCustomActions(wxs) {
  const productName = /<Product\s[^>]*\bName="([^"]+)"/.exec(wxs)?.[1]
  if (!productName) {
    throw new Error('msi-custom-actions: <Product Name> not found in rendered wxs')
  }
  if (!wxs.includes(ANCHOR)) {
    throw new Error('msi-custom-actions: anchor not found — electron-builder MSI template drifted')
  }
  return wxs.replace(ANCHOR, buildCustomActionsXml(productName) + '\n' + ANCHOR)
}

exports.injectMsiCustomActions = injectMsiCustomActions

exports.msiProjectCreated = async function msiProjectCreated(projectPath) {
  fs.writeFileSync(projectPath, injectMsiCustomActions(fs.readFileSync(projectPath, 'utf8')))
}
