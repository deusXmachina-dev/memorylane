param(
  [string]$EnvFilePath = (Join-Path $PSScriptRoot "..\.env")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-DotEnvFile {
  param([string]$Path)

  $result = @{}
  if (-not (Test-Path -Path $Path)) {
    return $result
  }

  foreach ($line in Get-Content -Path $Path) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.TrimStart().StartsWith("#")) { continue }

    $parts = $line.Split("=", 2)
    if ($parts.Length -ne 2) { continue }

    $key = $parts[0].Trim()
    $value = $parts[1].Trim()

    if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
      $value = $value.Substring(1, $value.Length - 2)
    } elseif ($value.StartsWith("'") -and $value.EndsWith("'") -and $value.Length -ge 2) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if (-not [string]::IsNullOrWhiteSpace($key)) {
      $result[$key] = $value
    }
  }

  return $result
}

function Set-EnvFromDotEnv {
  param(
    [hashtable]$DotEnv,
    [string[]]$Keys
  )

  foreach ($key in $Keys) {
    $existing = [Environment]::GetEnvironmentVariable($key)
    if (-not [string]::IsNullOrWhiteSpace($existing)) {
      continue
    }

    if ($DotEnv.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace($DotEnv[$key])) {
      [Environment]::SetEnvironmentVariable($key, $DotEnv[$key], "Process")
      continue
    }

    throw "Missing required setting: $key"
  }
}

Write-Host "Loading signing configuration for electron-builder..."
$dotEnv = Read-DotEnvFile -Path $EnvFilePath

$requiredKeys = @(
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET"
)

Set-EnvFromDotEnv -DotEnv $dotEnv -Keys $requiredKeys

Write-Host "Running signed Windows build..."
& npm run make:win
