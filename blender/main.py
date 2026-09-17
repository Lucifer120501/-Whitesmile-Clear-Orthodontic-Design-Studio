#!/usr/bin/env python3
"""
Headless Blender Runner — Main Controller
=========================================
Orchestrates headless Blender execution for dental STL processing.

This program:
  1. Locates the Blender executable (via .env or system PATH).
  2. Invokes Blender in background/headless mode (no GUI).
  3. Passes input/output STL paths to the Blender Python script
     using the '--' argument separator (so Blender ignores them).
  4. Captures stdout/stderr, enforces a timeout, and reports errors.

Usage:
  python main.py --input scan.stl --output processed.stl

Requirements:
  - Blender 3.0+ installed and accessible (set BLENDER_PATH in .env)
  - Python 3.10+
"""

import argparse
import os
import subprocess
import sys
import shutil
from pathlib import Path

# Optional: load .env if python-dotenv is installed
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── Constants ──────────────────────────────────────────────────────────

# Default timeout per run (seconds) — 10 minutes for large STL files
DEFAULT_TIMEOUT_SECONDS = 600

# Path to the Blender Python script that runs inside Blender
SCRIPT_DIR = Path(__file__).parent.resolve()
BLENDER_SCRIPT = SCRIPT_DIR / "blender_script.py"


def resolve_blender_path() -> str:
    """
    Resolve the Blender executable path from:
      1. BLENDER_PATH environment variable (from .env)
      2. 'blender' on system PATH (Linux/macOS typical)
      3. Common install locations per OS

    Returns:
        str: Absolute path to the Blender executable.

    Raises:
        FileNotFoundError: If Blender cannot be found anywhere.
    """
    # 1. Check .env variable
    env_path = os.getenv("BLENDER_PATH")
    if env_path:
        resolved = shutil.which(env_path) or env_path
        if Path(resolved).exists():
            return str(Path(resolved).resolve())
        raise FileNotFoundError(
            f"BLENDER_PATH is set to '{env_path}', but no executable exists there.\n"
            f"  Update your .env file with the correct path."
        )

    # 2. Check system PATH
    which_blender = shutil.which("blender")
    if which_blender:
        return which_blender

    # 3. OS-specific fallback paths
    system = sys.platform
    fallback_paths = []

    if system == "win32":
        # Windows: common install locations
        program_files = os.environ.get("ProgramFiles", "C:\\Program Files")
        program_files_x86 = os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")
        fallback_paths = [
            os.path.join(program_files, "Blender Foundation", "Blender 4.2", "blender.exe"),
            os.path.join(program_files, "Blender Foundation", "Blender 4.1", "blender.exe"),
            os.path.join(program_files, "Blender Foundation", "Blender 4.0", "blender.exe"),
            os.path.join(program_files, "Blender Foundation", "Blender 3.6", "blender.exe"),
            os.path.join(program_files, "Blender Foundation", "Blender 3.5", "blender.exe"),
            os.path.join(program_files, "Blender Foundation", "Blender 3.4", "blender.exe"),
            os.path.join(program_files_x86, "Blender Foundation", "Blender 4.2", "blender.exe"),
            os.path.join(program_files_x86, "Blender Foundation", "Blender 4.1", "blender.exe"),
            # Microsoft Store install path
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WindowsApps", "blender.exe"),
        ]
    elif system == "darwin":
        # macOS: .app bundle
        fallback_paths = [
            "/Applications/Blender.app/Contents/MacOS/Blender",
            "/Applications/Blender 4.2.app/Contents/MacOS/Blender",
            "/Applications/Blender 4.1.app/Contents/MacOS/Blender",
            "/Applications/Blender 4.0.app/Contents/MacOS/Blender",
        ]
    else:
        # Linux: snap and standard paths
        fallback_paths = [
            "/snap/bin/blender",
            "/usr/bin/blender",
            "/usr/local/bin/blender",
        ]

    for candidate in fallback_paths:
        if Path(candidate).exists():
            return candidate

    raise FileNotFoundError(
        "Blender executable not found.\n"
        "  Install Blender (https://www.blender.org/download/) and either:\n"
        "    a) Add it to your system PATH, or\n"
        "    b) Set BLENDER_PATH in your .env file\n"
        "  Example .env:  BLENDER_PATH=\"C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe\""
    )


def build_command(
    blender_path: str,
    blender_script: Path,
    input_stl: str,
    output_stl: str,
    extra_args: list[str] | None = None,
) -> list[str]:
    """
    Build the Blender headless command with proper '--' argument separation.

    The '--' separator is CRITICAL: everything before it is consumed by Blender,
    everything after it is passed to the Python script via sys.argv.

    Command structure:
      blender --background --python blender_script.py -- \
          --input="scan.stl" --output="processed.stl"

    Args:
        blender_path: Path to the Blender executable.
        blender_script: Path to the .py script for Blender to run.
        input_stl: Absolute path to the input STL file.
        output_stl: Absolute path for the output STL file.
        extra_args: Optional extra arguments to pass to the Blender script.

    Returns:
        list[str]: The full command as a list (safe, no shell injection).
    """
    cmd = [
        blender_path,
        "--background",          # Run headless (no GUI window)
        "--python", str(blender_script),
        "--",                    # ← Everything after this goes to the Python script
        f"--input={input_stl}",
        f"--output={output_stl}",
    ]
    if extra_args:
        cmd.extend(extra_args)
    return cmd


def run_blender(
    input_stl: str,
    output_stl: str,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
    verbose: bool = True,
) -> dict:
    """
    Execute Blender headlessly with the given input/output STL paths.

    Args:
        input_stl:  Path to the input STL file to process.
        output_stl: Path where the processed STL should be saved.
        timeout:    Maximum seconds to wait before killing the process.
        verbose:    If True, streams Blender's stdout/stderr in real-time.

    Returns:
        dict with keys:
            - success (bool):       Whether Blender exited cleanly.
            - return_code (int):    The process exit code.
            - stdout (str):         Captured standard output.
            - stderr (str):         Captured standard error.
            - output_path (str):    The output STL path (exists if success).
    """
    # Validate input file exists
    input_path = Path(input_stl)
    if not input_path.exists():
        return {
            "success": False,
            "return_code": -1,
            "stdout": "",
            "stderr": f"Input file not found: {input_stl}",
            "output_path": output_stl,
        }

    # Ensure output directory exists
    output_path = Path(output_stl)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Resolve blender
    try:
        blender_path = resolve_blender_path()
    except FileNotFoundError as e:
        return {
            "success": False,
            "return_code": -1,
            "stdout": "",
            "stderr": str(e),
            "output_path": output_stl,
        }

    # Build command
    cmd = build_command(blender_path, BLENDER_SCRIPT, input_stl, output_stl)

    if verbose:
        print(f"🔧 Blender: {blender_path}")
        print(f"📥 Input:   {input_stl}")
        print(f"📤 Output:  {output_stl}")
        print(f"⏱  Timeout: {timeout}s")
        print(f"⚙️  Command: {' '.join(cmd)}")
        print("─" * 60)

    # Run Blender with subprocess
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )

        stdout_lines: list[str] = []
        stderr_lines: list[str] = []

        # Stream output in real-time if verbose
        if verbose:
            import threading

            def stream_reader(stream, store, prefix=""):
                for line in iter(stream.readline, ""):
                    if line:
                        store.append(line)
                        if verbose:
                            print(f"{prefix}{line}", end="", flush=True)
                stream.close()

            stdout_thread = threading.Thread(
                target=stream_reader, args=(process.stdout, stdout_lines, "  [Blender] "), daemon=True
            )
            stderr_thread = threading.Thread(
                target=stream_reader, args=(process.stderr, stderr_lines, "  [Error] "), daemon=True
            )
            stdout_thread.start()
            stderr_thread.start()

            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                return {
                    "success": False,
                    "return_code": -1,
                    "stdout": "".join(stdout_lines),
                    "stderr": f"Process timed out after {timeout} seconds. The STL may be too large or Blender hung.",
                    "output_path": output_stl,
                }

            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)

        else:
            # Non-verbose: just capture all output
            try:
                stdout_data, stderr_data = process.communicate(timeout=timeout)
                stdout_lines = [stdout_data] if stdout_data else []
                stderr_lines = [stderr_data] if stderr_data else []
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                return {
                    "success": False,
                    "return_code": -1,
                    "stdout": "",
                    "stderr": f"Process timed out after {timeout} seconds.",
                    "output_path": output_stl,
                }

        return_code = process.returncode
        stdout_full = "".join(stdout_lines)
        stderr_full = "".join(stderr_lines)

        # Basic diagnostic
        success = return_code == 0 and output_path.exists()

        if verbose:
            print("─" * 60)
            if success:
                print(f"✅ Success — output saved to: {output_stl}")
            else:
                print(f"❌ Failed (exit code {return_code})")

        return {
            "success": success,
            "return_code": return_code,
            "stdout": stdout_full,
            "stderr": stderr_full,
            "output_path": output_stl,
        }

    except FileNotFoundError:
        return {
            "success": False,
            "return_code": -1,
            "stdout": "",
            "stderr": (
                f"Blender executable not found at: {blender_path}\n"
                f"  Verify BLENDER_PATH in your .env file or add Blender to your system PATH."
            ),
            "output_path": output_stl,
        }
    except Exception as e:
        return {
            "success": False,
            "return_code": -1,
            "stdout": "",
            "stderr": f"Unexpected error launching Blender: {e}",
            "output_path": output_stl,
        }


# ── CLI Entry Point ────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Headless Blender Runner for dental STL processing.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py --input scan.stl --output processed.stl
  python main.py --input ./uploads/case1.stl --output ./output/case1_finished.stl --timeout 300
        """,
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to the input STL file to process.",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path where the processed STL file will be saved.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Max execution time in seconds (default: {DEFAULT_TIMEOUT_SECONDS}).",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress real-time Blender output logging.",
    )
    parser.add_argument(
        "--extra",
        action="append",
        help="Extra arguments to forward to the Blender script (can be repeated).",
    )

    args = parser.parse_args()

    result = run_blender(
        input_stl=args.input,
        output_stl=args.output,
        timeout=args.timeout,
        verbose=not args.quiet,
    )

    # Exit with appropriate code
    if result["success"]:
        sys.exit(0)
    else:
        print(f"\n❌ Error: {result['stderr']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
