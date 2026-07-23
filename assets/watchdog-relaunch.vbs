' Runs from the "MemoryLane Enterprise Watchdog" scheduled task (see
' src/main/system/watchdog-win.ts) instead of launching the exe directly:
' no console window flashes, the task deletes itself once the app is
' uninstalled, and the relaunch is skipped while a Windows Installer is
' active so a freshly launched app cannot hold handles in the install
' directory mid-push. An idle Installer service delays the relaunch by a
' cycle or two at worst.
Option Explicit

Dim appExe, hiddenArg, fso, shell, installers
If WScript.Arguments.Count < 2 Then WScript.Quit 0
appExe = WScript.Arguments(0)
hiddenArg = WScript.Arguments(1)

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

If Not fso.FileExists(appExe) Then
  shell.Run "schtasks.exe /Delete /F /TN ""MemoryLane Enterprise Watchdog""", 0, True
  WScript.Quit 0
End If

Set installers = GetObject("winmgmts:\\.\root\cimv2").ExecQuery( _
  "SELECT ProcessId FROM Win32_Process WHERE Name = 'msiexec.exe'")
If installers.Count > 0 Then WScript.Quit 0

shell.Run """" & appExe & """ " & hiddenArg, 0, False
