' Runs from the per-machine scheduled task registered by the MSI via
' assets/watchdog-task.ps1. Enterprise is always-running (capture on/off is
' the user control), so the only skips are: app already running, or a Windows
' Installer active (a freshly launched app must not hold handles in the
' install directory mid-push).
Option Explicit

Dim appExe, hiddenArg, fso, wmi, appExeWql, pid
If WScript.Arguments.Count < 2 Then WScript.Quit 0
appExe = WScript.Arguments(0)
hiddenArg = WScript.Arguments(1)

Set fso = CreateObject("Scripting.FileSystemObject")

' The MSI deletes the task on uninstall; a trigger racing that just exits.
If Not fso.FileExists(appExe) Then WScript.Quit 0

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
