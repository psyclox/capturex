param(
    [string]$Version = "",
    [switch]$NoBump
)

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ChromeDir = Join-Path $Root "chrome"
$BuildDir = Join-Path $Root "build"
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

. (Join-Path $PSScriptRoot "version-manager.ps1")

$VersionJsonPath = Join-Path $Root "version.json"
$currentVer = "1.4"
if (Test-Path $VersionJsonPath) {
    $vData = Get-Content $VersionJsonPath -Raw | ConvertFrom-Json
    if ($vData.version) { $currentVer = $vData.version }
}

if ($Version) {
    $targetVer = $Version.TrimStart('v', 'V')
} elseif ($NoBump) {
    $targetVer = $currentVer
} else {
    # If version is currently at 1.4 and this is the initial setup, we can use 1.4 or bump
    $targetVer = $currentVer
}

Update-ProjectVersion -Version $targetVer | Out-Null

Write-Host "CaptureX Chrome Build v$targetVer" -ForegroundColor Cyan

$ZipPath = Join-Path $BuildDir "capturex-chrome-v$targetVer.zip"
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
Write-Host "Build complete for Chrome v$targetVer!" -ForegroundColor Green