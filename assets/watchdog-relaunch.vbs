' Runs from the per-machine scheduled task registered by the MSI via
' assets/watchdog-task.ps1. Skips the relaunch while the app is running, a
' Windows Installer is active (so a freshly launched app cannot hold handles
' in the install directory mid-push), or the user explicitly quit (the app
' writes the quit marker on tray Quit and clears it on every startup).
Option Explicit

Dim appExe, hiddenArg, fso, shell, wmi, appExeWql, markerPath, pid
If WScript.Arguments.Count < 2 Then WScript.Quit 0
appExe = WScript.Arguments(0)
hiddenArg = WScript.Arguments(1)

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' The MSI deletes the task on uninstall; a trigger racing that just exits.
If Not fso.FileExists(appExe) Then WScript.Quit 0

' Must match QUIT_MARKER_FILENAME in src/main/system/watchdog-win.ts.
markerPath = shell.ExpandEnvironmentStrings("%APPDATA%") & _
  "\MemoryLane Enterprise\watchdog-quit.marker"
If fso.FileExists(markerPath) Then WScript.Quit 0

Set wmi = GetObject("winmgmts:\\.\root\cimv2")
If wmi.ExecQuery( _
  "SELECT ProcessId FROM Win32_Process WHERE Name = 'msiexec.exe'").Count > 0 Then
  WScript.Quit 0
End If

' Skip the Electron cold start in the common already-running case; the
' single-instance lock still covers the race.
appExeWql = Replace(appExe, "\", "\\")
If wmi.ExecQuery( _
  "SELECT ProcessId FROM Win32_Process WHERE ExecutablePath = '" & appExeWql & "'").Count > 0 Then
  WScript.Quit 0
End If

' Win32_Process.Create spawns from the WMI provider host, outside the Task
' Scheduler job for this task instance. A shell.Run child stays in that job
' and is terminated (0x40010004) when the task instance completes.
wmi.Get("Win32_Process").Create """" & appExe & """ " & hiddenArg, Null, Null, pid
