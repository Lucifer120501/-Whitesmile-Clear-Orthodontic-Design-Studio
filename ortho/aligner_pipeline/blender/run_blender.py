"""
Subprocess wrapper to launch Blender headless with the aligner CAD script.

Handles:
- Writing per-stage config JSON to a temp file
- Calling ``blender --background --python aligner_cad.py -- <config>``
- Collecting stdout/stderr and propagating errors
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional


def _find_blender() -> Optional[str]:
    """Locate Blender executable. Checks common paths."""
    candidates = [
        r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.1\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.0\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 3.6\blender.exe",
        # macOS
        "/Applications/Blender.app/Contents/MacOS/Blender",
        # Linux
        "/usr/bin/blender",
        "/snap/bin/blender",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path

    # Try PATH
    try:
        import shutil
        return shutil.which("blender")
    except Exception:
        return None


class BlenderRunner:
    """Manages subprocess calls to Blender for aligner CAD generation."""

    def __init__(
        self,
        blender_exe: Optional[str] = None,
        aligner_script: Optional[str] = None,
        python_env: Optional[dict] = None,
    ):
        """
        Parameters
        ----------
        blender_exe : str, optional
            Path to Blender executable. Auto-detected if omitted.
        aligner_script : str, optional
            Path to ``aligner_cad.py``. Resolved relative to this file.
        python_env : dict, optional
            Extra environment variables for the subprocess.
        """
        self.blender_exe = blender_exe or _find_blender()
        if not self.blender_exe:
            raise RuntimeError(
                "Blender not found. Install Blender or provide --blender_exe."
            )
        if not os.path.isfile(self.blender_exe):
            raise FileNotFoundError(f"Blender not found at: {self.blender_exe}")

        if aligner_script:
            self.script_path = aligner_script
        else:
            self.script_path = os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "aligner_cad.py",
            )
        if not os.path.isfile(self.script_path):
            raise FileNotFoundError(f"Aligner script not found: {self.script_path}")

        self.python_env = python_env or {}

    # ------------------------------------------------------------------
    #  Build stage config JSON
    # ------------------------------------------------------------------

    def _write_stage_config(
        self,
        stl_dir: str,
        gingiva_stl: str,
        output_dir: str,
        stage_index: int,
        num_stages: int,
        tooth_numbers: list[int],
        positions: dict[int, dict],
        attachments: dict[int, list[dict]],
        shell_thickness: float = 0.75,
        offset_mm: float = 0.1,
        undercut_angle: float = 45.0,
        gingiva_margin: float = 1.0,
        attachments_enabled: bool = True,
        export_individual: bool = True,
        export_aligner: bool = True,
    ) -> str:
        """Write stage config to a temp JSON file. Returns the file path."""
        config = {
            "stl_dir": stl_dir,
            "gingiva_stl": gingiva_stl,
            "output_dir": output_dir,
            "stage_index": stage_index,
            "num_stages": num_stages,
            "tooth_numbers": tooth_numbers,
            "positions": {str(k): v for k, v in positions.items()},
            "attachments": {str(k): v for k, v in attachments.items()},
            "shell_thickness": shell_thickness,
            "offset_mm": offset_mm,
            "undercut_angle": undercut_angle,
            "gingiva_margin": gingiva_margin,
            "attachments_enabled": attachments_enabled,
            "export_individual": export_individual,
            "export_aligner": export_aligner,
        }
        fd, path = tempfile.mkstemp(suffix="_stage_config.json", prefix="aligner_")
        with os.fdopen(fd, "w") as f:
            json.dump(config, f, indent=2)
        return path

    # ------------------------------------------------------------------
    #  Run Blender for a single stage
    # ------------------------------------------------------------------

    def run_stage(
        self,
        stl_dir: str,
        gingiva_stl: str,
        output_dir: str,
        stage_index: int,
        num_stages: int,
        tooth_numbers: list[int],
        positions: dict[int, dict],
        attachments: Optional[dict[int, list[dict]]] = None,
        shell_thickness: float = 0.75,
        offset_mm: float = 0.1,
        undercut_angle: float = 45.0,
        gingiva_margin: float = 1.0,
        attachments_enabled: bool = True,
        export_individual: bool = True,
        export_aligner: bool = True,
        verbose: bool = True,
    ) -> dict:
        """Run Blender for one treatment stage.

        Returns a dict with ``success``, ``stdout``, ``stderr``, ``config_path``.
        """
        config_path = self._write_stage_config(
            stl_dir=stl_dir,
            gingiva_stl=gingiva_stl,
            output_dir=output_dir,
            stage_index=stage_index,
            num_stages=num_stages,
            tooth_numbers=tooth_numbers,
            positions=positions,
            attachments=attachments or {},
            shell_thickness=shell_thickness,
            offset_mm=offset_mm,
            undercut_angle=undercut_angle,
            gingiva_margin=gingiva_margin,
            attachments_enabled=attachments_enabled,
            export_individual=export_individual,
            export_aligner=export_aligner,
        )

        cmd = [
            self.blender_exe,
            "--background",
            "--python", self.script_path,
            "--",
            config_path,
        ]

        if verbose:
            print(f"[run_blender] Running: {' '.join(cmd)}")

        env = os.environ.copy()
        env.update(self.python_env)
        # Ensure UTF-8 output from Blender subprocess
        env.setdefault("PYTHONIOENCODING", "utf-8")

        t0 = time.time()
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
            timeout=600,  # 10 min per stage max
        )
        elapsed = time.time() - t0

        stdout = result.stdout
        stderr = result.stderr
        success = result.returncode == 0

        if verbose:
            print(f"[run_blender] Stage {stage_index} finished in {elapsed:.1f}s "
                  f"(return code {result.returncode})")
            if stdout:
                # Print only last few lines for brevity
                lines = stdout.strip().split("\n")
                for line in lines[-8:]:
                    print(f"  | {line}")
            if stderr:
                for line in stderr.strip().split("\n")[-8:]:
                    print(f"  ! {line}", file=sys.stderr)

        # Clean up config file
        try:
            os.unlink(config_path)
        except OSError:
            pass

        return {
            "success": success,
            "stdout": stdout,
            "stderr": stderr,
            "elapsed_s": elapsed,
            "return_code": result.returncode,
            "config_path": config_path,
        }

    # ------------------------------------------------------------------
    #  Run all stages
    # ------------------------------------------------------------------

    def run_all_stages(
        self,
        stl_dir: str,
        gingiva_stl: str,
        output_dir: str,
        tooth_numbers: list[int],
        staged_positions: list[dict[int, dict]],
        attachments: Optional[dict[int, list[dict]]] = None,
        shell_thickness: float = 0.75,
        offset_mm: float = 0.1,
        undercut_angle: float = 45.0,
        gingiva_margin: float = 1.0,
        attachments_enabled: bool = True,
        export_individual: bool = True,
        export_aligner: bool = True,
        verbose: bool = True,
        stages: Optional[list[int]] = None,
    ) -> list[dict]:
        """Run Blender for multiple stages.

        *staged_positions* is a list of per-stage position dicts (same order
        as stages). Optionally pass *stages* to filter which stage indices
        to process.
        """
        num_stages = len(staged_positions)
        results = []

        for si, positions in enumerate(staged_positions):
            if stages is not None and si not in stages:
                continue

            result = self.run_stage(
                stl_dir=stl_dir,
                gingiva_stl=gingiva_stl,
                output_dir=output_dir,
                stage_index=si,
                num_stages=num_stages,
                tooth_numbers=tooth_numbers,
                positions=positions,
                attachments=attachments,
                shell_thickness=shell_thickness,
                offset_mm=offset_mm,
                undercut_angle=undercut_angle,
                gingiva_margin=gingiva_margin,
                attachments_enabled=attachments_enabled,
                export_individual=export_individual,
                export_aligner=export_aligner,
                verbose=verbose,
            )
            results.append(result)
            if not result["success"]:
                print(f"[run_blender] Stage {si} FAILED — stopping.")
                break

        return results
