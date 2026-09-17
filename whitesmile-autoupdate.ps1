# ─────────────────────────────────────────────────────────────────────────
#  whitesmile-autoupdate.ps1
#  Polls the GitHub `main` branch and, when a new commit is detected,
#  pulls the code, rebuilds, and restarts the production server so the
#  live app always matches the latest push. Runs 24/7 in the background.
#  Launched automatically by whitesmile-24x7.ps1 at startup.
# ─────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'SilentlyContinue'

# Prevent git from spawning a terminal prompt (use credential manager instead)
$env:GIT_TERMINAL_PROMPT = 0

# Clear ALL Copilot-injected GIT_CONFIG_* variables that block the credential manager.
# These variables are injected by Copilot and can set credential.interactive=never,
# which prevents the Windows credential manager from authenticating git operations.
# GIT_CONFIG_COUNT must also be cleared — it tells git how many entries to expect.
Get-ChildItem Env: | Where-Object { $_.Name -match '^GIT_CONFIG' } | ForEach-Object {
    Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue
}

$Project = 'L:\New folder\beta'
$LogDir  = Join-Path $Project 'server-data\run'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Project

$UpdateLog = Join-Path $LogDir 'autoupdate.log'
$PollSeconds = 30

function Write-Log([string]$msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Add-Content -Path $UpdateLog -Value $line
    Write-Output $line
}

function Debug-Env {
    $count = if ($env:GIT_CONFIG_COUNT) { $env:GIT_CONFIG_COUNT } else { 'none' }
    Write-Log "DEBUG: GIT_CONFIG vars: $count"
    for ($i = 0; $i -lt 10; $i++) {
        $key = Get-Item "Env:GIT_CONFIG_KEY_$i" -ErrorAction SilentlyContinue
        $val = Get-Item "Env:GIT_CONFIG_VALUE_$i" -ErrorAction SilentlyContinue
        if ($key -or $val) {
            Write-Log "DEBUG:   GIT_CONFIG_KEY_$i=$($key.Value)"
            Write-Log "DEBUG:   GIT_CONFIG_VALUE_$i=$($val.Value)"
        }
    }
}

function Restart-Server {
    # Kill any existing production server process
    $pidFile = Join-Path $LogDir 'server.pid'
    if (Test-Path $pidFile) {
        $oldPid = (Get-Content $pidFile -Raw).Trim()
        if ($oldPid) {
            $proc = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Log "Stopping old server (pid $oldPid)..."
                Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 3
            }
        }
    }

    # Start the new server (same invocation as whitesmile-24x7.ps1)
    $server = Start-Process -FilePath 'node.exe' `
        -ArgumentList 'dist/server.cjs' `
        -WorkingDirectory $Project `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir 'server.out.log') `
        -RedirectStandardError  (Join-Path $LogDir 'server.err.log') `
        -PassThru
    Set-Content $pidFile $server.Id
    Write-Log "Started new server (pid $($server.Id))."
}

function Test-ServerAlive {
    # Watchdog check: is the tracked server process running AND port 3000 listening?
    $pidFile = Join-Path $LogDir 'server.pid'
    if (-not (Test-Path $pidFile)) { return $false }
    $p = (Get-Content $pidFile -Raw -ErrorAction SilentlyContinue).Trim()
    if (-not $p) { return $false }
    $proc = Get-Process -Id ([int]$p) -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }
    $conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    return [bool]$conn
}

Write-Log 'Auto-updater started.'
Debug-Env

while ($true) {
    Start-Sleep -Seconds $PollSeconds

    # Watchdog: if the server died (e.g. crash), bring it back up
    if (-not (Test-ServerAlive)) {
        Write-Log 'Watchdog: server not responding — restarting...'
        Restart-Server
    }

    # Fetch the latest remote state (do not merge yet)
    Write-Log "DEBUG: Before fetch - GIT_CONFIG vars:"
    Debug-Env
    
    $fetchOut = & git -c credential.interactive=false fetch --quiet origin main 2>&1
    $fetchCode = $LASTEXITCODE
    Write-Log "DEBUG: Fetch exit code: $fetchCode"
    Write-Log "DEBUG: Fetch output: $fetchOut"
    
    if ($fetchCode -ne 0) {
        Write-Log "git fetch failed (code $fetchCode). Retrying next cycle. $fetchOut"
        continue
    }

    $localHead  = (git rev-parse HEAD).Trim()
    $remoteHead = (git rev-parse origin/main).Trim()

    if ($localHead -eq $remoteHead) {
        # No change - nothing to do
        continue
    }

    Write-Log "New commit detected: $remoteHead"

    # Pull the latest code (fast-forward only; local secrets are gitignored)
    git pull --ff-only origin main *>> (Join-Path $LogDir 'pull.log')
    if ($LASTEXITCODE -ne 0) {
        Write-Log 'git pull failed. Skipping this cycle to avoid a broken state.'
        continue
    }

    # Install dependencies (full install - devDependencies are needed for the build)
    npm install *>> (Join-Path $LogDir 'install.log')

    # Rebuild the production bundle / server
    Write-Log 'Rebuilding...'
    $buildOut = npm run build 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log 'Build failed. Keeping previous build running.'
        Add-Content -Path (Join-Path $LogDir 'build.log') -Value ($buildOut | Out-String)
        continue
    }
    Write-Log 'Build succeeded.'

    Restart-Server
    Write-Log 'Update complete, server restarted on new code.'
}
