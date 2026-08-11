#!/usr/bin/env python3
"""Visualize height map + detection for debugging."""
import sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from fast_pipeline import load_mesh, build_occlusal_grid, detect_teeth_from_occlusal

ARCH = sys.argv[1] if len(sys.argv) > 1 else "upper"
STL = sys.argv[2] if len(sys.argv) > 2 else r"L:\TEST\Patiens\Anila Ahsan Proti\New Case 17.09.24\Scan\orthodontics_124_upper.stl"

mesh = load_mesh(STL)
verts = mesh.vertices
print(f"Mesh: {len(verts)} verts, {len(mesh.faces)} faces")
print(f"Bounds: x [{verts[:,0].min():.1f}, {verts[:,0].max():.1f}]  "
      f"y [{verts[:,1].min():.1f}, {verts[:,1].max():.1f}]  "
      f"z [{verts[:,2].min():.1f}, {verts[:,2].max():.1f}]")
print(f"Spans: x {verts[:,0].max()-verts[:,0].min():.1f}  "
      f"y {verts[:,1].max()-verts[:,1].min():.1f}  "
      f"z {verts[:,2].max()-verts[:,2].min():.1f}")

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    H, H_max, H_min, cell_verts, bounds = build_occlusal_grid(verts, 220)
    teeth = detect_teeth_from_occlusal(H_max if ARCH == "upper" else H_min, H, ARCH, 0.3, 220)

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))
    for ax, (name, hmap) in zip(axes, [("mean-z", H), ("occlusal", H_max if ARCH == "upper" else H_min)]):
        ax.imshow(hmap, cmap="viridis", origin="lower")
        for t, cells in enumerate(teeth):
            for c in cells:
                y, x = divmod(c, 220)
                ax.plot(x, y, ".", markersize=0.3, color="red")
        ax.set_title(f"{name} — {len(teeth)} regions")
    plt.tight_layout()
    out = Path(__file__).parent / "diag.png"
    plt.savefig(out, dpi=110)
    print(f"\nSaved {out}")
except ImportError as e:
    print(f"(matplotlib not available: {e})")
