"""
Blender-based aligner CAD engine.

This script runs **inside** Blender's embedded Python interpreter
when called via::

    blender --background --python blender/aligner_cad.py -- <config_json_path>

It reads a JSON config file describing the stage to generate, imports
the segmented STLs, moves teeth, blocks undercuts, adds attachments,
generates the aligner shell, and exports STLs.

Coordinate convention (mm): +X right, +Y posterior, +Z superior (occlusal).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Blender imports (only available inside Blender's Python)
# ---------------------------------------------------------------------------
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler


# ===================================================================
#  Config
# ===================================================================

class Config:
    """Thin wrapper around the JSON config dict passed to Blender."""

    def __init__(self, data: dict):
        self.stl_dir: str = data["stl_dir"]
        self.output_dir: str = data["output_dir"]
        self.tooth_numbers: list[int] = data["tooth_numbers"]
        self.gingiva_stl: str = data.get("gingiva_stl", "")
        self.stage_index: int = data["stage_index"]
        self.num_stages: int = data["num_stages"]

        # Per-tooth position dict: {tooth_number: {tx,ty,tz,rx,ry,rz}}
        self.positions: dict[int, dict] = {
            int(k): v for k, v in data.get("positions", {}).items()
        }

        # Aligner params
        self.shell_thickness: float = data.get("shell_thickness", 0.75)
        self.offset_mm: float = data.get("offset_mm", 0.1)
        self.undercut_angle: float = data.get("undercut_angle", 45.0)
        self.gingiva_margin: float = data.get("gingiva_margin", 1.0)

        # Attachments
        self.attachments_enabled: bool = data.get("attachments_enabled", True)
        self.attachments: dict[int, dict] = {
            int(k): v for k, v in data.get("attachments", {}).items()
        }

        # Whether to export intermediate results
        self.export_individual: bool = data.get("export_individual", True)
        self.export_aligner: bool = data.get("export_aligner", True)


# ===================================================================
#  Helpers
# ===================================================================

def _clear_scene():
    """Delete all objects in the current scene."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def _ensure_output_dir(path: str):
    Path(path).mkdir(parents=True, exist_ok=True)


def _import_stl(filepath: str, name: str) -> bpy.types.Object:
    """Import an STL file and return the created object."""
    if not os.path.isfile(filepath):
        raise FileNotFoundError(f"STL not found: {filepath}")
    bpy.ops.wm.stl_import(filepath=filepath)
    obj = bpy.context.selected_objects[0]
    obj.name = name
    obj.data.name = f"{name}_mesh"
    return obj


def _export_stl(obj: bpy.types.Object, filepath: str):
    """Export a single object to binary STL.

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


def _object_from_stl(filepath: str, name: str) -> bpy.types.Object:
    """Import STL and return the resulting mesh object (cleaned up)."""
    obj = _import_stl(filepath, name)
    # Apply smooth shading
    mesh = obj.data
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


# ===================================================================
#  Tooth movement
# ===================================================================

def _move_tooth(
    obj: bpy.types.Object,
    tx: float, ty: float, tz: float,
    rx: float, ry: float, rz: float,
):
    """Apply translation (mm) and rotation (degrees) to a tooth object.

    Translation is in world space. Rotation is applied about the object's
    origin (assumed to be its centre-of-mass) in XYZ Euler order.
    """
    # Translation
    obj.location.x += tx
    obj.location.y += ty
    obj.location.z += tz

    # Rotation (convert degrees -> radians)
    euler = Euler(
        (math.radians(rx), math.radians(ry), math.radians(rz)),
        "XYZ",
    )
    obj.rotation_euler.rotate(euler)


# ===================================================================
#  Undercut blocking
# ===================================================================

def _block_undercuts(
    obj: bpy.types.Object,
    angle_deg: float = 45.0,
) -> None:
    """Block out undercuts by removing faces steeper than *angle* from +Z.

    Faces whose normal deviates from the occlusal (+Z) axis beyond the
    threshold are removed. Remaining holes are filled via convex hull.

    Note: simplified approach assuming occlusal = +Z. A production system
    should use the actual insertion-axis vector.
    """
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

    # Fill boundary loops via grid fill
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(obj.data)
    bm.edges.ensure_lookup_table()
    boundary_edges = [e for e in bm.edges if not e.is_manifold]
    if boundary_edges:
        # Select boundary edges and do a simple fill
        for e in boundary_edges:
            e.select = True
        bm.select_flush(True)
        bmesh.update_edit_mesh(obj.data)
        try:
            bpy.ops.mesh.fill_grid(use_interp_simple=True)
        except RuntimeError:
            # Fallback: simple edge fill
            try:
                bpy.ops.mesh.fill()
            except RuntimeError:
                pass  # best effort
    bpy.ops.object.mode_set(mode="OBJECT")


# ===================================================================
#  Attachments
# ===================================================================

def _add_attachments(
    obj: bpy.types.Object,
    attachments: list[dict],
) -> None:
    """Add attachment geometry to a tooth object.

    Each attachment dict::

        {"type": "ellipsoid", "pos": [x,y,z], "size": [w,h,d]}
    """
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
            sphere.name = f"attachment_{obj.name}"
        elif att_type == "beveled":
            # A beveled box shape for attachments
            bpy.ops.mesh.primitive_cube_add(
                location=(pos[0], pos[1], pos[2]),
                scale=(size[0] / 2, size[1] / 2, size[2] / 2),
            )
            bevel = bpy.context.object
            bevel.name = f"attachment_{obj.name}"
            # Add bevel modifier
            mod = bevel.modifiers.new(name="Bevel", type="BEVEL")
            mod.width = 0.3
            mod.segments = 4

        # Join attachment to tooth
        att_obj = bpy.context.object
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        att_obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.join()


# ===================================================================
#  Aligner shell generation
# ===================================================================

def _generate_aligner_shell(
    objects: list[bpy.types.Object],
    thickness_mm: float = 0.75,
    offset_mm: float = 0.1,
) -> bpy.types.Object:
    """Create the aligner shell mesh over a set of tooth+gingiva objects.

    Uses a Solidify modifier (no Remesh — too slow on complex dental
    meshes). The offset gap is built into the Solidify offset parameter.

    Returns the shell object.
    """
    # Duplicate and join everything into a single mesh
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
    combined.name = "aligner_combined"

    # Use solidify with offset= -1 (outward-only) so the inner surface
    # matches the tooth geometry and the shell extends outward.
    mod = combined.modifiers.new(name="AlignerSolidify", type="SOLIDIFY")
    mod.thickness = thickness_mm + offset_mm
    mod.offset = -1.0  # outward only
    mod.use_even_offset = True
    mod.use_quality_normals = True

    # Apply the modifier
    bpy.context.view_layer.objects.active = combined
    bpy.ops.object.modifier_apply(modifier=mod.name)

    return combined


# ===================================================================
#  Main entry point
# ===================================================================

def run(config: Config):
    """Main pipeline executed inside Blender."""
    _clear_scene()
    _ensure_output_dir(config.output_dir)

    stage_dir = os.path.join(config.output_dir, f"stage_{config.stage_index:03d}")
    _ensure_output_dir(stage_dir)
    individual_dir = os.path.join(stage_dir, "teeth")
    _ensure_output_dir(individual_dir)

    print(f"[aligner_cad] === Stage {config.stage_index}/{config.num_stages} ===")

    # ---- 1. Import gingiva ----
    imported_objects: dict[int, bpy.types.Object] = {}
    if config.gingiva_stl and os.path.isfile(config.gingiva_stl):
        gingiva = _object_from_stl(config.gingiva_stl, "gingiva")
        imported_objects[0] = gingiva
        print(f"[aligner_cad] Imported gingiva: {config.gingiva_stl}")
    # Remove gingiva from tooth_numbers list for movement
    tooth_numbers = [t for t in config.tooth_numbers if t != 0]

    # ---- 2. Import teeth ----
    stl_dir = config.stl_dir
    for tn in tooth_numbers:
        stl_path = os.path.join(stl_dir, f"tooth_{tn}.stl")
        if not os.path.isfile(stl_path):
            print(f"[aligner_cad] WARNING: tooth {tn} STL not found at {stl_path}, skipping")
            continue
        obj = _object_from_stl(stl_path, f"tooth_{tn}")
        imported_objects[tn] = obj

    # ---- 3. Move teeth to stage positions ----
    for tn, pos in config.positions.items():
        if tn == 0:
            continue  # skip gingiva
        obj = imported_objects.get(tn)
        if obj is None:
            print(f"[aligner_cad] WARNING: tooth {tn} not imported, can't move")
            continue
        _move_tooth(
            obj,
            tx=pos.get("tx", 0),
            ty=pos.get("ty", 0),
            tz=pos.get("tz", 0),
            rx=pos.get("rx", 0),
            ry=pos.get("ry", 0),
            rz=pos.get("rz", 0),
        )
        print(f"[aligner_cad] Moved tooth {tn}: T({pos.get('tx',0):.2f}, {pos.get('ty',0):.2f}, {pos.get('tz',0):.2f}) "
              f"R({pos.get('rx',0):.1f}, {pos.get('ry',0):.1f}, {pos.get('rz',0):.1f})")

    # ---- 4. Block undercuts on teeth ----
    for tn, obj in imported_objects.items():
        if tn == 0:
            continue  # skip gingiva
        print(f"[aligner_cad] Blocking undercuts on tooth {tn} (angle={config.undercut_angle} deg)")
        _block_undercuts(obj, config.undercut_angle)

    # ---- 5. Add attachments ----
    if config.attachments_enabled:
        for tn, att_data in config.attachments.items():
            obj = imported_objects.get(tn)
            if obj is None:
                continue
            # Convert single attachment to list
            if isinstance(att_data, dict):
                att_data = [att_data]
            _add_attachments(obj, att_data)
            print(f"[aligner_cad] Added {len(att_data)} attachment(s) to tooth {tn}")

    # ---- 6. Export individual staged teeth ----
    if config.export_individual:
        for tn, obj in imported_objects.items():
            if tn == 0:
                out_path = os.path.join(individual_dir, "gingiva.stl")
            else:
                out_path = os.path.join(individual_dir, f"tooth_{tn}.stl")
            _export_stl(obj, out_path)
            print(f"[aligner_cad] Exported: {out_path}")

    # ---- 7. Generate aligner shell ----
    if config.export_aligner and len(imported_objects) >= 2:
        all_obs = list(imported_objects.values())
        shell = _generate_aligner_shell(
            all_obs,
            thickness_mm=config.shell_thickness,
            offset_mm=config.offset_mm,
        )
        shell_path = os.path.join(stage_dir, "aligner.stl")
        _export_stl(shell, shell_path)
        print(f"[aligner_cad] Exported aligner shell: {shell_path}")
    elif config.export_aligner:
        print("[aligner_cad] Not enough objects to generate aligner shell (need >= 2).")

    print(f"[aligner_cad] === Stage {config.stage_index} complete ===")


# ===================================================================
#  CLI entry (when run inside Blender)
# ===================================================================

def main():
    """Parse ``--`` separated args from Blender's command line."""
    argv = sys.argv
    if "--" not in argv:
        print("[aligner_cad] No config argument provided. Skipping.")
        return

    config_path = argv[argv.index("--") + 1]
    with open(config_path, "r") as f:
        data = json.load(f)

    cfg = Config(data)
    run(cfg)


if __name__ == "__main__":
    main()
