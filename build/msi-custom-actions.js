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
// Directory-type actions with [System64Folder]-qualified executables: the
// ExeCommand is formatted (a static Property value is not), and the Installer
// service must not depend on PATH.
function buildCustomActionsXml(productName) {
  return [
    `    <CustomAction Id="killAppProcesses" Directory="TARGETDIR" ExeCommand='"[System64Folder]WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$d = \\"[APPLICATIONFOLDER] \\".TrimEnd(); if ($d.Length -gt 3) { Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, &apos;OrdinalIgnoreCase&apos;) } | Stop-Process -Force -ErrorAction SilentlyContinue }"' Execute="immediate" Return="ignore"/>`,
    `    <CustomAction Id="registerLaunchTask" Directory="TARGETDIR" ExeCommand='"[System64Folder]WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "[APPLICATIONFOLDER]resources\\assets\\msi-launch-task.ps1" -ProductName "${productName}"' Execute="deferred" Impersonate="no" Return="ignore"/>`,
    `    <CustomAction Id="rollbackLaunchTask" Directory="TARGETDIR" ExeCommand='"[System64Folder]schtasks.exe" /Delete /F /TN "${productName} Launcher"' Execute="rollback" Impersonate="no" Return="ignore"/>`,
    `    <CustomAction Id="deleteLaunchTask" Directory="TARGETDIR" ExeCommand='"[System64Folder]schtasks.exe" /Delete /F /TN "${productName} Launcher"' Execute="deferred" Impersonate="no" Return="ignore"/>`,
    '    <InstallExecuteSequence>',
    '      <Custom Action="killAppProcesses" Before="InstallValidate">1</Custom>',
    '      <Custom Action="deleteLaunchTask" After="InstallInitialize">REMOVE~="ALL" AND NOT UPGRADINGPRODUCTCODE</Custom>',
    '      <Custom Action="rollbackLaunchTask" Before="registerLaunchTask">NOT (REMOVE~="ALL")</Custom>',
    '      <Custom Action="registerLaunchTask" Before="InstallFinalize">NOT (REMOVE~="ALL")</Custom>',
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
