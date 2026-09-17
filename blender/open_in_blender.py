#!/usr/bin/env python3
"""
Blender GUI Launcher — Opens an STL file in the Blender interactive editor.
==========================================================================
This script is run by Blender when the user clicks "Open in Blender" from
the web UI. It imports the given STL file into Blender's GUI for manual
editing.

Usage (called by server.ts, not directly):
  blender --python open_in_blender.py -- "path/to/file.stl"
"""

import sys
import os
from pathlib import Path

try:
    import bpy
except ImportError:
    print("ERROR: bpy module not found. This script must be run inside Blender.")
    sys.exit(1)


def main():
    # Parse --input= argument from sys.argv
    filepath = None
    for a in sys.argv:
        if a.startswith('--input='):
            filepath = a.split('=', 1)[1].strip('"').strip("'")
            break

    if not filepath or not os.path.exists(filepath):
        print("No valid STL file provided via --input=. Opening Blender normally.")
        return

    filepath = str(Path(filepath).resolve())
    print(f"Opening STL in Blender GUI: {filepath}")

    # Clear the default scene
    if bpy.context.active_object:
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    # Import the STL file
    try:
        bpy.ops.wm.stl_import(
            filepath=filepath,
            up_axis="Z",
            forward_axis="Y",
        )
        imported = bpy.context.active_object
        if imported:
            # Center the view on the imported object
            bpy.ops.object.select_all(action="DESELECT")
            imported.select_set(True)
            bpy.context.view_layer.objects.active = imported
            # View all in the 3D viewport
            for area in bpy.context.screen.areas:
                if area.type == 'VIEW_3D':
                    ctx = bpy.context.copy()
                    ctx['area'] = area
                    ctx['region'] = area.regions[0]
                    bpy.ops.view3d.view_all(ctx, center=True)
                    break
            print(f"✅ Loaded: {Path(filepath).name}")
        else:
            print("❌ No object was imported.")
    except Exception as e:
        print(f"❌ Failed to import STL: {e}")


if __name__ == "__main__":
    main()
