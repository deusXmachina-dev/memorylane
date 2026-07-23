' Runs once per install from the trigger-less scheduled task registered by
' assets/msi-launch-task.ps1. It waits for the Windows Installer to go quiet
' before launching, so a freshly launched app cannot hold handles in the
' install directory mid-push. The wait is best-effort: the idle Installer
' service can linger for many minutes after the install completes, so on
' timeout the app launches anyway — every newer MSI pre-kills processes in
' the install dir, so launching is always safe; not launching is the only
' real failure.
Option Explicit

Dim appExe, hiddenArg, fso, wmi, appExeWql, pid, waits
If WScript.Arguments.Count < 2 Then WScript.Quit 0
appExe = WScript.Arguments(0)
hiddenArg = WScript.Arguments(1)

Set fso = CreateObject("Scripting.FileSystemObject")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")

waits = 0
Do While waits < 20 And wmi.ExecQuery( _
  "SELECT ProcessId FROM Win32_Process WHERE Name = 'msiexec.exe'").Count > 0
  WScript.Sleep 15000
  waits = waits + 1
Loop

If Not fso.FileExists(appExe) Then WScript.Quit 0

' Skip the Electron cold start in the common already-running case; the
' single-instance lock still covers the race, and a query error falls
' through to launching.
On Error Resume Next
appExeWql = Replace(Replace(appExe, "\", "\\"), "'", "\'")
If wmi.ExecQuery( _
  "SELECT ProcessId FROM Win32_Process WHERE ExecutablePath = '" & appExeWql & "'").Count > 0 Then
  WScript.Quit 0
End If

' Win32_Process.Create spawns from the WMI provider host, outside the Task
' Scheduler job for this task instance. A shell.Run child stays in that job
' and is terminated (0x40010004) when the task instance completes.
wmi.Get("Win32_Process").Create """" & appExe & """ " & hiddenArg, Null, Null, pid
