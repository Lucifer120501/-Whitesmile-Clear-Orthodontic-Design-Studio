@echo off
REM =====================================================
REM Clear Aligner AI Pipeline — Quick Launcher
REM =====================================================
REM Usage:
REM   run              -> Full pipeline: 33 stages, shell ON, undercut ON
REM   run quick        -> Quick demo: 5 stages, shell OFF
REM   run shell        -> Shell test: 5 stages, shell 0.75mm
REM   run metadata     -> Extract metadata only
REM   run openscad     -> Generate OpenSCAD files from staging plan
REM   run validate     -> Validate staging JSON
REM   run ui           -> Launch Electron desktop app
REM   run segment      -> Run AI segmentation on a patient arch
REM   run auto [path]  -> Full auto pipeline on a patient folder
REM   run watch [dir]  -> Watch directory for new patient cases
REM   run all-patients -> Process ALL patients in a directory
REM =====================================================

set "VENV_PYTHON=%~dp0.venv\Scripts\python.exe"
set "PIPELINE=%~dp0aligner_pipeline\run_pipeline.py"
set "AUTOPIPE=%~dp0aligner_pipeline\auto_pipeline.py"
set "SEGMENT=%~dp0aligner_pipeline\run_meshsegnet_infer.py"
set "STLS=%~dp0segmented_stls"
set "BLENDER=C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"

if "%1"=="quick" goto :quick
if "%1"=="shell" goto :shell
if "%1"=="metadata" goto :metadata
if "%1"=="openscad" goto :openscad
if "%1"=="validate" goto :validate
if "%1"=="ui" goto :ui
if "%1"=="segment" goto :segment
if "%1"=="auto" goto :auto
if "%1"=="watch" goto :watch
if "%1"=="all-patients" goto :allpatients
if "%1"=="" goto :full
goto :help

:full
echo.
echo ========================================
echo  FULL PIPELINE — 33 stages + shell 0.75mm
echo ========================================
"%VENV_PYTHON%" "%PIPELINE%" all --stls "%STLS%" --output "case_full" --stages 33 --shell 0.75 --undercut 45 --blender "%BLENDER%"
goto :eof

:quick
echo.
echo ========================================
echo  QUICK DEMO — 5 stages, no shell
echo ========================================
"%VENV_PYTHON%" "%PIPELINE%" all --stls "%STLS%" --output "case_quick" --stages 5 --shell 0 --undercut 0 --blender "%BLENDER%"
goto :eof

:shell
echo.
echo ========================================
echo  SHELL TEST — 5 stages + 0.75mm shell
echo ========================================
"%VENV_PYTHON%" "%PIPELINE%" all --stls "%STLS%" --output "case_shell" --stages 5 --shell 0.75 --undercut 0 --blender "%BLENDER%"
goto :eof

:metadata
echo.
echo ========================================
echo  METADATA ONLY — extract tooth positions
echo ========================================
"%VENV_PYTHON%" "%PIPELINE%" phase2 --stls "%STLS%" -o "tooth_metadata.json"
goto :eof

:openscad
echo.
echo ========================================
echo  OPENSCAD — generate .scad files from staging
echo ========================================
set /p STAGING="Enter staging JSON path: "
"%VENV_PYTHON%" "%PIPELINE%" openscad --staging "%STAGING%" -o "openscad_output" --shell 0.75
goto :eof

:validate
echo.
echo ========================================
echo  VALIDATE — check staging plan JSON
echo ========================================
set /p STAGING="Enter staging JSON path (or drag file): "
"%VENV_PYTHON%" "%PIPELINE%" validate --staging "%STAGING%"
goto :eof

:segment
echo.
echo ========================================
echo  AI SEGMENTATION — segment full arch scan
echo ========================================
set /p ARCH_STL="Enter full arch STL path: "
set /p ARCH_TYPE="Arch type (upper/lower): "
"%VENV_PYTHON%" "%SEGMENT%" "%ARCH_STL%" -o "segmented_output" --%ARCH_TYPE%
goto :eof

:auto
echo.
echo ========================================
echo  AUTO PIPELINE — fully automated
echo ========================================
set TARGET=%2
if "%TARGET%"=="" set /p TARGET="Enter patient folder path: "
"%VENV_PYTHON%" "%AUTOPIPE%" "%TARGET%" --stages 33 --shell 0.75 --undercut 45 --blender "%BLENDER%"
goto :eof

:watch
echo.
echo ========================================
echo  WATCH MODE — monitor directory for new cases
echo ========================================
set WATCHDIR=%2
if "%WATCHDIR%"=="" set /p WATCHDIR="Enter directory to watch: "
"%VENV_PYTHON%" "%AUTOPIPE%" --watch "%WATCHDIR%" --blender "%BLENDER%"
goto :eof

:allpatients
echo.
echo ========================================
echo  ALL PATIENTS — process every case in directory
echo ========================================
set ALLDIR=%2
if "%ALLDIR%"=="" set /p ALLDIR="Enter patients directory: "
"%VENV_PYTHON%" "%AUTOPIPE%" --all "%ALLDIR%" --stages 33 --shell 0.75 --undercut 45 --blender "%BLENDER%"
goto :eof

:help
echo.
echo Usage: run [command]
echo.
echo Commands:
echo   (blank)        Full pipeline (33 stages, shell, undercut, Blender + OpenSCAD)
echo   quick          Quick demo (5 stages, no shell)
echo   shell          Shell test (5 stages, 0.75mm shell)
echo   metadata       Extract tooth metadata only
echo   openscad       Generate .scad files from a staging plan
echo   ui             Launch Electron desktop app
echo   validate       Validate a staging JSON
echo   segment        Run AI segmentation on a full arch scan
echo   auto [path]    Full auto pipeline on a patient folder
echo   watch [dir]    Watch directory for new patient cases
echo   all-patients   Process ALL patients in a directory
echo.
goto :eof

:ui
echo.
echo ========================================
echo  Starting Electron UI...
echo ========================================
echo.
echo  NOTE: Run these TWO commands in separate terminals:
echo.
echo   Terminal 1:
echo     cd aligner-ui ^&^& npx vite
echo.
echo   Terminal 2 (after Vite is running):
echo     cd aligner-ui ^&^& npx electron .
echo.
goto :eof
