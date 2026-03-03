param(
  [string]$DistPath = (Join-Path $PSScriptRoot "..\dist"),
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

function Get-RequiredValue {
  param(
    [string]$Name,
    [hashtable]$DotEnv
  )

  $fromEnv = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
    return $fromEnv
  }

  if ($DotEnv.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace($DotEnv[$Name])) {
    return $DotEnv[$Name]
  }

  throw "Missing required setting: $Name"
}

Write-Host "Loading configuration..."
$dotEnv = Read-DotEnvFile -Path $EnvFilePath

$tenantId = Get-RequiredValue -Name "AZURE_TENANT_ID" -DotEnv $dotEnv
$clientId = Get-RequiredValue -Name "AZURE_CLIENT_ID" -DotEnv $dotEnv
$clientSecret = Get-RequiredValue -Name "AZURE_CLIENT_SECRET" -DotEnv $dotEnv
$endpoint = Get-RequiredValue -Name "ENDPOINT" -DotEnv $dotEnv
$accountName = Get-RequiredValue -Name "SIGNING_ACCOUNT_NAME" -DotEnv $dotEnv
$certificateProfileName = Get-RequiredValue -Name "CERTIFICATE_PROFILE_NAME" -DotEnv $dotEnv

if (-not $endpoint.EndsWith("/")) {
  $endpoint = "$endpoint/"
}

$env:AZURE_TENANT_ID = $tenantId
$env:AZURE_CLIENT_ID = $clientId
$env:AZURE_CLIENT_SECRET = $clientSecret

if (-not (Test-Path -Path $DistPath)) {
  throw "Dist path not found: $DistPath"
}

$exeFiles = Get-ChildItem -Path $DistPath -Filter "*.exe" -File
if ($exeFiles.Count -eq 0) {
  throw "No .exe files found in: $DistPath"
}

if (-not (Get-Module -ListAvailable -Name TrustedSigning)) {
  throw "TrustedSigning module is not installed. Run: Install-Module -Name TrustedSigning -Scope CurrentUser"
}

Import-Module TrustedSigning -ErrorAction Stop

Write-Host ("Signing {0} file(s) in {1}..." -f $exeFiles.Count, $DistPath)
$params = @{
  Endpoint = $endpoint
  CodeSigningAccountName = $accountName
  CertificateProfileName = $certificateProfileName
  FilesFolder = $DistPath
  FilesFolderFilter = "exe"
  FileDigest = "SHA256"
  TimestampRfc3161 = "http://timestamp.acs.microsoft.com"
  TimestampDigest = "SHA256"
}

Invoke-TrustedSigning @params

Write-Host ""
Write-Host "Signature verification:"
foreach ($file in $exeFiles) {
  $signature = Get-AuthenticodeSignature -FilePath $file.FullName
  Write-Host (" - {0}: {1}" -f $file.Name, $signature.Status)
}
