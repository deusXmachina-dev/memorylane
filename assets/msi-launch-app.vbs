' Runs once per install from the trigger-less scheduled task registered by
' assets/msi-launch-task.ps1. It waits for active Windows Installer work to
' finish before launching, so a freshly launched app cannot hold handles in
' the install directory mid-push. The wait is best-effort and times out into
' the launch — every newer MSI pre-kills processes in the install dir, so
' launching is always safe; not launching is the only real failure.
Option Explicit

Dim appExe, hiddenArg, fso, wmi, appExeWql, pid, waits
If WScript.Arguments.Count < 2 Then WScript.Quit 0
appExe = WScript.Arguments(0)
hiddenArg = WScript.Arguments(1)

Set fso = CreateObject("Scripting.FileSystemObject")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")

' A query error counts as zero matches: every query gates a wait or a skip,
' and on any doubt the script must fall through to the launch.
Function ProcessCount(wql)
  On Error Resume Next
  ProcessCount = 0
  ProcessCount = wmi.ExecQuery(wql).Count
End Function

' The Installer service itself idles for many minutes after an install as
' "msiexec /V" — without the CommandLine filter the wait would always run the
' full 5 minutes. A row whose CommandLine is unreadable from this context
' drops out of the match; either way the fallthrough is the launch.
waits = 0
Do While waits < 20 And ProcessCount( _
  "SELECT ProcessId FROM Win32_Process WHERE Name = 'msiexec.exe'" & _
  " AND NOT CommandLine LIKE '%/V'") > 0
  WScript.Sleep 15000
  waits = waits + 1
Loop

If Not fso.FileExists(appExe) Then WScript.Quit 0

' Skip the Electron cold start in the common already-running case; the
' single-instance lock still covers the race.
appExeWql = Replace(Replace(appExe, "\", "\\"), "'", "\'")
If ProcessCount( _
  "SELECT ProcessId FROM Win32_Process WHERE ExecutablePath = '" & appExeWql & "'") > 0 Then
  WScript.Quit 0
End If

' Win32_Process.Create spawns from the WMI provider host, outside the Task
' Scheduler job for this task instance. A shell.Run child stays in that job
' and is terminated (0x40010004) when the task instance completes.
On Error Resume Next
wmi.Get("Win32_Process").Create """" & appExe & """ " & hiddenArg, Null, Null, pid
