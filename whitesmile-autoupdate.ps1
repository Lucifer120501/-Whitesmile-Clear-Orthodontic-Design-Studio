# ─────────────────────────────────────────────────────────────────────────
#  whitesmile-autoupdate.ps1
#  Polls the GitHub `main` branch and, when a new commit is detected,
#  pulls the code, rebuilds, and restarts the production server so the
#  live app always matches the latest push. Runs 24/7 in the background.
#  Launched automatically by whitesmile-24x7.ps1 at startup.
# ─────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'SilentlyContinue'

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

Write-Log 'Auto-updater started.'

while ($true) {
    Start-Sleep -Seconds $PollSeconds

    # Fetch the latest remote state (do not merge yet)
    git fetch origin main *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Log 'git fetch failed (network or auth). Retrying next cycle.'
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

    # Install any new/changed dependencies
    npm install --omit=dev *>> (Join-Path $LogDir 'install.log')

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
