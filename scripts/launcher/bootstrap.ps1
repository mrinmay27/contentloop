# ContentLoop one-click bootstrap (Windows).
# Mirrors scripts/launcher/bootstrap.sh — keep the two in sync.
$ErrorActionPreference = 'Stop'

$NodeVersion = 'v24.18.0'
$AppPort = if ($env:PORT) { $env:PORT } else { '4173' }

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
$Runtime = Join-Path $Root '.runtime'
$NodeDir = Join-Path $Runtime 'node'
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

function Fail($msg) {
  Write-Host ''
  Write-Host '──────────────────────────────────────────────'
  Write-Host 'ContentLoop could not start.'
  Write-Host $msg
  Write-Host '──────────────────────────────────────────────'
  Write-Host ''
  Read-Host 'Press Enter to close this window'
  exit 1
}

# ── 1/4 Node ────────────────────────────────────────────────────────────────
$NodeExe = Join-Path $NodeDir 'node.exe'
$NodeBin = $null
if (Test-Path $NodeExe) {
  $NodeBin = $NodeExe
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
  $v = (& node -v)
  & node (Join-Path $Root 'scripts\launcher\lib.mjs') node-ok $v
  if ($LASTEXITCODE -eq 0) { $NodeBin = (Get-Command node).Source }
}

if (-not $NodeBin) {
  Write-Host '[1/4] Setting up Node.js (one-time, about 50 MB)...'
  $zip  = "node-$NodeVersion-win-x64.zip"
  $tmp  = Join-Path $Runtime 'tmp'
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/$zip" -OutFile (Join-Path $tmp $zip) -UseBasicParsing
    Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -OutFile (Join-Path $tmp 'SHASUMS256.txt') -UseBasicParsing
  } catch { Fail 'Could not download Node.js. Check your internet connection and try again.' }

  $expected = (Select-String -Path (Join-Path $tmp 'SHASUMS256.txt') -Pattern ([regex]::Escape($zip)) |
               Select-Object -First 1).Line.Split(' ')[0]
  $actual = (Get-FileHash (Join-Path $tmp $zip) -Algorithm SHA256).Hash.ToLower()
  if (-not $expected -or $expected.ToLower() -ne $actual) {
    Fail 'The downloaded Node.js file failed its security check. Nothing was installed. Please try again.'
  }

  try {
    Expand-Archive -Path (Join-Path $tmp $zip) -DestinationPath $tmp -Force
    $inner = Join-Path $tmp "node-$NodeVersion-win-x64"
    New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
    Copy-Item "$inner\*" $NodeDir -Recurse -Force
  } catch { Fail 'Could not unpack Node.js.' }
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  $NodeBin = $NodeExe
} else {
  Write-Host '[1/4] Node.js ready.'
}

$NodeHome = Split-Path $NodeBin -Parent
$env:PATH = "$NodeHome;$env:PATH"
$NpmCli = Join-Path $NodeHome 'node_modules\npm\bin\npm-cli.js'
function Run-Npm { param([string[]]$NpmArgs)
  if (Test-Path $NpmCli) { & $NodeBin $NpmCli @NpmArgs } else { & npm @NpmArgs }
  if ($LASTEXITCODE -ne 0) { throw "npm $($NpmArgs -join ' ') failed" }
}

# ── 2/4 Dependencies ────────────────────────────────────────────────────────
$wantHash = & $NodeBin (Join-Path $Root 'scripts\launcher\lib.mjs') deps-hash (Join-Path $Root 'package-lock.json')
$hashFile = Join-Path $Runtime '.deps-hash'
$haveHash = if (Test-Path $hashFile) { Get-Content $hashFile -Raw } else { 'none' }
if (-not (Test-Path (Join-Path $Root 'node_modules')) -or $wantHash -ne $haveHash) {
  Write-Host '[2/4] Installing ContentLoop (one-time, a few minutes)...'
  try { Run-Npm @('ci','--no-audit','--no-fund') }
  catch { Fail 'Installing dependencies failed. Check your internet connection and try again.' }
  Set-Content -Path $hashFile -Value $wantHash -NoNewline
} else {
  Write-Host '[2/4] Dependencies ready.'
}

# ── 3/4 Build ───────────────────────────────────────────────────────────────
$mainJs = Join-Path $Root 'dist\src\desktop\main.js'
$needsBuild = -not (Test-Path (Join-Path $Root 'dist-web\index.html')) -or -not (Test-Path $mainJs)
# See bootstrap.sh: prebuilt bundles have no source tree, so skip the mtime check.
if (-not $needsBuild -and (Test-Path (Join-Path $Root 'src\api\server.ts'))) {
  $builtAt = (Get-Item $mainJs).LastWriteTimeUtc
  $newer = Get-ChildItem (Join-Path $Root 'src') -Recurse -File -ErrorAction SilentlyContinue |
           Where-Object { $_.LastWriteTimeUtc -gt $builtAt } | Select-Object -First 1
  if ($newer) { $needsBuild = $true }
}
if ($needsBuild) {
  Write-Host '[3/4] Preparing the app...'
  try { Run-Npm @('run','build') }
  catch { Fail 'Building the app failed. Please report this with the messages above.' }
} else {
  Write-Host '[3/4] App ready.'
}

# ── 4/4 Launch ──────────────────────────────────────────────────────────────
Write-Host '[4/4] Starting ContentLoop...'
$env:PORT = $AppPort
$app = Start-Process -FilePath $NodeBin -ArgumentList $mainJs -NoNewWindow -PassThru
$url = "http://localhost:$AppPort"
for ($i = 0; $i -lt 120; $i++) {
  try { Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { }
  if ($app.HasExited) { Fail 'ContentLoop stopped while starting up. See the messages above.' }
  Start-Sleep -Seconds 1
}
Write-Host ''
Write-Host "ContentLoop is running at $url"
Write-Host 'Keep this window open while you use it. Close it (or press Ctrl-C) to stop.'
Write-Host ''
Start-Process $url
Wait-Process -Id $app.Id
