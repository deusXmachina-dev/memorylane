' Runs from the scheduled task registered by src/main/system/watchdog-win.ts
' instead of launching the exe directly: no console window flashes, the task
' deletes itself once the app is uninstalled, and the relaunch is skipped
' while the app is already running or a Windows Installer is active (so a
' freshly launched app cannot hold handles in the install directory mid-push).
Option Explicit

Dim appExe, hiddenArg, taskName, fso, shell, wmi, appExeWql
If WScript.Arguments.Count < 3 Then WScript.Quit 0
appExe = WScript.Arguments(0)
hiddenArg = WScript.Arguments(1)
taskName = WScript.Arguments(2)

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

If Not fso.FileExists(appExe) Then
  shell.Run "schtasks.exe /Delete /F /TN """ & taskName & """", 0, True
  WScript.Quit 0
End If

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

shell.Run """" & appExe & """ " & hiddenArg, 0, False
