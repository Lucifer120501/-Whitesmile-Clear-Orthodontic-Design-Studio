#!/usr/bin/env pwsh
param(
    [Parameter(Position=0)]
    [string]$Command = 'full',
    [Parameter(Position=1)]
    [string]$TargetPath = ''
)
$Root = Split-Path -Parent $PSCommandPath
$VenvPy = Join-Path $Root ".venv" "Scripts" "python.exe"
$PipePy = Join-Path $Root "aligner_pipeline" "run_pipeline.py"
$AutoPy = Join-Path $Root "aligner_pipeline" "auto_pipeline.py"
$SegPy = Join-Path $Root "aligner_pipeline" "run_meshsegnet_infer.py"
$Stls = Join-Path $Root "segmented_stls"
$Blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
$Date = Get-Date -Format "yyyy-MM-dd"

switch ($Command) {
    'full' {
        Write-Host "`n=== FULL PIPELINE (33 stages, shell, undercut) ==="
        & $VenvPy $PipePy all --stls $Stls --output "case_$Date" --stages 33 --shell 0.75 --undercut 45 --blender $Blender
    }
    'quick' {
        Write-Host "`n=== QUICK DEMO (5 stages, no shell) ==="
        & $VenvPy $PipePy all --stls $Stls --output "case_quick" --stages 5 --shell 0 --undercut 0 --blender $Blender
    }
    'shell' {
        Write-Host "`n=== SHELL TEST (5 stages, 0.75mm shell) ==="
        & $VenvPy $PipePy all --stls $Stls --output "case_shell" --stages 5 --shell 0.75 --undercut 0 --blender $Blender
    }
    'metadata' {
        Write-Host "`n=== METADATA ONLY ==="
        & $VenvPy $PipePy phase2 --stls $Stls -o "tooth_metadata.json"
    }
    'openscad' {
        Write-Host "`n=== OPENSCAD ==="
        $p = Read-Host "Enter staging JSON path"
        & $VenvPy $PipePy openscad --staging $p -o "openscad_output" --shell 0.75
    }
    'ui' {
        Write-Host "`n=== ELECTRON UI ==="
        Write-Host "Run in TWO terminals:`n"
        Write-Host "  Terminal 1: cd aligner-ui && npx vite"
        Write-Host "  Terminal 2: cd aligner-ui && npx electron .`n"
    }
    'validate' {
        Write-Host "`n=== VALIDATE ==="
        $p = Read-Host "Enter staging JSON path"
        & $VenvPy $PipePy validate --staging $p
    }
    'segment' {
        Write-Host "`n=== AI SEGMENTATION ==="
        $stl = if ($TargetPath) { $TargetPath } else { Read-Host "Enter full arch STL path" }
        $arch = Read-Host "Arch type (upper/lower)"
        & $VenvPy $SegPy $stl -o "segmented_$arch" --$arch
    }
    'auto' {
        Write-Host "`n=== AUTO PIPELINE ==="
        $target = if ($TargetPath) { $TargetPath } else { Read-Host "Enter patient folder path" }
        & $VenvPy $AutoPy $target --stages 33 --shell 0.75 --undercut 45 --blender $Blender
    }
    'watch' {
        Write-Host "`n=== WATCH MODE ==="
        $dir = if ($TargetPath) { $TargetPath } else { Read-Host "Enter directory to watch" }
        & $VenvPy $AutoPy --watch $dir --blender $Blender
    }
    'all-patients' {
        Write-Host "`n=== ALL PATIENTS ==="
        $dir = if ($TargetPath) { $TargetPath } else { Read-Host "Enter patients directory" }
        & $VenvPy $AutoPy --all $dir --stages 33 --shell 0.75 --undercut 45 --blender $Blender
    }
    default {
        Write-Host "`nCommands: full, quick, shell, metadata, openscad, ui, validate"
        Write-Host "          segment, auto [path], watch [dir], all-patients [dir]`n"
    }
}
