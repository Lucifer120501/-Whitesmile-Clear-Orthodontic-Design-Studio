#!/usr/bin/env python3
"""
Blender Background Script — STL Processing Pipeline
====================================================
This script runs INSIDE Blender's Python environment (bpy API).
It is NOT executed by a system Python — Blender launches it headlessly.

Workflow executed by Blender:
  1. Parse custom CLI arguments (passed after '--' by main.py).
  2. Clear the default Blender scene (cube, camera, light).
  3. Import a raw dental STL model.
  4. [Optional] Apply processing modifiers (base prep, smoothing, etc.).
  5. Export the processed mesh to a finished STL file.

Receives arguments via sys.argv:
  sys.argv contains everything Blender passes AFTER the '--' separator.
  Example: blender --background --python blender_script.py -- \
               --input="scan.stl" --output="processed.stl"

⚠️ IMPORTANT:
  - This script runs inside Blender's bundled Python, NOT your system Python.
  - External pip packages are NOT available — use only bpy and the stdlib.
  - To test this, run: blender --background --python blender_script.py -- \
        --input="test.stl" --output="out.stl"
"""

import sys
import os
from pathlib import Path

# Blender's bpy module is only available when running inside Blender.
# The import is intentionally placed here (not at module top) so editors
# don't error on it. It will resolve correctly when Blender executes this file.
try:
    import bpy
except ImportError:
    print("ERROR: bpy module not found. This script must be run inside Blender:")
    print("  blender --background --python blender_script.py -- --input=... --output=...")
    sys.exit(1)


# ── Argument Parsing ──────────────────────────────────────────────────
# Blender passes everything after '--' as-is in sys.argv.
# We parse those manually (no argparse to avoid conflicts with Blender's own args).

def parse_script_args() -> dict:
    """
    Parse custom arguments from sys.argv (everything after '--').

    Expects:
        --input=<path>   (required)  Input STL file path
        --output=<path>  (required)  Output STL file path
        --decimate=<float> (optional) Decimate ratio (0.0-1.0), e.g. 0.5 = 50% reduction

    Returns:
        dict with keys: input, output, decimate (or defaults).
    """
    args = {
        "input": None,
        "output": None,
        "decimate": None,  # Optional decimation ratio
    }

    for arg in sys.argv:
        if arg.startswith("--input="):
            args["input"] = arg.split("=", 1)[1].strip('"').strip("'")
        elif arg.startswith("--output="):
            args["output"] = arg.split("=", 1)[1].strip('"').strip("'")
        elif arg.startswith("--decimate="):
            try:
                val = float(arg.split("=", 1)[1].strip('"').strip("'"))
                args["decimate"] = max(0.0, min(1.0, val))  # Clamp 0-1
            except ValueError:
                print(f"  ⚠️  Invalid decimate value, ignoring: {arg}")

    # Validate required args
    missing = [k for k in ("input", "output") if not args[k]]
    if missing:
        print(f"ERROR: Missing required argument(s): {', '.join(missing)}")
        print(f"  Usage: blender --background --python blender_script.py -- \\")
        print(f"         --input=<path> --output=<path> [--decimate=<ratio>]")
        sys.exit(1)

    return args


# ── Scene Management ───────────────────────────────────────────────────

def clear_scene():
    """
    Remove all default objects from the Blender scene.

    Blender starts with a default scene containing a cube, camera, and light.
    We remove everything to start clean before importing the dental model.
    """
    # Switch to OBJECT mode first (required before deletion)
    if bpy.context.active_object:
        bpy.ops.object.mode_set(mode="OBJECT")

    # Select all objects and delete them
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    # Also purge any remaining data blocks (meshes, materials, etc.)
    for data_collection in (bpy.data.meshes, bpy.data.materials,
                            bpy.data.textures, bpy.data.images,
                            bpy.data.cameras, bpy.data.lights,
                            bpy.data.collections):
        for item in data_collection:
            data_collection.remove(item, do_unlink=True)

    print("  ✅ Scene cleared")


# ── STL Import ─────────────────────────────────────────────────────────

def import_stl(filepath: str) -> bpy.types.Object | None:
    """
    Import an STL file into the Blender scene.

    Args:
        filepath: Absolute path to the .stl file.

    Returns:
        The imported mesh object, or None if import failed.
    """
    path = Path(filepath)
    if not path.exists():
        print(f"  ❌ Input file not found: {filepath}")
        return None

    if path.stat().st_size == 0:
        print(f"  ❌ Input file is empty: {filepath}")
        return None

    try:
        # STL import via Blender's built-in STL importer
        bpy.ops.wm.stl_import(
            filepath=str(path.resolve()),
            # Use global Z-up for dental models (standard in orthodontics)
            up_axis="Z",
            forward_axis="Y",
        )
        # The imported object becomes the active/selected object
        imported = bpy.context.active_object
        if imported:
            print(f"  ✅ Imported STL: {path.name} ({len(imported.data.polygons):,} polygons)")
        return imported
    except Exception as e:
        print(f"  ❌ STL import failed: {e}")
        return None


# ── Processing / Modifiers ─────────────────────────────────────────────

def apply_decimation(obj: bpy.types.Object, ratio: float):
    """
    Apply a decimate modifier to reduce polygon count.

    Useful for reducing large dental scans before further processing.

    Args:
        obj: The mesh object to decimate.
        ratio: Decimation ratio (0.0-1.0). 0.5 = 50% fewer polygons.
    """
    if not ratio or ratio >= 1.0:
        return

    # Ensure we're in object mode
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="OBJECT")

    # Add and apply decimate modifier
    modifier = obj.modifiers.new(name="Decimate", type="DECIMATE")
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True

    # Apply the modifier to make it permanent
    bpy.ops.object.modifier_apply(modifier=modifier.name)

    print(f"  🔧 Decimated to {ratio:.0%} — {len(obj.data.polygons):,} polygons remaining")


def prepare_for_processing(obj: bpy.types.Object):
    """
    [Placeholder] Apply mock processing to simulate base preparation.

    In a real production pipeline, you would replace this with:
      - Adding a base/extrusion to the dental model
      - Smoothing or repairing mesh errors
      - Trimming or cutting the model
      - Adding alignment markers or articulator mounts
      - Applying boolean operations

    Currently this demonstrates the pattern by applying Shade Smooth
    and optionally adding a simple solidify modifier.

    Args:
        obj: The mesh object to prepare.
    """
    # Ensure object mode
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="OBJECT")

    # Shade smooth for better visual quality
    bpy.ops.object.shade_smooth()

    # Optional: Add a solidify modifier for thickness simulation
    # (uncomment if you want a mock modifier applied)
    # modifier = obj.modifiers.new(name="Solidify", type="SOLIDIFY")
    # modifier.thickness = 0.5  # mm
    # modifier.offset = -1.0    # inward

    print(f"  🔧 Processing prep complete")

    # Re-calculate normals for clean export
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")


# ── STL Export ─────────────────────────────────────────────────────────

def export_stl(filepath: str):
    """
    Export the processed mesh to an STL file.

    Args:
        filepath: Path where the STL should be saved.
    """
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)

    # Select all visible mesh objects for export
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.visible_get():
            obj.select_set(True)

    if not bpy.context.selected_objects:
        print("  ❌ No mesh objects to export")
        return False

    try:
        # Export as binary STL (Blender 5.2 simplified the STL export operator)
        # Note: Blender 5.2 exports all visible mesh objects with modifiers applied by default.
        bpy.ops.wm.stl_export(
            filepath=str(path.resolve()),
            check_existing=False,
        )
        size_kb = path.stat().st_size / 1024
        print(f"  ✅ Exported STL: {path.name} ({size_kb:.1f} KB)")
        return True
    except Exception as e:
        print(f"  ❌ STL export failed: {e}")
        return False


# ── Main Pipeline ──────────────────────────────────────────────────────

def main():
    """Main entry point — orchestrates the full STL processing pipeline."""
    print("=" * 60)
    print("🦷 Blender Dental STL Processor")
    print("=" * 60)

    # 1. Parse arguments
    args = parse_script_args()
    print(f"\n📥 Input:  {args['input']}")
    print(f"📤 Output: {args['output']}")
    if args["decimate"]:
        print(f"🔧 Decimate: {args['decimate']:.0%}")

    # 2. Clear default scene
    print("\n🗑️  Clearing default scene...")
    clear_scene()

    # 3. Import STL
    print(f"\n📂 Importing STL...")
    mesh_obj = import_stl(args["input"])
    if not mesh_obj:
        print("\n❌ Pipeline aborted — import failed.")
        sys.exit(1)

    # 4. Apply processing
    print(f"\n🔧 Processing mesh...")
    if args["decimate"]:
        apply_decimation(mesh_obj, args["decimate"])
    prepare_for_processing(mesh_obj)

    # 5. Export processed STL
    print(f"\n💾 Exporting processed STL...")
    success = export_stl(args["output"])

    # 6. Done
    print("\n" + "=" * 60)
    if success:
        print("✅ Pipeline completed successfully.")
        sys.exit(0)
    else:
        print("❌ Pipeline completed with errors.")
        sys.exit(1)


if __name__ == "__main__":
    main()
