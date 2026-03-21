import { execFileSync } from 'node:child_process'

export interface UpdateBlockingHostProcess {
  pid: number
  name: string
}

export interface UpdateBlockingMcpProcess {
  pid: number
  commandLine: string
  host: UpdateBlockingHostProcess | null
}

interface RawMcpProcess {
  pid: number
  parentPid: number
  name: string
  executablePath: string | null
  commandLine: string
}

function escapePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

function encodePowerShellScript(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function runPowerShellLines(script: string): string[] {
  const stdout = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodePowerShellScript(script),
    ],
    {
      encoding: 'utf-8',
      timeout: 7_500,
      maxBuffer: 512 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function parseMcpProcessLines(lines: string[]): RawMcpProcess[] {
  return lines.flatMap((line) => {
    const [pidText, parentPidText, name, executablePath, ...commandLineParts] = line.split('\t')
    const pid = Number.parseInt(pidText ?? '', 10)
    const parentPid = Number.parseInt(parentPidText ?? '', 10)
    if (!Number.isFinite(pid) || !Number.isFinite(parentPid) || !name) return []

    return [
      {
        pid,
        parentPid,
        name,
        executablePath: executablePath || null,
        commandLine: commandLineParts.join('\t'),
      } satisfies RawMcpProcess,
    ]
  })
}

function queryMcpProcesses(execPath: string): RawMcpProcess[] {
  const escapedExecPath = escapePowerShellLiteral(execPath)
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$targetExe = '${escapedExecPath}'`,
    '$processes = Get-CimInstance Win32_Process | Where-Object {',
    "  $_.ExecutablePath -eq $targetExe -and $_.CommandLine -like '*mcp-entry.js*'",
    '}',
    'foreach ($proc in $processes) {',
    "  $commandLine = if ($null -eq $proc.CommandLine) { '' } else { [string]$proc.CommandLine }",
    '  $safeCommandLine = $commandLine -replace "`t", " "',
    '  $safeExecutablePath = if ($null -eq $proc.ExecutablePath) { \'\' } else { ([string]$proc.ExecutablePath) -replace "`t", " " }',
    '  [Console]::Out.WriteLine("$([int]$proc.ProcessId)`t$([int]$proc.ParentProcessId)`t$([string]$proc.Name)`t$safeExecutablePath`t$safeCommandLine")',
    '}',
  ].join('\n')

  return parseMcpProcessLines(runPowerShellLines(script))
}

function queryHostNamesByPid(pids: number[]): Map<number, string> {
  if (pids.length === 0) return new Map()

  const pidList = [...new Set(pids)].join(', ')
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$targetPids = @(${pidList})`,
    '$processes = Get-CimInstance Win32_Process | Where-Object {',
    '  $targetPids -contains [int]$_.ProcessId',
    '}',
    'foreach ($proc in $processes) {',
    '  [Console]::Out.WriteLine("$([int]$proc.ProcessId)`t$([string]$proc.Name)")',
    '}',
  ].join('\n')

  const entries = runPowerShellLines(script).flatMap((line) => {
    const [pidText, name] = line.split('\t')
    const pid = Number.parseInt(pidText ?? '', 10)
    if (!Number.isFinite(pid) || !name) return []
    return [[pid, name] as const]
  })

  return new Map(entries)
}

export function findWindowsUpdateBlockingMcpProcesses(
  execPath: string,
): UpdateBlockingMcpProcess[] {
  const mcpProcesses = queryMcpProcesses(execPath)
  const hostNamesByPid = queryHostNamesByPid(
    mcpProcesses.map((processInfo) => processInfo.parentPid),
  )

  return mcpProcesses.map((processInfo) => ({
    pid: processInfo.pid,
    commandLine: processInfo.commandLine,
    host: hostNamesByPid.has(processInfo.parentPid)
      ? {
          pid: processInfo.parentPid,
          name: hostNamesByPid.get(processInfo.parentPid)!,
        }
      : null,
  }))
}

export function formatBlockingHostNames(blockers: UpdateBlockingMcpProcess[]): string[] {
  const names = new Map<string, string>()

  for (const blocker of blockers) {
    const hostName = blocker.host?.name?.trim()
    if (!hostName) continue

    const normalized = hostName.replace(/\.exe$/i, '')
    const label = normalized || hostName
    const key = label.toLowerCase()
    const existing = names.get(key)

    if (!existing || (/^[A-Z]/.test(label) && !/^[A-Z]/.test(existing))) {
      names.set(key, label)
    }
  }

  return [...names.values()].sort((left, right) => left.localeCompare(right))
}

export function stopWindowsHostProcesses(blockers: UpdateBlockingMcpProcess[]): void {
  const hostPids = [
    ...new Set(blockers.map((blocker) => blocker.host?.pid).filter((pid) => pid != null)),
  ]
  if (hostPids.length === 0) return

  for (const pid of hostPids) {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: 7_500,
      maxBuffer: 128 * 1024,
    })
  }
}
