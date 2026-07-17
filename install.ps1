# Patter installer — downloads the latest release NSIS installer and runs it silently.
#   irm https://raw.githubusercontent.com/srikark283/patter/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Repo = "srikark283/patter"

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64" -and $env:PROCESSOR_ARCHITEW6432 -ne "AMD64") {
    Write-Error "Patter requires a 64-bit (x64) Windows PC."
    exit 1
}

Write-Host "Finding latest release..."
$release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like "*_x64-setup.exe" } | Select-Object -First 1
if (-not $asset) {
    Write-Error "No Windows installer found in the latest release."
    exit 1
}

$installer = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installer

Write-Host "Installing Patter..."
Start-Process -FilePath $installer -ArgumentList "/S" -Wait

Write-Host "Done — Patter is installed. Launch it from the Start menu."
