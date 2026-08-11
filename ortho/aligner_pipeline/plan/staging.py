"""
Treatment staging engine.

Takes a ``TreatmentPlan`` with endpoint movements and generates
per-stage absolute tooth positions by interpolating along the
treatment arc.
"""

from __future__ import annotations

import copy
import math
from typing import Optional

from config.treatment_plan import TreatmentPlan, ToothMove, Stage


def _lerp(a: float, b: float, t: float) -> float:
    """Linear interpolate between *a* and *b* by factor *t* (0..1)."""
    return a + (b - a) * t


def _interpolate_moves(
    start: ToothMove,
    target: ToothMove,
    t: float,
    tooth_number: int,
) -> ToothMove:
    """Interpolate linearly between start and target ToothMove at fraction *t*."""
    return ToothMove(
        tooth_number=tooth_number,
        tx=_lerp(start.tx, target.tx, t),
        ty=_lerp(start.ty, target.ty, t),
        tz=_lerp(start.tz, target.tz, t),
        rx=_lerp(start.rx, target.rx, t),
        ry=_lerp(start.ry, target.ry, t),
        rz=_lerp(start.rz, target.rz, t),
    )


def compute_staging(
    plan: TreatmentPlan,
    num_stages: Optional[int] = None,
) -> list[Stage]:
    """Generate a list of *Stage* objects from the plan's endpoint movements.

    Parameters
    ----------
    plan : TreatmentPlan
        Must have ``movements`` populated.
    num_stages : int, optional
        Override ``plan.num_stages``.

    Returns
    -------
    list[Stage]
        Per-stage absolute tooth poses.
    """
    if not plan.movements:
        raise ValueError(
            "TreatmentPlan has no movements defined. "
            "Populate 'movements' or load a plan with pre-computed stages."
        )

    n = num_stages if num_stages is not None else plan.num_stages
    if n < 1:
        raise ValueError("num_stages must be >= 1")

    # Stage 0 is always the initial (zero) position
    # Stage N-1 is the final target
    stages: list[Stage] = []

    for si in range(n):
        t = si / (n - 1) if n > 1 else 1.0  # 0.0 -> 1.0
        tooth_positions: dict[int, ToothMove] = {}

        for tn, target_move in plan.movements.items():
            # Start from zero (initial position)
            start = ToothMove(tooth_number=tn)
            interp = _interpolate_moves(start, target_move, t, tn)
            tooth_positions[tn] = interp

        stages.append(
            Stage(
                stage_index=si,
                label=f"Stage {si + 1}/{n}",
                tooth_positions=tooth_positions,
            )
        )

    print(f"[staging] Computed {n} stages for {len(plan.movements)} teeth")
    return stages


def compute_staging_nonlinear(
    plan: TreatmentPlan,
    num_stages: Optional[int] = None,
    easing: str = "linear",
) -> list[Stage]:
    """Like ``compute_staging`` but with non-linear easing curves.

    Supported *easing* values: ``"linear"``, ``"ease-out"``, ``"ease-in-out"``.
    """
    n = num_stages if num_stages is not None else plan.num_stages

    def _ease(t: float) -> float:
        if easing == "ease-out":
            return 1.0 - (1.0 - t) ** 2
        elif easing == "ease-in-out":
            return t * t * (3.0 - 2.0 * t) if t < 0.5 else 1.0 - (1.0 - t) ** 2 * 0.5
        return t

    stages: list[Stage] = []
    for si in range(n):
        raw_t = si / (n - 1) if n > 1 else 1.0
        t = _ease(raw_t)
        tooth_positions: dict[int, ToothMove] = {}
        for tn, target_move in plan.movements.items():
            start = ToothMove(tooth_number=tn)
            interp = _interpolate_moves(start, target_move, t, tn)
            tooth_positions[tn] = interp
        stages.append(
            Stage(
                stage_index=si,
                label=f"Stage {si + 1}/{n} ({easing})",
                tooth_positions=tooth_positions,
            )
        )
    print(f"[staging] Computed {n} stages ({easing}) for {len(plan.movements)} teeth")
    return stages
