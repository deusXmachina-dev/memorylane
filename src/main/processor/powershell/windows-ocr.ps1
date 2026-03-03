param(
  [string]$ImagePath,
  [switch]$ProbeOnly
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-JsonEnvelope {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Payload,
    [int]$ExitCode = 0
  )

  [Console]::Out.WriteLine(($Payload | ConvertTo-Json -Compress -Depth 5))
  exit $ExitCode
}

function Write-Success {
  param(
    [string]$Text = '',
    $Diagnostics = $null
  )

  $payload = @{
    ok = $true
    text = $Text
  }

  if ($null -ne $Diagnostics) {
    $payload.diagnostics = $Diagnostics
  }

  Write-JsonEnvelope -Payload $payload -ExitCode 0
}

function Write-Failure {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Code,
    [Parameter(Mandatory = $true)]
    [string]$Message,
    [string]$Details = $null
  )

  $payload = @{
    ok = $false
    code = $Code
    message = $Message
    details = $Details
  }

  Write-JsonEnvelope -Payload $payload -ExitCode 1
}

function Wait-WinRtAsyncResult {
  param(
    [Parameter(Mandatory = $true)]
    $AsyncOperation,
    [Parameter(Mandatory = $true)]
    [Type]$ResultType
  )

  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethod -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1

  if ($null -eq $asTaskMethod) {
    throw 'Unable to locate WinRT AsTask helper method.'
  }

  $task = $asTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($AsyncOperation))
  $task.Wait()

  return $task.Result
}

function Get-OcrDiagnostics {
  param(
    [Parameter(Mandatory = $true)]
    $OcrEngine
  )

  $languageTag = $null
  try {
    $languageTag = $OcrEngine.RecognizerLanguage.LanguageTag
  } catch {
    $languageTag = $null
  }

  return @{
    engine = 'windows.media.ocr'
    languageTag = $languageTag
  }
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
} catch {
  Write-Failure `
    -Code 'winrt_load_failed' `
    -Message 'Failed to load Windows Runtime support required for Windows OCR.' `
    -Details $_.Exception.Message
}

try {
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
} catch {
  Write-Failure `
    -Code 'winrt_load_failed' `
    -Message 'Failed to load Windows OCR WinRT types.' `
    -Details $_.Exception.Message
}

try {
  $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
} catch {
  Write-Failure `
    -Code 'ocr_engine_unavailable' `
    -Message 'Windows OCR engine could not be created for the current user profile languages.' `
    -Details $_.Exception.Message
}

if ($null -eq $ocrEngine) {
  Write-Failure `
    -Code 'ocr_engine_unavailable' `
    -Message 'Windows OCR engine is unavailable for the current user profile languages.'
}

$diagnostics = Get-OcrDiagnostics -OcrEngine $ocrEngine

if ($ProbeOnly) {
  Write-Success -Text '' -Diagnostics $diagnostics
}

if ([string]::IsNullOrWhiteSpace($ImagePath)) {
  Write-Failure -Code 'image_not_found' -Message 'Image path is required for Windows OCR.'
}

if (-not (Test-Path -LiteralPath $ImagePath)) {
  Write-Failure -Code 'image_not_found' -Message "Image file not found: $ImagePath"
}

try {
  $storageFile = Wait-WinRtAsyncResult `
    -AsyncOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) `
    -ResultType ([Windows.Storage.StorageFile])

  $stream = Wait-WinRtAsyncResult `
    -AsyncOperation ($storageFile.OpenReadAsync()) `
    -ResultType ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])

  $decoder = Wait-WinRtAsyncResult `
    -AsyncOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) `
    -ResultType ([Windows.Graphics.Imaging.BitmapDecoder])

  $bitmap = Wait-WinRtAsyncResult `
    -AsyncOperation ($decoder.GetSoftwareBitmapAsync()) `
    -ResultType ([Windows.Graphics.Imaging.SoftwareBitmap])
} catch {
  Write-Failure `
    -Code 'image_decode_failed' `
    -Message 'Windows OCR failed to open or decode the image.' `
    -Details $_.Exception.Message
}

try {
  $ocrResult = Wait-WinRtAsyncResult `
    -AsyncOperation ($ocrEngine.RecognizeAsync($bitmap)) `
    -ResultType ([Windows.Media.Ocr.OcrResult])
} catch {
  Write-Failure `
    -Code 'ocr_runtime_failed' `
    -Message 'Windows OCR failed while recognizing text from the image.' `
    -Details $_.Exception.Message
}

$text = $ocrResult.Text
if ($null -eq $text) {
  $text = ''
}

Write-Success -Text $text -Diagnostics $diagnostics
