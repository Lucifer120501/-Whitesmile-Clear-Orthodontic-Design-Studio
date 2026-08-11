#!/usr/bin/env python3
"""
Fast Tooth Segmentation — Pure Python, No Blender
Robust dental arch segmentation using morphological separation:
  1. Column map (max-z per XY cell for upper, min-z for lower)
  2. Tooth region = cells above the gum line
  3. Binary erosion breaks thin interproximal contact bridges
  4. Connected blobs of the eroded mask = teeth
  5. Voronoi growth-back assigns every tooth cell to its nearest blob

Handles tight contacts and 3D-curved arches. Fast (~5s per arch).

Usage:
    python fast_pipeline.py scan_upper.stl ./out/ --upper
    python fast_pipeline.py ./patient_folder/ ./out/
"""

import argparse, json, re, shutil, sys, urllib.request
from datetime import datetime
from pathlib import Path
import numpy as np

try:
    import trimesh
except ImportError:
    print("[ERROR] pip install trimesh[all]"); sys.exit(1)

try:
    from scipy import ndimage
except ImportError:
    print("[ERROR] pip install scipy"); sys.exit(1)

UPPER_FDI = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
LOWER_FDI = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}")


def ai_suggest_cut_ratio(mesh, main_server_url=""):
    """Suggest cut ratio via the WhiteSmile main system AI bridge.

    The segmentation pipeline no longer holds its own API keys or talks to
    AI providers directly. It delegates to the main system's unified AI
    (``POST /api/ai/cut-ratio``) and falls back to the clinically-safe
    default (0.3) if the main server is unreachable.
    """
    if not main_server_url:
        return None
    try:
        z = mesh.vertices[:, 2]
        x = mesh.vertices[:, 0]
        y = mesh.vertices[:, 1]
        # Vertex density per z-decile (bottom -> top) — the AI uses the
        # inflection (crown/gum transition) to place the cut precisely.
        hist, _ = np.histogram(z, bins=10)
        info = {
            "z_min": round(float(z.min()), 2),
            "z_max": round(float(z.max()), 2),
            "z_range": round(float(z.max() - z.min()), 2),
            "bbox": {
                "x": round(float(x.max() - x.min()), 2),
                "y": round(float(y.max() - y.min()), 2),
                "z": round(float(z.max() - z.min()), 2),
            },
            "archWidthMm": round(float(x.max() - x.min()), 2),
            "archDepthMm": round(float(y.max() - y.min()), 2),
            "verticalProfile": [int(v) for v in hist],
            "archType": "unknown",
            "vertexCount": int(len(mesh.vertices)),
        }
        url = main_server_url.rstrip("/") + "/api/ai/cut-ratio"
        body = json.dumps(info).encode()
        headers = {"Content-Type": "application/json"}
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
        cr = max(0.1, min(0.6, float(data.get("cut_ratio", 0.3))))
        log(f"  [AI] WhiteSmile AI suggested cut_ratio={cr:.2f} ({data.get('source', 'ai')})")
        return cr
    except Exception:
        return None


# ── Grid helpers ──────────────────────────────────────────────────────────

def build_column_map(verts, grid_size=240):
    """Per-XY-cell column extents. Returns H_max, H_min, cell_verts, bounds."""
    xy = verts[:, :2]
    xmin, ymin = xy.min(axis=0)
    xmax, ymax = xy.max(axis=0)
    sx = max(xmax - xmin, 1e-6)
    sy = max(ymax - ymin, 1e-6)

    xi = np.clip(((xy[:, 0] - xmin) / sx * (grid_size - 1)).astype(int), 0, grid_size - 1)
    yi = np.clip(((xy[:, 1] - ymin) / sy * (grid_size - 1)).astype(int), 0, grid_size - 1)

    cell_verts = [[] for _ in range(grid_size * grid_size)]
    for i in range(len(verts)):
        cell_verts[yi[i] * grid_size + xi[i]].append(i)

    H_max = np.full((grid_size, grid_size), np.nan)
    H_min = np.full((grid_size, grid_size), np.nan)
    for idx, vi in enumerate(cell_verts):
        if vi:
            zs = verts[vi, 2]
            H_max[idx // grid_size, idx % grid_size] = float(np.max(zs))
            H_min[idx // grid_size, idx % grid_size] = float(np.min(zs))

    return H_max, H_min, cell_verts, (xmin, ymin, xmax, ymax)


def _centroid(cells, grid_size):
    arr = np.array(list(cells))
    if len(arr) == 0:
        return (0.0, 0.0)
    return (float((arr % grid_size).astype(float).mean()),
            float((arr // grid_size).astype(float).mean()))


# ── Morphological tooth detection ─────────────────────────────────────────

def detect_teeth_morph(H_col, arch_type, det_cut=0.5, gum_cut=0.3,
                       grid_size=240, min_cells=8):
    """
    Erosion-based tooth separation:
      - seed_region = cells above the DETECTION cut (high, excludes gum
        papillae that bridge teeth) -> seeds via raw components + erosion
      - region      = cells above the GUM cut (low, full tooth bodies)
      - Voronoi growth-back assigns every region cell to its nearest seed
    Returns list of cell-index sets (one per tooth).
    """
    z_valid = H_col[~np.isnan(H_col)]
    if len(z_valid) == 0:
        return []
    zmin, zmax = float(z_valid.min()), float(z_valid.max())
    zrange = zmax - zmin
    if zrange < 1e-6:
        return []

    if arch_type == "upper":
        z_det = zmin + zrange * det_cut
        z_gum = zmin + zrange * gum_cut
        seed_region = ~np.isnan(H_col) & (H_col >= z_det)
        region = ~np.isnan(H_col) & (H_col >= z_gum)
    else:
        z_det = zmax - zrange * det_cut
        z_gum = zmax - zrange * gum_cut
        seed_region = ~np.isnan(H_col) & (H_col <= z_det)
        region = ~np.isnan(H_col) & (H_col <= z_gum)

    if region.sum() < 30:
        return []

    # Seeds: raw components of seed_region first, then increasing erosion
    candidates = []
    lbl0, n0 = ndimage.label(seed_region)
    if 4 <= n0 <= 24:
        candidates.append((n0, 0, lbl0))

    for iters in range(1, 21):
        eroded = ndimage.binary_erosion(seed_region, iterations=iters)
        lbl, n = ndimage.label(eroded)
        if 4 <= n <= 24:
            candidates.append((n, iters, lbl))

    if not candidates:
        return []

    # Prefer blob count closest to 14 (typical adult arch); tie-break with
    # smaller erosion (less aggressive = fewer artifacts).
    best = min(candidates, key=lambda c: (abs(c[0] - 14), c[1]))
    n_blobs, iters, labels = best

    # Voronoi growth-back from seed blobs over the FULL gum-line region.
    # NOTE: scipy EDT measures distance to the nearest ZERO, so pass the
    # inverted marker image to get distance-to-marker and its indices.
    markers = (labels > 0).astype(np.uint8)
    _, idx = ndimage.distance_transform_edt(~markers.astype(bool), return_indices=True)
    iy = idx[0].astype(np.int64)
    ix = idx[1].astype(np.int64)
    vor = labels[iy, ix]  # nearest marker label per cell

    # Collect cells per label within the tooth region
    teeth = [set() for _ in range(n_blobs)]
    for y, x in np.argwhere(region):
        lb = int(vor[y, x])
        if lb > 0:
            teeth[lb - 1].add(int(y) * grid_size + int(x))

    # Merge tiny blobs into nearest big blob
    big = [t for t in teeth if len(t) >= min_cells]
    small = [t for t in teeth if len(t) < min_cells]
    for s in small:
        if not big:
            big.append(s)
            continue
        sc = np.array(_centroid(s, grid_size))
        d = [np.linalg.norm(sc - np.array(_centroid(b, grid_size))) for b in big]
        big[int(np.argmin(d))] |= s

    return [t for t in big if len(t) >= min_cells]


# ── Main segmentation ─────────────────────────────────────────────────────

def _split_oversized(mesh, tooth_list, H_col, arch_type, grid_size):
    """
    Teeth much larger than the median are likely 2+ teeth still merged.
    Re-run localized detection inside each oversized tooth with aggressive
    erosion; if 2+ solid parts come out, use them instead.
    """
    verts = mesh.vertices
    faces = mesh.faces
    xmin, ymin, xmax, ymax = mesh._seg_bounds
    sx = max(xmax - xmin, 1e-6)
    sy = max(ymax - ymin, 1e-6)

    # Vectorized face-centroid cell indices (once)
    face_centers = verts[faces].mean(axis=1)
    fxi_all = np.clip(((face_centers[:, 0] - xmin) / sx * (grid_size - 1)).astype(int), 0, grid_size - 1)
    fyi_all = np.clip(((face_centers[:, 1] - ymin) / sy * (grid_size - 1)).astype(int), 0, grid_size - 1)
    fcell_all = fyi_all * grid_size + fxi_all

    result = []
    sizes = [len(m.vertices) for m in tooth_list]
    med = float(np.median(sizes)) if sizes else 1.0
    for m in tooth_list:
        if len(m.vertices) <= 1.6 * med or len(m.vertices) <= 6000:
            result.append(m)
            continue
        # Cells covered by this tooth (via its vertices), dilated
        tverts = m.vertices
        xi = np.clip(((tverts[:, 0] - xmin) / sx * (grid_size - 1)).astype(int), 0, grid_size - 1)
        yi = np.clip(((tverts[:, 1] - ymin) / sy * (grid_size - 1)).astype(int), 0, grid_size - 1)
        sub = np.zeros((grid_size, grid_size), dtype=bool)
        sub[yi, xi] = True
        sub = ndimage.binary_dilation(sub, iterations=3)

        Hsub = np.full((grid_size, grid_size), np.nan)
        Hsub[sub] = H_col[sub]

        parts = detect_teeth_morph(Hsub, arch_type, 0.5, 0.3, grid_size,
                                   min_cells=6)
        if len(parts) >= 2:
            cell_to_part = {}
            for t, cells in enumerate(parts):
                for c in cells:
                    cell_to_part[c] = t
            # Assign mesh faces (centroid in sub-region) to parts
            in_sub = sub[fyi_all, fxi_all]
            f_tooth = np.full(len(faces), -1, dtype=int)
            for fi in np.where(in_sub)[0]:
                f_tooth[fi] = cell_to_part.get(int(fcell_all[fi]), -1)
            sub_list = []
            for t in range(len(parts)):
                fidx = np.where(f_tooth == t)[0]
                if len(fidx) >= 10:
                    sm = mesh.submesh([fidx], append=True)
                    if sm is not None and len(sm.vertices) > 800:
                        sub_list.append(sm)
            if len(sub_list) >= 2:
                result.extend(sub_list)
                continue
        result.append(m)
    return result


def _segment_at_cut(mesh, arch_type, det_cut, gum_cut, grid_size, min_verts):
    """Full segmentation for one detection cut. Returns {fdi: Trimesh}."""
    verts = mesh.vertices
    faces = mesh.faces
    H_col = mesh._seg_H_col

    tooth_cells = detect_teeth_morph(H_col, arch_type, det_cut, gum_cut, grid_size)
    if len(tooth_cells) < 2:
        return {}

    # Face assignment: only faces above the gum line belong to teeth
    z = verts[:, 2]
    zmin, zmax = float(z.min()), float(z.max())
    z_gum = zmin + (zmax - zmin) * gum_cut if arch_type == "upper" else \
            zmax - (zmax - zmin) * gum_cut

    n_teeth = len(tooth_cells)
    cell_to_tooth = {}
    for t, cells in enumerate(tooth_cells):
        for c in cells:
            cell_to_tooth[c] = t

    bounds = mesh._seg_bounds
    xmin, ymin, xmax, ymax = bounds
    sx = max(xmax - xmin, 1e-6)
    sy = max(ymax - ymin, 1e-6)
    face_centers = verts[faces].mean(axis=1)
    fxi = np.clip(((face_centers[:, 0] - xmin) / sx * (grid_size - 1)).astype(int), 0, grid_size - 1)
    fyi = np.clip(((face_centers[:, 1] - ymin) / sy * (grid_size - 1)).astype(int), 0, grid_size - 1)
    fcell = fyi * grid_size + fxi

    f_tooth = np.full(len(faces), -1, dtype=int)
    tooth_centroids_grid = [np.array(_centroid(c, grid_size)) for c in tooth_cells]
    for fi in range(len(faces)):
        # skip gum faces
        if arch_type == "upper" and face_centers[fi, 2] < z_gum:
            continue
        if arch_type == "lower" and face_centers[fi, 2] > z_gum:
            continue
        t = cell_to_tooth.get(int(fcell[fi]), -1)
        if t >= 0:
            f_tooth[fi] = t
        else:
            fc = np.array([fxi[fi], fyi[fi]], dtype=float)
            d = np.linalg.norm(np.array(tooth_centroids_grid) - fc, axis=1)
            f_tooth[fi] = int(np.argmin(d))

    # Extract tooth meshes
    tooth_list = []
    for t in range(n_teeth):
        fidx = np.where(f_tooth == t)[0]
        if len(fidx) < 10:
            continue
        m = mesh.submesh([fidx], append=True)
        if m is not None and len(m.vertices) > 30:
            tooth_list.append(m)

    if len(tooth_list) < 2:
        return {}

    # Merge tiny teeth (fragments) into their nearest big neighbor.
    # Real teeth in these scans are >= ~800 verts; fragments from
    # over-splitting are well below that, so use a fixed floor.
    sizes = np.array([len(m.vertices) for m in tooth_list])
    med = float(np.median(sizes)) if len(sizes) else 1.0
    thr = 500.0
    tooth_list.sort(key=lambda m: len(m.vertices), reverse=True)
    big = [m for m in tooth_list if len(m.vertices) >= thr]
    small = [m for m in tooth_list if len(m.vertices) < thr]
    for s in small:
        if not big:
            big.append(s)
            continue
        di = int(np.argmin([np.linalg.norm(s.centroid - b.centroid) for b in big]))
        big[di] = trimesh.util.concatenate([big[di], s])

    # Split oversized teeth (likely merges of 2+ teeth)
    big = _split_oversized(mesh, big, mesh._seg_H_col, arch_type, grid_size)

    if len(big) < 2:
        return {}

    # Order by angle around arch centroid (U-shape aware)
    cx = float(np.mean([m.centroid[0] for m in big]))
    cy = float(np.mean([m.centroid[1] for m in big]))
    big.sort(key=lambda m: np.arctan2(m.centroid[1] - cy, m.centroid[0] - cx))

    fdi_order = UPPER_FDI if arch_type == "upper" else LOWER_FDI
    result = {}
    for i, m in enumerate(big):
        if i < len(fdi_order):
            result[fdi_order[i]] = m
    return result


def segment_mesh(mesh, arch_type="upper", cut_ratio=0.3, min_verts=300):
    """Segment an arch mesh into teeth.

    Sweeps both the detection cut and the gum-line cut (self-correcting)
    and keeps the most plausible result: an ideal adult arch has 10-16
    teeth, so over-splitting beyond that is penalized.
    Returns {fdi: Trimesh}.
    """
    grid_size = 240

    log("  Building column map...")
    H_max, H_min, cell_verts, bounds = build_column_map(mesh.vertices, grid_size)
    mesh._seg_H_col = H_max if arch_type == "upper" else H_min
    mesh._seg_bounds = bounds

    log("  Detecting teeth (morphological separation)...")
    # Gum-line cut sweep around the (possibly AI-suggested) value.
    gum_cuts = [cut_ratio]
    for d in (-0.08, 0.08, -0.15, 0.15):
        c = round(cut_ratio + d, 2)
        if 0.12 <= c <= 0.65 and c not in gum_cuts:
            gum_cuts.append(c)

    def _score(n):
        # Ideal adult arch: 12-16 teeth. Penalize over-splitting (>16).
        if 12 <= n <= 16:
            return n + 10
        if 10 <= n < 12:
            return n + 5
        if n > 16:
            return max(0, 16 - (n - 16))
        return n

    best_result = {}
    best_pair = None
    best_score = -1
    for gc in gum_cuts:
        for dc in [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6]:
            res = _segment_at_cut(mesh, arch_type, dc, gc, grid_size, min_verts)
            s = _score(len(res))
            if s > best_score:
                best_score = s
                best_result = res
                best_pair = (dc, gc)
            if 12 <= len(res) <= 16:
                break  # good enough; full arch found
        if best_score >= 22:  # >=12 teeth
            break

    if best_result:
        log(f"  [best] {len(best_result)} teeth (detect_cut={best_pair[0]:.2f}, gum_cut={best_pair[1]:.2f})")
    return best_result


def extract_gingiva(mesh, arch_type="upper", cut_ratio=0.3):
    verts = mesh.vertices
    z = verts[:, 2]
    zmin, zmax = float(z.min()), float(z.max())
    cut_z = zmin + (zmax - zmin) * cut_ratio if arch_type == "upper" else zmax - (zmax - zmin) * cut_ratio
    mask = z < cut_z if arch_type == "upper" else z > cut_z
    gf = np.all(mask[mesh.faces], axis=1)
    return mesh.submesh([np.where(gf)[0]], append=True) if gf.sum() > 0 else None


def export_teeth(teeth, gingiva, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    for fdi in sorted(teeth.keys()):
        teeth[fdi].export(str(out_dir / f"tooth_{fdi}.stl"))
        log(f"  tooth_{fdi}.stl ({len(teeth[fdi].vertices)} verts)")
    if gingiva is not None and len(gingiva.vertices) > 0:
        gingiva.export(str(out_dir / "gingiva.stl"))
    return len(teeth)


def export_to_storage(teeth, gingiva, out_dir, storage_dir, source_path, arch_type):
    """Copy segmented STLs into the shared WhiteSmile storage folder so the
    ortho system can pick them up for staging & Blender rendering."""
    if not storage_dir:
        return
    try:
        parent = Path(source_path).parent
        case_name = parent.name if parent and parent.name not in (".", "\\", "/") else Path(source_path).stem
        case_name = re.sub(r"[^a-zA-Z0-9_-]", "_", case_name)[:60] or "case"
        target = Path(storage_dir) / case_name / "segmented_stls"
        target.mkdir(parents=True, exist_ok=True)

        copied = 0
        for f in sorted(out_dir.glob("tooth_*.stl")):
            shutil.copy2(f, target / f.name)
            copied += 1
        gingiva_src = out_dir / "gingiva.stl"
        if gingiva_src.exists():
            shutil.copy2(gingiva_src, target / "gingiva.stl")

        manifest = {
            "case_name": case_name,
            "arch_type": arch_type,
            "source_stl": str(Path(source_path).resolve()),
            "segmented_dir": str(Path(out_dir).resolve()),
            "storage_dir": str(target.resolve()),
            "tooth_count": copied,
            "has_gingiva": gingiva_src.exists(),
            "segmented_at": datetime.now().isoformat(timespec="seconds"),
            "ready_for_ortho": True,
        }
        manifest_path = target / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        log(f"  [STORAGE] {copied} teeth + gingiva -> {target} (manifest.json written)")
    except Exception as e:
        log(f"  [STORAGE] Failed to export: {e}")


def load_mesh(path):
    mesh = trimesh.load(str(path))
    if isinstance(mesh, trimesh.Scene):
        gs = [g for g in mesh.geometry.values() if isinstance(g, trimesh.Trimesh)]
        mesh = max(gs, key=lambda m: m.area) if gs else None
    return mesh


def segment_file(stl_path, out_dir, arch_type, cut_ratio=0.3, main_server_url="", prescription="", storage_dir=""):
    log(f"Segmenting {arch_type}: {Path(stl_path).name}")
    mesh = load_mesh(stl_path)
    if mesh is None:
        log("  [FAIL] Could not load mesh")
        return None, 0
    log(f"  {len(mesh.vertices)} verts, {len(mesh.faces)} faces")

    if prescription.strip():
        log(f"  Prescription loaded ({len(prescription)} chars)")

    if main_server_url:
        ai_cr = ai_suggest_cut_ratio(mesh, main_server_url)
        if ai_cr is not None:
            cut_ratio = ai_cr

    teeth = segment_mesh(mesh, arch_type, cut_ratio)
    if len(teeth) < 5:
        opp = "lower" if arch_type == "upper" else "upper"
        log(f"  Only {len(teeth)} teeth - trying {opp} arch...")
        teeth_opp = segment_mesh(mesh, opp, cut_ratio)
        if len(teeth_opp) > len(teeth):
            teeth = teeth_opp
            arch_type = opp

    if teeth:
        gingiva = extract_gingiva(mesh, arch_type, cut_ratio)
        n = export_teeth(teeth, gingiva, out_dir)
        export_to_storage(teeth, gingiva, out_dir, storage_dir, stl_path, arch_type)
        log(f"  [OK] {n} teeth -> {out_dir}")
        return str(out_dir), n
    log(f"  [FAIL] Could not segment teeth")
    return None, 0


def process_folder(patient_dir, out_dir, cut_ratio=0.3, main_server_url="", prescription="", storage_dir=""):
    log(f"Folder: {Path(patient_dir).name}")
    stls = sorted(Path(patient_dir).rglob("*.stl"))
    if not stls:
        log("[ERROR] No STL files")
        return None

    cls = {"upper": None, "lower": None}
    for f in stls:
        n = f.stem.lower()
        if re.match(r"(?:tooth|fdi)_\d{2}", n):
            continue
        if "upper" in n:
            cls["upper"] = f
        elif "lower" in n:
            cls["lower"] = f

    results = {}
    for arch in ["upper", "lower"]:
        if cls[arch] and cls[arch].exists():
            path, count = segment_file(cls[arch], out_dir, arch, cut_ratio, main_server_url,
                                        prescription, storage_dir)
            results[arch] = (path, count)
        else:
            results[arch] = (None, -1)

    for arch, (path, count) in results.items():
        if count == -1:
            log(f"[SUMMARY] {arch}: no scan found")
        elif count == 0:
            log(f"[SUMMARY] {arch}: FAILED (0 teeth)")
        else:
            log(f"[SUMMARY] {arch}: {count} teeth")

    total_ok = sum(1 for _, c in results.values() if c >= 8)
    scanned = sum(1 for _, c in results.values() if c != -1)
    if scanned > 0 and total_ok == scanned:
        log("[COMPLETE] yes")
        return str(out_dir)
    log("[COMPLETE] no")
    return None


def main():
    p = argparse.ArgumentParser(description="Fast Tooth Segmentation")
    p.add_argument("input", help="STL file or patient folder")
    p.add_argument("output", nargs="?", default=None, help="Output dir")
    p.add_argument("--upper", action="store_true", help="Upper arch")
    p.add_argument("--lower", action="store_true", help="Lower arch")
    p.add_argument("--cut", type=float, default=0.3, help="Cut ratio (0.3)")
    p.add_argument("--main-server", default="",
                   help="WhiteSmile main system URL (e.g. http://localhost:3000) for unified AI cut optimization")
    p.add_argument("--prescription", default="", help="Clinical prescription text")
    p.add_argument("--storage", default="",
                   help="Shared storage folder - segmented STLs are copied here for the ortho system")
    args = p.parse_args()

    inp = Path(args.input)
    if not inp.exists():
        print(f"[ERROR] Not found: {args.input}")
        sys.exit(1)

    out = Path(args.output) if args.output else (
        inp.parent / f"{inp.stem}_segmented" if inp.is_file() else inp / "segmented")

    if inp.is_file():
        arch = "upper" if args.upper else "lower" if args.lower else \
               "lower" if "lower" in inp.stem.lower() else "upper"
        r, _ = segment_file(inp, out, arch, args.cut, args.main_server, args.prescription,
                            args.storage)
    else:
        r = process_folder(inp, out, args.cut, args.main_server, args.prescription,
                           args.storage)

    if r:
        print(f"\n[EXPORT_PATH] {r}")
        sys.exit(0)
    sys.exit(1)


if __name__ == "__main__":
    main()
