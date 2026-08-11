"""
Treatment plan data models for clear aligner design.

Defines the structured representation of a patient's orthodontic treatment
plan: which teeth move, by how much (translation + rotation), over how many
stages, plus global parameters like shell thickness and attachment config.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from typing import Optional


# ---------------------------------------------------------------------------
# Per-tooth movement target
# ---------------------------------------------------------------------------

@dataclass
class ToothMove:
    """One tooth's target displacement at the end of the treatment.

    All translations are in **mm** in the global (scene) coordinate system.
    All rotations are in **degrees** about the tooth's local centre-of-mass.

    Coordinate convention (matches Blender):
      +X = patient right, +Y = posterior, +Z = superior (occlusal)
    """

    tooth_number: int                    # FDI tooth number, e.g. 11, 12, …
    tx: float = 0.0                      # translation X (mm)
    ty: float = 0.0                      # translation Y (mm)
    tz: float = 0.0                      # translation Z (mm)
    rx: float = 0.0                      # rotation about X (degrees)
    ry: float = 0.0                      # rotation about Y (degrees)
    rz: float = 0.0                      # rotation about Z (degrees)

    # Optional: final angulation/torque (alternative to rx/ry/rz)
    tip: Optional[float] = None          # mesial/distal tip (deg)
    torque: Optional[float] = None       # buccal/lingual torque (deg)
    rotation: Optional[float] = None     # rotation about tooth axis (deg)

    # Attachment (optional)
    attachment_type: Optional[str] = None  # e.g. "ellipsoid", "beveled"
    attachment_size: tuple[float, float, float] = (2.0, 2.0, 1.5)  # mm


# ---------------------------------------------------------------------------
# One stage within the treatment
# ---------------------------------------------------------------------------

@dataclass
class Stage:
    """A single aligner stage with absolute tooth poses."""

    stage_index: int                         # 0-based
    label: str = ""                          # optional human-readable name
    tooth_positions: dict[int, ToothMove] = field(default_factory=dict)
    """Per-tooth absolute position for this stage, keyed by tooth_number."""


# ---------------------------------------------------------------------------
# Full treatment plan
# ---------------------------------------------------------------------------

@dataclass
class TreatmentPlan:
    """Complete treatment specification."""

    patient_id: str = ""
    case_name: str = ""
    description: str = ""

    # --- Tooth inventory ---
    tooth_numbers: list[int] = field(default_factory=list)
    """FDI numbers of teeth present in the segmented STL set."""

    # --- Endpoint movements (planning) ---
    movements: dict[int, ToothMove] = field(default_factory=dict)
    """Tooth_number -> final target movement from initial position."""

    # --- Staging ---
    num_stages: int = 20
    stages: list[Stage] = field(default_factory=list)
    """If empty, staging is computed automatically from *movements*."""

    # --- Global aligner parameters ---
    shell_thickness_mm: float = 0.75
    offset_mm: float = 0.1                # gap between tooth and aligner
    undercut_block_angle: float = 45.0    # degrees
    gingiva_margin_mm: float = 1.0        # how far below gumline

    # --- Attachments ---
    attachments_enabled: bool = True

    # --- Paths (filled at runtime) ---
    stl_dir: str = ""                     # input segmented STL directory
    output_dir: str = ""                  # base output directory
    blender_exe: str = ""                 # Blender executable path

    # --- Metadata ---
    created_by: str = "aligner_pipeline"
    created_date: str = ""


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------

def plan_to_json(plan: TreatmentPlan, indent: int = 2) -> str:
    """Serialize a TreatmentPlan to JSON."""
    d = asdict(plan)
    # Remove computed stages from serialization; they are regenerated.
    d.pop("stages", None)
    return json.dumps(d, indent=indent, ensure_ascii=False)


def plan_from_json(text: str) -> TreatmentPlan:
    """Deserialize a TreatmentPlan from JSON."""
    d = json.loads(text)
    # Reconstruct ToothMove objects (key is the tooth_number)
    moves = {}
    for k, v in d.get("movements", {}).items():
        v["tooth_number"] = int(k)
        moves[int(k)] = ToothMove(**v)
    d["movements"] = moves
    # Reconstruct stages if present
    stages = []
    for s in d.get("stages", []):
        tp = {}
        for tk, tv in s.get("tooth_positions", {}).items():
            tp[int(tk)] = ToothMove(**tv)
        s["tooth_positions"] = tp
        stages.append(Stage(**s))
    d["stages"] = stages
    return TreatmentPlan(**d)


def save_plan(plan: TreatmentPlan, path: str) -> None:
    """Write a TreatmentPlan to a JSON file."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(plan_to_json(plan))
    print(f"[plan] Saved treatment plan to {path}")


def load_plan(path: str) -> TreatmentPlan:
    """Read a TreatmentPlan from a JSON file."""
    with open(path, "r", encoding="utf-8") as f:
        return plan_from_json(f.read())
