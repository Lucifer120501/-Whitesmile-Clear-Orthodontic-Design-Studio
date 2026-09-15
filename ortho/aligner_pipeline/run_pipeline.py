"""
Clear Aligner CAD Pipeline — CLI orchestrator.

Usage
-----
    python run_pipeline.py all --stls segmented_stls --output case_001 --stages 20
    python run_pipeline.py plan --stls segmented_stls --output case_001
    python run_pipeline.py plan-ui
    python run_pipeline.py stage --plan treatment_plan.json --stage 0
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# --- Pipeline modules ---
from config.treatment_plan import (
    TreatmentPlan,
    ToothMove,
    plan_to_json,
    plan_from_json,
    save_plan,
    load_plan,
)
from config.pipeline_params import (
    GRID_SIZE, DET_CUT, GUM_CUT, MIN_CELLS,
    SHELL_THICKNESS_MM, OFFSET_MM, UNDERCUT_ANGLE_DEG, GINGIVA_MARGIN_MM,
)
from plan.plan_io import discover_stl_files
from plan.staging import compute_staging, compute_staging_nonlinear
from blender.run_blender import BlenderRunner


# ===================================================================
#  Utility
# ===================================================================

def _resolve_blender() -> str:
    """Find Blender, with user override via BLENDER_EXE env var."""
    exe = os.environ.get("BLENDER_EXE", "")
    if exe and os.path.isfile(exe):
        return exe
    runner = BlenderRunner()
    return runner.blender_exe


def _default_output_dir(case_name: str) -> str:
    return os.path.join(os.getcwd(), case_name)


# ===================================================================
#  Subcommands
# ===================================================================

def cmd_plan(args):
    """Create a new treatment plan by scanning STL directory.

    Generates a skeleton JSON with discovered teeth and zero movements.
    """
    stl_dir = args.stls
    if not os.path.isdir(stl_dir):
        print(f"[pipeline] ERROR: STL directory not found: {stl_dir}")
        sys.exit(1)

    tooth_map = discover_stl_files(stl_dir)
    tooth_numbers = sorted(t for t in tooth_map if t != 0)
    gingiva_path = tooth_map.get(0, "")

    output_dir = args.output or _default_output_dir(f"case_{len(tooth_numbers)}t")

    plan = TreatmentPlan(
        patient_id=args.patient_id or "unknown",
        case_name=os.path.basename(output_dir),
        description=f"Auto-generated plan for {len(tooth_numbers)} teeth",
        tooth_numbers=tooth_numbers,
        num_stages=args.stages,
        shell_thickness_mm=args.shell,
        offset_mm=args.offset,
        undercut_block_angle=args.undercut,
        gingiva_margin_mm=args.margin,
        attachments_enabled=not args.no_attachments,
        stl_dir=stl_dir,
        output_dir=output_dir,
        blender_exe=args.blender or _resolve_blender(),
        # Zero movements are implicit — user edits them
    )

    # Save
    os.makedirs(output_dir, exist_ok=True)
    plan_path = os.path.join(output_dir, "treatment_plan.json")
    save_plan(plan, plan_path)
    print(f"[pipeline] Created skeleton plan: {plan_path}")
    print(f"[pipeline] Detected teeth: {tooth_numbers}")
    print(f"[pipeline] Edit the movements in the JSON, then run:")
    print(f"    python run_pipeline.py all --plan {plan_path}")
    print(f"    # or use the UI:")
    print(f"    python run_pipeline.py plan-ui")


def cmd_plan_ui(args):
    """Launch the interactive treatment plan editor."""
    from ui.plan_editor import main as ui_main
    ui_main()


def cmd_stage(args):
    """Run Blender for a single stage (for debugging / testing)."""
    plan = load_plan(args.plan)
    if not plan.stages:
        print("[pipeline] Computing stages from movements...")
        plan.stages = compute_staging(plan)

    stage_index = args.stage
    if stage_index < 0 or stage_index >= len(plan.stages):
        print(f"[pipeline] ERROR: stage {stage_index} out of range (0-{len(plan.stages) - 1})")
        sys.exit(1)

    stage = plan.stages[stage_index]
    tooth_map = discover_stl_files(plan.stl_dir)
    gingiva_path = tooth_map.get(0, "")

    # Convert stage positions to dict-of-dict
    positions = {
        tn: {
            "tx": m.tx, "ty": m.ty, "tz": m.tz,
            "rx": m.rx, "ry": m.ry, "rz": m.rz,
        }
        for tn, m in stage.tooth_positions.items()
    }

    # Attachments
    attachments = {}
    for tn, move in plan.movements.items():
        if move.attachment_type:
            attachments[tn] = {
                "type": move.attachment_type,
                "size": list(move.attachment_size),
                "pos": [move.tx, move.ty, move.tz + 3],  # approximate
            }

    blender_exe = args.blender or plan.blender_exe or _resolve_blender()
    runner = BlenderRunner(blender_exe=blender_exe)

    result = runner.run_stage(
        stl_dir=plan.stl_dir,
        gingiva_stl=gingiva_path,
        output_dir=plan.output_dir,
        stage_index=stage_index,
        num_stages=len(plan.stages),
        tooth_numbers=plan.tooth_numbers,
        positions=positions,
        attachments=attachments,
        shell_thickness=plan.shell_thickness_mm,
        offset_mm=plan.offset_mm,
        undercut_angle=plan.undercut_block_angle,
        gingiva_margin=plan.gingiva_margin_mm,
        attachments_enabled=plan.attachments_enabled,
        export_individual=True,
        export_aligner=True,
        verbose=True,
    )

    if result["success"]:
        print(f"[pipeline] Stage {stage_index} completed in {result['elapsed_s']:.1f}s")
    else:
        print(f"[pipeline] Stage {stage_index} FAILED (code {result['return_code']})")
        sys.exit(1)


def cmd_all(args):
    """Run the full pipeline: validate plan, compute staging, generate all stages."""
    # --- Load / create plan ---
    if args.plan and os.path.isfile(args.plan):
        plan = load_plan(args.plan)
        print(f"[pipeline] Loaded plan: {args.plan}")
    else:
        # Create plan from arguments
        if not args.stls:
            print("[pipeline] ERROR: either --plan or --stls is required")
            sys.exit(1)
        tooth_map = discover_stl_files(args.stls)
        tooth_numbers = sorted(t for t in tooth_map if t != 0)
        output_dir = args.output or _default_output_dir(f"case_{len(tooth_numbers)}t")
        plan = TreatmentPlan(
            patient_id=args.patient_id or "pipeline",
            case_name=os.path.basename(output_dir),
            tooth_numbers=tooth_numbers,
            num_stages=args.stages,
            shell_thickness_mm=args.shell,
            offset_mm=args.offset,
            undercut_block_angle=args.undercut,
            gingiva_margin_mm=args.margin,
            attachments_enabled=not args.no_attachments,
            stl_dir=args.stls,
            output_dir=output_dir,
            blender_exe=args.blender or _resolve_blender(),
        )
        # If a movements file is provided, load it
        if args.movements and os.path.isfile(args.movements):
            with open(args.movements) as f:
                mov_data = json.load(f)
            for k, v in mov_data.items():
                plan.movements[int(k)] = ToothMove(tooth_number=int(k), **v)
            print(f"[pipeline] Loaded {len(mov_data)} movements from {args.movements}")
        else:
            print("[pipeline] WARNING: No movements defined. Teeth will remain at initial positions.")

    # --- Discovery ---
    tooth_map = discover_stl_files(plan.stl_dir)
    gingiva_path = tooth_map.get(0, "")
    if not tooth_map:
        print(f"[pipeline] ERROR: No STL files found in {plan.stl_dir}")
        sys.exit(1)

    # --- Compute staging ---
    if not plan.stages:
        print(f"[pipeline] Computing {plan.num_stages} stages...")
        if args.easing and args.easing != "linear":
            plan.stages = compute_staging_nonlinear(plan, easing=args.easing)
        else:
            plan.stages = compute_staging(plan)

    # --- Save full plan ---
    os.makedirs(plan.output_dir, exist_ok=True)
    plan_path = os.path.join(plan.output_dir, "treatment_plan.json")
    save_plan(plan, plan_path)

    # --- Run ---
    blender_exe = args.blender or plan.blender_exe or _resolve_blender()
    runner = BlenderRunner(blender_exe=blender_exe)

    # Build staged positions list
    staged_positions: list[dict[int, dict]] = []
    for stage in plan.stages:
        pos = {
            tn: {
                "tx": m.tx, "ty": m.ty, "tz": m.tz,
                "rx": m.rx, "ry": m.ry, "rz": m.rz,
            }
            for tn, m in stage.tooth_positions.items()
        }
        staged_positions.append(pos)

    # Attachments
    attachments = {}
    for tn, move in plan.movements.items():
        if move.attachment_type:
            attachments[tn] = {
                "type": move.attachment_type,
                "size": list(move.attachment_size),
                "pos": [move.tx, move.ty, move.tz + 3],
            }

    print(f"[pipeline] Running {len(staged_positions)} stages...")
    t0 = time.time()
    results = runner.run_all_stages(
        stl_dir=plan.stl_dir,
        gingiva_stl=gingiva_path,
        output_dir=plan.output_dir,
        tooth_numbers=plan.tooth_numbers,
        staged_positions=staged_positions,
        attachments=attachments,
        shell_thickness=plan.shell_thickness_mm,
        offset_mm=plan.offset_mm,
        undercut_angle=plan.undercut_block_angle,
        gingiva_margin=plan.gingiva_margin_mm,
        attachments_enabled=plan.attachments_enabled,
        export_individual=True,
        export_aligner=True,
        verbose=True,
    )
    total_time = time.time() - t0

    # Summary
    success_count = sum(1 for r in results if r["success"])
    fail_count = sum(1 for r in results if not r["success"])
    print("=" * 60)
    print(f"[pipeline] DONE — {success_count}/{len(results)} stages succeeded"
          f"{f', {fail_count} failed' if fail_count else ''}")
    print(f"[pipeline] Total time: {total_time:.1f}s")
    print(f"[pipeline] Output: {plan.output_dir}")
    if success_count > 0:
        print(f"[pipeline] Sample output: {os.path.join(plan.output_dir, 'stage_000', 'aligner.stl')}")


# ===================================================================
#  CLI
# ===================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Clear Aligner CAD Pipeline — generate staged aligner STLs via Blender",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--blender", help="Path to Blender executable (default: auto-detect)")
    parser.add_argument("--verbose", "-v", action="store_true", default=True)

    subparsers = parser.add_subparsers(dest="command", help="Sub-commands")

    # --- plan ---
    p_plan = subparsers.add_parser("plan", help="Create a skeleton treatment plan from STL directory")
    p_plan.add_argument("--stls", required=True, help="Directory containing segmented STLs")
    p_plan.add_argument("--output", "-o", help="Output directory")
    p_plan.add_argument("--stages", type=int, default=20, help="Number of stages")
    p_plan.add_argument("--shell", type=float, default=SHELL_THICKNESS_MM, help="Shell thickness (mm)")
    p_plan.add_argument("--offset", type=float, default=OFFSET_MM, help="Offset/gap (mm)")
    p_plan.add_argument("--undercut", type=float, default=UNDERCUT_ANGLE_DEG, help="Undercut block angle (deg)")
    p_plan.add_argument("--margin", type=float, default=GINGIVA_MARGIN_MM, help="Gingiva margin (mm)")
    p_plan.add_argument("--patient-id", default="", help="Patient ID")
    p_plan.add_argument("--no-attachments", action="store_true", help="Disable attachments")

    # --- plan-ui ---
    subparsers.add_parser("plan-ui", help="Launch interactive treatment plan editor")

    # --- stage ---
    p_stage = subparsers.add_parser("stage", help="Run Blender for a single stage (debug)")
    p_stage.add_argument("--plan", required=True, help="Path to treatment plan JSON")
    p_stage.add_argument("--stage", type=int, default=0, help="Stage index to run")
    p_stage.add_argument("--blender", help="Blender executable path")

    # --- all ---
    p_all = subparsers.add_parser("all", help="Run the full pipeline (all stages)")
    p_all.add_argument("--plan", help="Path to existing treatment plan JSON")
    p_all.add_argument("--stls", help="Directory containing segmented STLs (if no plan)")
    p_all.add_argument("--movements", help="JSON file with per-tooth movement targets")
    p_all.add_argument("--output", "-o", help="Output directory")
    p_all.add_argument("--stages", type=int, default=20, help="Number of stages")
    p_all.add_argument("--shell", type=float, default=SHELL_THICKNESS_MM, help="Shell thickness (mm)")
    p_all.add_argument("--offset", type=float, default=OFFSET_MM, help="Offset/gap (mm)")
    p_all.add_argument("--undercut", type=float, default=UNDERCUT_ANGLE_DEG, help="Undercut block angle (deg)")
    p_all.add_argument("--margin", type=float, default=GINGIVA_MARGIN_MM, help="Gingiva margin (mm)")
    p_all.add_argument("--easing", choices=["linear", "ease-out", "ease-in-out"], default="linear",
                       help="Staging easing curve")
    p_all.add_argument("--blender", help="Blender executable path")
    p_all.add_argument("--patient-id", default="", help="Patient ID")
    p_all.add_argument("--no-attachments", action="store_true", help="Disable attachments")

    args = parser.parse_args()

    if args.command == "plan":
        cmd_plan(args)
    elif args.command == "plan-ui":
        cmd_plan_ui(args)
    elif args.command == "stage":
        cmd_stage(args)
    elif args.command == "all":
        cmd_all(args)
    else:
        parser.print_help()


def run_pipeline(
    treatment_plan: str = "",
    stl_dir: str = "",
    gingiva_stl: str = "",
    output_dir: str = "",
    num_stages: int = 20,
    shell_thickness: float = SHELL_THICKNESS_MM,
    offset_mm: float = OFFSET_MM,
    undercut_angle: float = UNDERCUT_ANGLE_DEG,
    gingiva_margin: float = GINGIVA_MARGIN_MM,
    attachments_enabled: bool = True,
    easing: str = "linear",
    export_individual: bool = True,
    export_aligner: bool = True,
    verbose: bool = True,
    skip_confirmation: bool = False,
):
    """Programmatic entry point (called from UI or other scripts)."""
    # Build args namespace
    class FakeArgs:
        pass

    a = FakeArgs()
    a.plan = treatment_plan or None
    a.stls = stl_dir or None
    a.movements = None
    a.output = output_dir or None
    a.stages = num_stages
    a.shell = shell_thickness
    a.offset = offset_mm
    a.undercut = undercut_angle
    a.margin = gingiva_margin
    a.no_attachments = not attachments_enabled
    a.easing = easing
    a.patient_id = ""
    a.blender = None
    a.verbose = verbose

    if a.plan:
        plan = load_plan(a.plan)
        a.stls = plan.stl_dir
        a.output = plan.output_dir

    cmd_all(a)


if __name__ == "__main__":
    main()
