# Run by the MSI as SYSTEM (see patches/app-builder-lib+*.patch) to start the
# app after an install/upgrade/repair. A SYSTEM custom action cannot spawn into
# the logged-on user's interactive session directly, so it registers a
# trigger-less scheduled task under the Users group and starts it once. The
# task never fires on its own — no auto-respawn; quitting the app holds.
# Task Scheduler XML instead of schtasks /Create because /Create cannot express
# the settings that matter: no battery restriction (the start would silently
# fail on laptops) and no execution time limit (the launch script waits out
# msiexec for up to 5 minutes).
# $ProductName comes from the MSI — the same value its delete/rollback custom
# actions expand into "<product> Launcher", so the names cannot drift apart.
param(
  [switch]$Register,
  [string]$ProductName = 'MemoryLane Enterprise'
)

$ErrorActionPreference = 'Stop'
$taskName = "$ProductName Launcher"
$logFile = Join-Path $env:ProgramData "$ProductName\msi-launch-task.log"

function Write-Log([string]$message) {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $logFile) | Out-Null
    Add-Content -Path $logFile -Value "$((Get-Date).ToString('s')) $message"
  } catch {}
}

if (-not $Register) {
  exit 0
}

$assetsDir = $PSScriptRoot
$appDir = [System.IO.Path]::GetFullPath((Join-Path $assetsDir '..\..'))
$vbsPath = Join-Path $assetsDir 'msi-launch-app.vbs'
$exePath = Join-Path $appDir "$ProductName.exe"
$taskArguments = '//B //NoLogo "' + $vbsPath + '" "' + $exePath + '" --memorylane-hidden'

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers/>
  <Principals>
    <Principal id="Author">
      <GroupId>S-1-5-32-545</GroupId>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>$taskArguments</Arguments>
    </Exec>
  </Actions>
</Task>
"@

# -Force overwrites the task left by a previous install (repair/upgrade).
try {
  Register-ScheduledTask -TaskName $taskName -Xml $xml -Force | Out-Null
  Write-Log 'registered'
} catch {
  Write-Log "register failed: $_"
  exit 0
}
# Bring the app up right after a silent push (the launch script waits out
# msiexec); fails when no user is logged on — the login autostart covers that.
try {
  Start-ScheduledTask -TaskName $taskName
} catch {
  Write-Log "start skipped: $_"
}
exit 0
