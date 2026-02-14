param(
  [Parameter(Mandatory = $true)]
  [string]$ImagePath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

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

try {
  if (-not (Test-Path -LiteralPath $ImagePath)) {
    throw "Image file not found: $ImagePath"
  }

  Add-Type -AssemblyName System.Runtime.WindowsRuntime

  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]

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

  $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $ocrEngine) {
    throw 'Windows OCR engine is unavailable for current user profile languages.'
  }

  $ocrResult = Wait-WinRtAsyncResult `
    -AsyncOperation ($ocrEngine.RecognizeAsync($bitmap)) `
    -ResultType ([Windows.Media.Ocr.OcrResult])

  $text = $ocrResult.Text
  if ($null -eq $text) {
    $text = ''
  }

  Write-Output (@{ text = $text } | ConvertTo-Json -Compress)
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
