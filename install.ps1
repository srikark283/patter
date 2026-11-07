# Verify the signed updater executable before installation. Requires minisign.
$ErrorActionPreference = "Stop"
$Repo = "srikark283/patter"
$PublicKey = "RWSWB+iq5oFAZiomK9u5j+1VWd9EvMuIreux3hoiq1eMYdhMvVMjNILD"
if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64" -and $env:PROCESSOR_ARCHITEW6432 -ne "AMD64") {
    throw "Patter requires a 64-bit (x64) Windows PC."
}
if (-not (Get-Command minisign -ErrorAction SilentlyContinue)) { throw "Install minisign from https://jedisct1.github.io/minisign/ before running this installer." }
$TempDir = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TempDir | Out-Null
try {
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    $asset = $release.assets | Where-Object { $_.name -like "*_x64-setup.exe" } | Select-Object -First 1
    if (-not $asset) { throw "No Windows installer found." }
    $url = [Uri]$asset.browser_download_url
    if ($url.Scheme -ne "https" -or $url.Host -ne "github.com" -or -not $url.AbsolutePath.StartsWith("/$Repo/releases/download/")) { throw "Invalid installer source." }
    $installer = Join-Path $TempDir "patter-setup.exe"
    Invoke-WebRequest -Uri $url.AbsoluteUri -OutFile $installer
    $signature = Invoke-WebRequest -Uri ($url.AbsoluteUri + ".sig")
    $signaturePath = Join-Path $TempDir "installer.minisig"
    [IO.File]::WriteAllBytes($signaturePath, [Convert]::FromBase64String($signature.Content.Trim()))
    & minisign -Vm $installer -x $signaturePath -P $PublicKey
    if ($LASTEXITCODE -ne 0) { throw "Installer signature verification failed." }
    $process = Start-Process -FilePath $installer -ArgumentList "/S" -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installation failed with exit code $($process.ExitCode)." }
    Write-Host "Verified and installed Patter. Launch it from the Start menu."
} finally { Remove-Item -Recurse -Force $TempDir }
