param([string]$Version = "1.0.0")
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ChromeDir = Join-Path $Root "chrome"
$BuildDir = Join-Path $Root "build"
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
Write-Host "CaptureX Chrome Build v$Version" -ForegroundColor Cyan

$ManifestPath = Join-Path $ChromeDir "manifest.json"
$m = Get-Content $ManifestPath | ConvertFrom-Json
$m.version = $Version
$m | ConvertTo-Json -Depth 10 | Set-Content $ManifestPath
Write-Host "Version updated to $Version"

$ZipPath = Join-Path $BuildDir "capturex-chrome-v$Version.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $files = Get-ChildItem -Path $ChromeDir -Recurse -File
    foreach ($file in $files) {
        $relPath = $file.FullName.Substring($ChromeDir.Length).TrimStart('\', '/')
        # Crucial for WebExtensions: ZIP entries MUST use forward slashes!
        $entryName = $relPath.Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $archive.Dispose()
}

Write-Host "ZIP ready: $ZipPath" -ForegroundColor Green
Write-Host "Testing: Load unpacked from chrome://extensions using $ChromeDir"
Write-Host "CWS upload: Use the ZIP file at $ZipPath"
Write-Host "Build complete!" -ForegroundColor Green