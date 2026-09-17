"""
Read / write treatment plans to disk.

Supports JSON format defined in ``config.treatment_plan`` and a simpler
YAML-like human-readable format for manual editing.
"""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path
from typing import Optional

from config.treatment_plan import (
    TreatmentPlan,
    ToothMove,
    Stage,
    save_plan,
    load_plan,
    plan_to_json,
    plan_from_json,
)

# Re-export the main functions so callers can do:
#   from plan.plan_io import save_plan, load_plan
save_plan = save_plan
load_plan = load_plan


def export_staging_csv(plan: TreatmentPlan, csv_path: str) -> None:
    """Write per-stage tooth positions as a CSV table.

    Columns: stage, tooth, tx, ty, tz, rx, ry, rz
    """
    rows = []
    for stage in plan.stages:
        for tn, move in stage.tooth_positions.items():
            rows.append({
                "stage": stage.stage_index,
                "tooth": tn,
                "tx": move.tx,
                "ty": move.ty,
                "tz": move.tz,
                "rx": move.rx,
                "ry": move.ry,
                "rz": move.rz,
            })
    if not rows:
        print("[plan_io] No staged data to export.")
        return
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)
    print(f"[plan_io] Exported {len(rows)} rows to {csv_path}")


def import_staging_csv(csv_path: str) -> dict[int, dict[int, ToothMove]]:
    """Read a CSV and return ``{stage_index: {tooth_number: ToothMove}}``."""
    result: dict[int, dict[int, ToothMove]] = {}
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            si = int(row["stage"])
            tn = int(row["tooth"])
            move = ToothMove(
                tooth_number=tn,
                tx=float(row.get("tx", 0)),
                ty=float(row.get("ty", 0)),
                tz=float(row.get("tz", 0)),
                rx=float(row.get("rx", 0)),
                ry=float(row.get("ry", 0)),
                rz=float(row.get("rz", 0)),
            )
            result.setdefault(si, {})[tn] = move
    print(f"[plan_io] Imported staging CSV: {csv_path}")
    return result


def discover_stl_files(stl_dir: str) -> dict[int, str]:
    """Scan *stl_dir* for ``tooth_XX.stl`` and ``gingiva.stl``.

    Returns ``{tooth_number: absolute_path}``. Gingiva is stored under key 0.
    """
    tooth_map: dict[int, str] = {}
    p = Path(stl_dir)
    if not p.is_dir():
        raise NotADirectoryError(f"STL directory not found: {stl_dir}")

    for fpath in sorted(p.iterdir()):
        name = fpath.stem.lower()
        if name == "gingiva":
            tooth_map[0] = str(fpath.resolve())
        elif name.startswith("tooth_"):
            try:
                tn = int(name.split("_")[1])
                tooth_map[tn] = str(fpath.resolve())
            except (IndexError, ValueError):
                print(f"[plan_io] Skipping unrecognised STL: {fpath.name}")
    print(f"[plan_io] Discovered {len(tooth_map)} STL files in {stl_dir}")
    return tooth_map
