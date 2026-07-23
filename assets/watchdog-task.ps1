# Run by the MSI as SYSTEM (see patches/app-builder-lib+*.patch) to manage the
# per-machine relaunch watchdog task. schtasks /Create cannot express the
# settings that matter here: no battery restriction (laptops would never
# relaunch on battery) and no execution time limit (the default 72h limit
# kills whatever the task started). -Force also overwrites the per-user task
# that pre-1.5.2 app builds registered under the same name.
param(
  [switch]$Register,
  [switch]$Remove
)

$ErrorActionPreference = 'SilentlyContinue'
$taskName = 'MemoryLane Enterprise Watchdog'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  exit 0
}
if (-not $Register) {
  exit 0
}

$assetsDir = $PSScriptRoot
$appDir = [System.IO.Path]::GetFullPath((Join-Path $assetsDir '..\..'))
$vbsPath = Join-Path $assetsDir 'watchdog-relaunch.vbs'
$exePath = Join-Path $appDir 'MemoryLane Enterprise.exe'
$taskArguments = '//B //NoLogo "' + $vbsPath + '" "' + $exePath + '" --memorylane-hidden'

# TimeTrigger with an already-past StartBoundary + indefinite 5-minute
# repetition arms immediately (a LogonTrigger would stay dormant until the
# next logon when installing mid-session). The Users group principal runs the
# script in the logged-on user's interactive session.
$startBoundary = (Get-Date).AddMinutes(-1).ToString('yyyy-MM-dd\THH:mm:ss')
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <TimeTrigger>
      <StartBoundary>$startBoundary</StartBoundary>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
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
    <StartWhenAvailable>true</StartWhenAvailable>
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

Register-ScheduledTask -TaskName $taskName -Xml $xml -Force | Out-Null
# Bring the app back seconds after a silent push instead of within 5 minutes;
# fails harmlessly when no user is logged on.
Start-ScheduledTask -TaskName $taskName
exit 0
