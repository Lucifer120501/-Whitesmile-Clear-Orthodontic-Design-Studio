# ─────────────────────────────────────────────────────────────────────────
#  whitesmile-24x7.ps1
#  Starts the Whitesmile production server + a Cloudflare quick tunnel so
#  remote users can reach this PC 24/7. Stores the current public URL in
#  server-data\run\current-url.txt. Run as SYSTEM at startup, or manually:
#     powershell -ExecutionPolicy Bypass -File "L:\New folder\beta\whitesmile-24x7.ps1"
# ─────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'SilentlyContinue'

$Project = 'L:\New folder\beta'
$LogDir  = Join-Path $Project 'server-data\run'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Project

# Clear previous run logs / pid / url
Remove-Item (Join-Path $LogDir 'server.pid'), (Join-Path $LogDir 'tunnel.pid'), (Join-Path $LogDir 'current-url.txt') -Force
Remove-Item (Join-Path $LogDir 'server.out.log'), (Join-Path $LogDir 'server.err.log'), (Join-Path $LogDir 'tunnel.out.log'), (Join-Path $LogDir 'tunnel.err.log') -Force

# ── 0) Make sure the production build exists ─────────────────────────────
if (-not (Test-Path (Join-Path $Project 'dist\server.cjs'))) {
    Push-Location $Project
    npm run build *> (Join-Path $LogDir 'build.log')
    Pop-Location
}

# ── 1) Production server ─────────────────────────────────────────────────
$server = Start-Process -FilePath 'node.exe' `
    -ArgumentList 'dist/server.cjs' `
    -WorkingDirectory $Project `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir 'server.out.log') `
    -RedirectStandardError  (Join-Path $LogDir 'server.err.log') `
    -PassThru
Set-Content (Join-Path $LogDir 'server.pid') $server.Id

# ── 3) Cloudflare quick tunnel ───────────────────────────────────────────
# Locate the cached cloudflared binary (fall back to npx if not found).
$cf = Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx" -Recurse -Filter 'cloudflared.exe' `
        -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName

if ($cf) {
    $tunnel = Start-Process -FilePath $cf `
        -ArgumentList @('tunnel','--url','http://localhost:3000') `
        -WorkingDirectory $Project `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir 'tunnel.out.log') `
        -RedirectStandardError  (Join-Path $LogDir 'tunnel.err.log') `
        -PassThru
} else {
    $tunnel = Start-Process -FilePath 'npx.cmd' `
        -ArgumentList @('cloudflared','tunnel','--url','http://localhost:3000') `
        -WorkingDirectory $Project `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir 'tunnel.out.log') `
        -RedirectStandardError  (Join-Path $LogDir 'tunnel.err.log') `
        -PassThru
}
Set-Content (Join-Path $LogDir 'tunnel.pid') $tunnel.Id

# ── 4) Wait for and record the public URL ────────────────────────────────
Start-Sleep -Seconds 12
$log = Get-Content (Join-Path $LogDir 'tunnel.err.log') -Raw -ErrorAction SilentlyContinue
$m = [regex]::Match($log, 'https://[a-z0-9-]+\.trycloudflare\.com')
if ($m.Success) {
    Set-Content (Join-Path $LogDir 'current-url.txt') $m.Value
    Write-Output "Public URL: $($m.Value)"
} else {
    Set-Content (Join-Path $LogDir 'current-url.txt') 'URL not yet available - check server-data\run\tunnel.err.log'
    Write-Output 'Tunnel URL not captured yet. Check server-data\run\tunnel.err.log'
}

# ── 5) Auto-updater (polls GitHub, rebuilds + restarts on new push) ──────
$updater = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',(Join-Path $Project 'whitesmile-autoupdate.ps1') `
    -WorkingDirectory $Project `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir 'autoupdate.out.log') `
    -RedirectStandardError  (Join-Path $LogDir 'autoupdate.err.log') `
    -PassThru
Set-Content (Join-Path $LogDir 'autoupdate.pid') $updater.Id

