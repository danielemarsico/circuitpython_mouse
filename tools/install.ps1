<#
.SYNOPSIS
    Install / upgrade the dongle firmware payload on a mounted CIRCUITPY drive.

.EXAMPLE
    .\install.ps1
    .\install.ps1 -Target E:\

.NOTES
    Works both inside the extracted release zip (payload in .\CIRCUITPY) and in
    a repository checkout (payload in ..\device).
    If PowerShell blocks the script, run it as:
        powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
    [string]$Target
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$payload = Join-Path $scriptDir 'CIRCUITPY'
if (-not (Test-Path $payload)) {
    $payload = Join-Path (Split-Path -Parent $scriptDir) 'device'
}
if (-not (Test-Path $payload)) {
    throw "Cannot find the payload (expected .\CIRCUITPY or ..\device)"
}

if (-not $Target) {
    $drive = Get-Volume |
        Where-Object { $_.FileSystemLabel -eq 'CIRCUITPY' -and $_.DriveLetter } |
        Select-Object -First 1
    if (-not $drive) {
        throw @"
No CIRCUITPY drive found.

If boot.py is already installed the drive is hidden by design: unplug the
dongle, hold the on-board button, plug it back in, then re-run this script.
You can also pass the drive explicitly:  .\install.ps1 -Target E:\
"@
    }
    $Target = "$($drive.DriveLetter):\"
}

if (-not (Test-Path $Target)) {
    throw "$Target is not accessible"
}

Write-Host "Payload: $payload"
Write-Host "Target:  $Target"

# secret.txt is user data: never overwrite an existing one.
$targetSecret = Join-Path $Target 'secret.txt'
if (-not (Test-Path $targetSecret)) {
    $sample = Join-Path $scriptDir 'secret.txt.example'
    if (-not (Test-Path $sample)) { $sample = Join-Path $payload 'secret.txt' }
    if (Test-Path $sample) {
        Copy-Item $sample $targetSecret
        Write-Host 'Created secret.txt (edit it to set your CIPHER password)'
    }
} else {
    Write-Host 'Kept existing secret.txt'
}

foreach ($file in @('boot.py', 'code.py')) {
    $source = Join-Path $payload $file
    if (Test-Path $source) {
        Copy-Item $source (Join-Path $Target $file) -Force
        Write-Host "Copied $file"
    }
}

$libSource = Join-Path $payload 'lib'
if (Test-Path $libSource) {
    $libTarget = Join-Path $Target 'lib'
    if (-not (Test-Path $libTarget)) { New-Item -ItemType Directory -Path $libTarget | Out-Null }
    Copy-Item (Join-Path $libSource '*') $libTarget -Recurse -Force
    Write-Host 'Copied lib/'
}

Write-Host 'Done. Unplug and re-plug the dongle (without holding the button) to run it.'
