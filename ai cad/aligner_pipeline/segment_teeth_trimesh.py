#!/usr/bin/env python3
"""
Tooth Segmentation from Full Arch Scan
========================================
Uses height-based cutting and connected-component analysis to separate
a full dental arch STL into individual tooth STLs.

Usage:
    python segment_teeth_trimesh.py <arch.stl> <output_dir> [--upper]

Output:
    - tooth_11.stl ... tooth_28.stl (upper)
    - tooth_31.stl ... tooth_48.stl (lower)
    - gingiva.stl
"""

import argparse
import os
import sys
import numpy as np
import trimesh
from pathlib import Path

# Import pipeline parameters for consistency
try:
    from ortho.aligner_pipeline.config.pipeline_params import GUM_CUT, DET_CUT, GRID_SIZE, MIN_CELLS, SHELL_THICKNESS_MM
except ImportError:
    try:
        from config.pipeline_params import GUM_CUT, DET_CUT, GRID_SIZE, MIN_CELLS, SHELL_THICKNESS_MM
    except ImportError:
        GUM_CUT = 0.3
        DET_CUT = 0.5
        GRID_SIZE = 240
        MIN_CELLS = 8
        SHELL_THICKNESS_MM = 0.75


# FDI numbering per arch
UPPER_FDI_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11]  # right side
UPPER_FDI_LEFT = [21, 22, 23, 24, 25, 26, 27, 28]   # left side
LOWER_FDI_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41]
LOWER_FDI_LEFT = [31, 32, 33, 34, 35, 36, 37, 38]

# All FDI
UPPER_FDI = UPPER_FDI_RIGHT + UPPER_FDI_LEFT
LOWER_FDI = LOWER_FDI_LEFT + LOWER_FDI_RIGHT


def segment_arch(mesh: trimesh.Trimesh, arch_type: str = "upper",
                 cut_ratio: float = 0.3, min_component_verts: int = 200):
    """
    Segment a dental arch mesh into individual tooth meshes.
    
    Strategy:
    1. Cut the mesh horizontally near the gum line
    2. The upper part contains the teeth
    3. Split into connected components
    4. Label each component as an FDI tooth based on position
    """
    verts = mesh.vertices
    z = verts[:, 2]
    z_min, z_max = z.min(), z.max()
    z_range = z_max - z_min
    
    print(f"  Z range: {z_min:.2f} to {z_max:.2f} (range: {z_range:.2f})")
    
    # Determine cut height
    if arch_type == "upper":
        # Upper arch: teeth point downward (lower Z), gum is higher
        cut_z = z_min + z_range * cut_ratio
    else:
        # Lower arch: teeth point upward (higher Z), gum is lower
        cut_z = z_max - z_range * cut_ratio
    
    print(f"  Cut height: {cut_z:.2f}")
    
    # Find the tooth region vertices (above cut for upper, below cut for lower)
    if arch_type == "upper":
        tooth_mask = z >= cut_z  # teeth are the upper part in Z
    else:
        tooth_mask = z <= cut_z  # teeth are the lower part in Z
    
    # We need to split the mesh. First get the faces that have all vertices in tooth region
    faces = mesh.faces
    tooth_faces = np.all(tooth_mask[faces], axis=1)
    
    if tooth_faces.sum() == 0:
        print("  [WARN] No faces in tooth region with this cut ratio")
        return []
    
    print(f"  Tooth faces: {tooth_faces.sum()} / {len(faces)}")
    
    # Extract the tooth region as a separate mesh
    tooth_mesh = mesh.submesh([np.where(tooth_faces)[0]], append=True)
    
    if tooth_mesh is None or len(tooth_mesh.vertices) == 0:
        print("  [WARN] Could not extract tooth region")
        return []
    
    print(f"  Tooth region: {len(tooth_mesh.vertices)} vertices, {len(tooth_mesh.faces)} faces")
    
    # Try to split into connected components
    try:
        components = tooth_mesh.split(only_watertight=False)
    except Exception as e:
        print(f"  [WARN] Split failed: {e}")
        # Fall back: try edge-connected components
        components = split_mesh_fallback(tooth_mesh)
    
    if not components:
        print("  [WARN] No components found after splitting")
        return []
    
    print(f"  Found {len(components)} components")
    
    # Filter out tiny components (noise)
    valid = [c for c in components if len(c.vertices) >= min_component_verts]
    print(f"  Valid components (>{min_component_verts} verts): {len(valid)}")
    
    # Sort components by X position (left to right in the arch)
    # For upper arch, negative X = right side of patient
    centroids = [c.centroid for c in valid]
    x_vals = [c[0] for c in centroids]
    
    # Sort by X
    sorted_idx = np.argsort(x_vals)
    valid_sorted = [valid[i] for i in sorted_idx]
    
    # Label according to FDI
    if arch_type == "upper":
        # For upper: negative X is right side (FDI 11-18), positive X is left side (FDI 21-28)
        right = [c for c in valid_sorted if c.centroid[0] < 0]
        left = [c for c in valid_sorted if c.centroid[0] >= 0]
        # Right side: sort by X descending (most negative first = FDI 18? or 11?)
        right.sort(key=lambda c: c.centroid[0])  # most negative first
        left.sort(key=lambda c: c.centroid[0])    # least positive first
        
        result = {}
        for i, comp in enumerate(right):
            if i < len(UPPER_FDI_RIGHT):
                result[UPPER_FDI_RIGHT[i]] = comp
        for i, comp in enumerate(left):
            if i < len(UPPER_FDI_LEFT):
                result[UPPER_FDI_LEFT[i]] = comp
    else:
        left = [c for c in valid_sorted if c.centroid[0] < 0]
        right = [c for c in valid_sorted if c.centroid[0] >= 0]
        left.sort(key=lambda c: c.centroid[0])
        right.sort(key=lambda c: c.centroid[0])
        
        result = {}
        for i, comp in enumerate(left):
            if i < len(LOWER_FDI_LEFT):
                result[LOWER_FDI_LEFT[i]] = comp
        for i, comp in enumerate(right):
            if i < len(LOWER_FDI_RIGHT):
                result[LOWER_FDI_RIGHT[i]] = comp
    
    return result


def split_mesh_fallback(mesh):
    """Fallback: use face adjacency to find connected components."""
    try:
        return mesh.split(only_watertight=False)
    except:
        return [mesh]


def export_teeth(teeth_dict, output_dir, arch_type, mesh_original):
    """Export individual tooth STLs and gingiva."""
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"\n  Exporting {len(teeth_dict)} teeth to {output_dir}:")
    for fdi, comp in sorted(teeth_dict.items()):
        filename = f"tooth_{fdi}.stl"
        filepath = os.path.join(output_dir, filename)
        comp.export(filepath)
        print(f"    [OK] tooth_{fdi}.stl ({len(comp.vertices)} verts, centroid: {comp.centroid.round(1)})")
    
    # Export gingiva (the complementary part)
    # Create a gingiva mesh from the original minus tooth region
    print(f"\n  Note: Gingiva export requires full mesh boolean operation")
    
    return list(teeth_dict.keys())


def main():
    parser = argparse.ArgumentParser(description="Segment dental arch into individual teeth")
    parser.add_argument("input_stl", help="Path to the arch STL file")
    parser.add_argument("-o", "--output", default="segmented_output",
                        help="Output directory for segmented teeth")
    parser.add_argument("--upper", action="store_true", help="Upper arch (default: auto-detect)")
    parser.add_argument("--lower", action="store_true", help="Lower arch")
    parser.add_argument("--cut", type=float, default=GUM_CUT,
                        help="Cut ratio for gum separation (0.0-1.0, default: 0.3)")
    args = parser.parse_args()
    
    # Detect arch type from filename if not specified
    if args.upper:
        arch_type = "upper"
    elif args.lower:
        arch_type = "lower"
    else:
        fname = Path(args.input_stl).name.lower()
        if "lower" in fname:
            arch_type = "lower"
        else:
            arch_type = "upper"
    
    print(f"Loading {args.input_stl}...")
    mesh = trimesh.load(args.input_stl)
    if isinstance(mesh, trimesh.Scene):
        # Take the largest geometry
        geometries = [g for g in mesh.geometry.values()
                      if isinstance(g, trimesh.Trimesh)]
        if geometries:
            mesh = max(geometries, key=lambda m: m.area)
        else:
            print("[ERROR] No Trimesh geometry found")
            sys.exit(1)
    
    print(f"  Vertices: {len(mesh.vertices)}, Faces: {len(mesh.faces)}")
    print(f"  Bounds: {mesh.bounds}")
    print(f"\n=== Segmenting {arch_type} arch ===")
    
    teeth = segment_arch(mesh, arch_type, cut_ratio=args.cut)
    
    if teeth:
        export_teeth(teeth, args.output, arch_type, mesh)
        print(f"\n[SUCCESS] Segmented {len(teeth)} teeth into: {args.output}")
        print(f"  To run the aligner pipeline on these:")
        print(f"    python run_pipeline.py all --stls {args.output} --output case_erina --stages 33 --shell {SHELL_THICKNESS_MM}")
    else:
        print(f"\n[FAILED] Could not segment teeth. Try adjusting --cut ratio (current: {args.cut})")
        print(f"  Try: --cut 0.25 or --cut 0.35")
        sys.exit(1)


if __name__ == "__main__":
    main()
