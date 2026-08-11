"""
Batch aligner CAD — processes ALL stages in a single Blender session.

Instead of restarting Blender N times (one per stage), this script:
1. Imports all STLs once
2. For each stage: moves teeth, exports individual STLs, generates aligner shell
3. Resets tooth positions between stages (or interpolates from baseline)

This saves ~3s of Blender startup overhead per stage.

Usage::

    blender --background --python blender/batch_aligner_cad.py -- <batch_config.json>

Batch config JSON
-----------------
{
  "stl_dir": "path/to/stls",
  "gingiva_stl": "path/to/gingiva.stl",
  "output_dir": "path/to/output",
  "tooth_numbers": [11, 12, ...],
  "stages": [
    {"stage_index": 0, "positions": {"11": {"tx":0,...}, ...}},
    {"stage_index": 1, "positions": {"11": {"tx":0.1,...}, ...}},
    ...
  ],
  "shell_thickness": 0.75,
  "offset_mm": 0.1,
  "undercut_angle": 45.0,
  "attachments_enabled": true,
  "attachments": {"11": {"type": "ellipsoid", ...}}
}
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector, Euler


# ===================================================================
#  Helpers
# ===================================================================

def _clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def _ensure_dir(path: str):
    Path(path).mkdir(parents=True, exist_ok=True)


def _import_stl(filepath: str, name: str) -> bpy.types.Object:
    bpy.ops.wm.stl_import(filepath=filepath)
    obj = bpy.context.selected_objects[0]
    obj.name = name
    obj.data.name = f"{name}_mesh"
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def _export_stl(obj: bpy.types.Object, filepath: str):
    """Write a single object to binary STL.

    NOTE: In Blender 5.2 ``wm.stl_export`` ignores selection/visibility and
    exports the WHOLE scene, so we write the STL manually.
    """
    _write_binary_stl(obj, filepath)


def _write_binary_stl(obj: bpy.types.Object, filepath: str):
    """Write one object (world transform applied) as a binary STL."""
    import struct

    depsgraph = bpy.context.evaluated_depsgraph_get()
    obj_eval = obj.evaluated_get(depsgraph)
    mesh = obj_eval.to_mesh()
    try:
        mesh.calc_loop_triangles()
        mat = obj.matrix_world

        triangles = []
        for tri in mesh.loop_triangles:
            v0 = mat @ mesh.vertices[tri.vertices[0]].co
            v1 = mat @ mesh.vertices[tri.vertices[1]].co
            v2 = mat @ mesh.vertices[tri.vertices[2]].co
            normal = (v1 - v0).cross(v2 - v0)
            try:
                normal.normalize()
            except ZeroDivisionError:
                normal = Vector((0, 0, 1))
            triangles.append((normal, v0, v1, v2))

        with open(filepath, "wb") as f:
            f.write(b"\x00" * 80)  # 80-byte header
            f.write(struct.pack("<I", len(triangles)))
            for normal, v0, v1, v2 in triangles:
                f.write(struct.pack("<3f", normal.x, normal.y, normal.z))
                f.write(struct.pack("<3f", v0.x, v0.y, v0.z))
                f.write(struct.pack("<3f", v1.x, v1.y, v1.z))
                f.write(struct.pack("<3f", v2.x, v2.y, v2.z))
                f.write(struct.pack("<H", 0))  # attribute byte count
    finally:
        obj_eval.to_mesh_clear()


def _store_initial_transform(obj: bpy.types.Object) -> tuple:
    """Store location and rotation as a tuple we can restore later."""
    return (obj.location.copy(), obj.rotation_euler.copy())


def _restore_transform(obj: bpy.types.Object, transform: tuple):
    obj.location = transform[0]
    obj.rotation_euler = transform[1]


def _apply_movement(obj: bpy.types.Object, pos: dict):
    obj.location.x += pos.get("tx", 0)
    obj.location.y += pos.get("ty", 0)
    obj.location.z += pos.get("tz", 0)
    euler = Euler(
        (math.radians(pos.get("rx", 0)),
         math.radians(pos.get("ry", 0)),
         math.radians(pos.get("rz", 0))),
        "XYZ",
    )
    obj.rotation_euler.rotate(euler)


def _block_undercuts(obj: bpy.types.Object, angle_deg: float = 45.0):
    """Remove faces steeper than angle_deg from +Z."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(obj.data)
    bm.faces.ensure_lookup_table()

    z_up = Vector((0, 0, 1))
    threshold = math.radians(angle_deg)
    faces_to_del = [f for f in bm.faces if f.normal.normalized().angle(z_up) > threshold]

    if not faces_to_del:
        bmesh.update_edit_mesh(obj.data)
        bpy.ops.object.mode_set(mode="OBJECT")
        return

    bmesh.ops.delete(bm, geom=faces_to_del, context="FACES")
    bmesh.update_edit_mesh(obj.data)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Fill holes
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(obj.data)
    bm.edges.ensure_lookup_table()
    boundary = [e for e in bm.edges if not e.is_manifold]
    if boundary:
        for e in boundary:
            e.select = True
        bm.select_flush(True)
        bmesh.update_edit_mesh(obj.data)
        try:
            bpy.ops.mesh.fill_grid(use_interp_simple=True)
        except RuntimeError:
            try:
                bpy.ops.mesh.fill()
            except RuntimeError:
                pass
    bpy.ops.object.mode_set(mode="OBJECT")


def _add_attachments(obj: bpy.types.Object, attachments: list[dict]):
    for att in attachments:
        att_type = att.get("type", "ellipsoid")
        pos = att.get("pos", [0, 0, 0])
        size = att.get("size", [2.0, 2.0, 1.5])

        if att_type == "ellipsoid":
            bpy.ops.mesh.primitive_uv_sphere_add(
                location=(pos[0], pos[1], pos[2]),
                radius=1.0,
            )
            sphere = bpy.context.object
            sphere.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
            sphere.name = f"attach_{obj.name}"
        elif att_type == "beveled":
            bpy.ops.mesh.primitive_cube_add(
                location=(pos[0], pos[1], pos[2]),
                scale=(size[0] / 2, size[1] / 2, size[2] / 2),
            )
            bevel = bpy.context.object
            bevel.name = f"attach_{obj.name}"
            mod = bevel.modifiers.new(name="Bevel", type="BEVEL")
            mod.width = 0.3
            mod.segments = 4

        att_obj = bpy.context.object
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        att_obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.join()


def _make_aligner_shell(objects: list[bpy.types.Object], thickness_mm: float, offset_mm: float) -> bpy.types.Object:
    """Create an aligner shell from the given objects and return it."""
    bpy.ops.object.select_all(action="DESELECT")
    copies = []
    for ob in objects:
        copy = ob.copy()
        copy.data = ob.data.copy()
        bpy.context.collection.objects.link(copy)
        copies.append(copy)

    for c in copies:
        c.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()

    combined = bpy.context.object
    combined.name = "aligner_shell"

    mod = combined.modifiers.new(name="Solidify", type="SOLIDIFY")
    mod.thickness = thickness_mm + offset_mm
    mod.offset = -1.0
    mod.use_even_offset = True
    mod.use_quality_normals = True

    bpy.context.view_layer.objects.active = combined
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return combined


# ===================================================================
#  Main
# ===================================================================

def run_batch(config: dict):
    """Process all stages in a single Blender session."""
    t_start = time.time()

    stl_dir = config["stl_dir"]
    gingiva_stl = config.get("gingiva_stl", "")
    output_dir = config["output_dir"]
    tooth_numbers = [t for t in config["tooth_numbers"] if t != 0]
    stages_cfg = config["stages"]
    shell_thickness = config.get("shell_thickness", 0.75)
    offset_mm = config.get("offset_mm", 0.1)
    undercut_angle = config.get("undercut_angle", 45.0)
    attachments_enabled = config.get("attachments_enabled", True)
    attachments_cfg = config.get("attachments", {})

    print(f"[batch] Processing {len(stages_cfg)} stages in one session...")

    # ---- 1. Clear & import all assets ----
    _clear_scene()
    imported: dict[int, bpy.types.Object] = {}

    if gingiva_stl and os.path.isfile(gingiva_stl):
        imported[0] = _import_stl(gingiva_stl, "gingiva")
        print(f"[batch] Imported gingiva")

    for tn in tooth_numbers:
        stl_path = os.path.join(stl_dir, f"tooth_{tn}.stl")
        if os.path.isfile(stl_path):
            imported[tn] = _import_stl(stl_path, f"tooth_{tn}")
    print(f"[batch] Imported {len(imported)} objects")

    # ---- 2. Block undercuts (once, on initial geometry) ----
    for tn, obj in imported.items():
        if tn == 0:
            continue
        print(f"[batch] Blocking undercuts tooth {tn}")
        _block_undercuts(obj, undercut_angle)

    # ---- 2b. Add attachments (once — same geometry every stage) ----
    if attachments_enabled and attachments_cfg:
        for tn_str, att_data in attachments_cfg.items():
            tn = int(tn_str)
            obj = imported.get(tn)
            if obj is None:
                continue
            if isinstance(att_data, dict):
                att_data = [att_data]
            _add_attachments(obj, att_data)
            print(f"[batch] Added {len(att_data)} attachment(s) to tooth {tn}")

    # Store post-undercut transforms as new baseline
    baseline_transforms = {k: _store_initial_transform(v) for k, v in imported.items()}

    # ---- 3. Process each stage ----
    for si, stage in enumerate(stages_cfg):
        t_stage = time.time()
        idx = stage["stage_index"]
        positions = stage.get("positions", {})

        # Restore to baseline (post-undercut)
        for tn, obj in imported.items():
            _restore_transform(obj, baseline_transforms[tn])

        # Apply movements for this stage
        for tn_str, pos in positions.items():
            tn = int(tn_str)
            obj = imported.get(tn)
            if obj:
                _apply_movement(obj, pos)

        # Create output dirs
        stage_dir = os.path.join(output_dir, f"stage_{idx:03d}")
        teeth_dir = os.path.join(stage_dir, "teeth")
        _ensure_dir(teeth_dir)

        # Export individual teeth
        for tn, obj in imported.items():
            if tn == 0:
                fname = "gingiva.stl"
            else:
                fname = f"tooth_{tn}.stl"
            _export_stl(obj, os.path.join(teeth_dir, fname))

        # Generate & export aligner shell
        if len(imported) >= 2:
            shell = _make_aligner_shell(
                list(imported.values()),
                shell_thickness,
                offset_mm,
            )
            _export_stl(shell, os.path.join(stage_dir, "aligner.stl"))
            # Delete shell to free memory
            bpy.data.objects.remove(shell, do_unlink=True)

        elapsed = time.time() - t_stage
        print(f"[batch] Stage {idx}/{len(stages_cfg)-1} done in {elapsed:.2f}s")

    total = time.time() - t_start
    print(f"[batch] All {len(stages_cfg)} stages completed in {total:.1f}s")


# ===================================================================
#  CLI entry
# ===================================================================

def main():
    argv = sys.argv
    if "--" not in argv:
        print("[batch] No config argument. Usage: blender --background --python batch_aligner_cad.py -- <config.json>")
        return

    config_path = argv[argv.index("--") + 1]
    with open(config_path, "r") as f:
        config = json.load(f)

    run_batch(config)


if __name__ == "__main__":
    main()
