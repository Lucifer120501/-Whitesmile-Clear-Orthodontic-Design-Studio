"""
Staging plan generation (via the WhiteSmile main system AI).

Interprets a free-text orthodontic prescription and produces structured
per-tooth movement targets. All AI is delegated to the WhiteSmile main
system (single AI brain) through ``POST /api/ai/staging-plan`` — this
module no longer holds API keys or talks to AI providers directly.

Falls back to a rule-based heuristic if the main system is unreachable,
no server URL is set, or the API call fails.

Usage
-----
    from ai_staging import generate_staging_plan, load_main_config, save_main_config
    plan = generate_staging_plan(
        prescription="Align tooth 12 with 2mm buccal movement...",
        tooth_numbers=[11, 12, 13, 14, 21, 22],
    )
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Optional

from config.treatment_plan import TreatmentPlan, ToothMove

# Import pipeline parameters for consistency
try:
    from config.pipeline_params import SHELL_THICKNESS_MM
except ImportError:
    SHELL_THICKNESS_MM = 0.75


# ---------------------------------------------------------------------------
#  Main system configuration (single AI brain)
# ---------------------------------------------------------------------------

DEFAULT_MAIN_SERVER = "http://localhost:3000"


def _config_path() -> str:
    """Location of the main-system settings file (alongside the pipeline)."""
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "ai_config.json")


def load_main_config() -> dict:
    """Load saved main-system settings. Returns keys: main_server_url."""
    default = {"main_server_url": os.environ.get("WHITESMILE_SERVER_URL", DEFAULT_MAIN_SERVER)}
    path = _config_path()
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                saved = json.load(f)
            default.update({k: v for k, v in saved.items() if v})
        except Exception as e:
            print(f"[ai_staging] Failed to read ai_config.json: {e}")
    return default


def save_main_config(main_server_url: str) -> dict:
    """Persist the main-system server URL. Returns the saved config."""
    config = {"main_server_url": (main_server_url or DEFAULT_MAIN_SERVER).strip()}
    with open(_config_path(), "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    print(f"[ai_staging] Saved main server config ({config['main_server_url']})")
    return config


# ---------------------------------------------------------------------------
#  Auto-detection of available WhiteSmile servers
# ---------------------------------------------------------------------------

_DEFAULT_PROBE_PORTS = [3000, 8080, 8000, 5000]


def probe_main_server(server_url: Optional[str] = None,
                      extra_ports: Optional[list[int]] = None,
                      timeout: float = 2.0) -> Optional[str]:
    """Probe *server_url* (or common ports if None) and return the first URL
    whose ``/api/system/config`` endpoint responds.

    Returns None when no reachable server is found.
    """
    candidates: list[str] = []

    if server_url:
        candidates.append(server_url.rstrip("/"))
    else:
        # Try the stored default first, then common ports on localhost
        candidates.append(DEFAULT_MAIN_SERVER)
        for port in (extra_ports or _DEFAULT_PROBE_PORTS):
            if port != 3000:
                candidates.append(f"http://localhost:{port}")

    for url in candidates:
        try:
            import urllib.request
            req = urllib.request.Request(
                url.rstrip("/") + "/api/system/config",
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read())
            if isinstance(data, dict):
                print(f"[ai_staging] Discovered WhiteSmile server at {url}")
                return url
        except Exception:
            continue
    return None


# Backwards-compatible aliases
load_ai_config = load_main_config
save_ai_config = save_main_config


# ---------------------------------------------------------------------------
#  Prompt building (informational — the main system builds the real prompt)
# ---------------------------------------------------------------------------

def _build_prompt(prescription: str, tooth_numbers: list[int], num_stages: int) -> str:
    """Return a summary of what is being sent to the main system AI."""
    return (
        f"Prescription: {prescription or '(none)'}\n"
        f"Teeth (FDI): {tooth_numbers}\n"
        f"Stages: {num_stages}"
    )


def _extract_json(text: str) -> Optional[dict]:
    """Parse a JSON object out of a model response (handles code fences)."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find a JSON block inside
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    return None


# ---------------------------------------------------------------------------
#  Main system client
# ---------------------------------------------------------------------------

def _call_main_server(prescription: str, tooth_numbers: list[int],
                      num_stages: int, main_server_url: str,
                      case_name: str = "") -> Optional[dict]:
    """Ask the WhiteSmile main system AI for a staging plan.

    Returns the parsed JSON body (movements / num_stages / notes) or None.
    """
    url = (main_server_url or DEFAULT_MAIN_SERVER).rstrip("/") + "/api/ai/staging-plan"
    body = json.dumps({
        "prescription": prescription,
        "tooth_numbers": tooth_numbers,
        "num_stages": num_stages,
        "case_name": case_name,
    }).encode()
    headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"[ai_staging] WhiteSmile main system AI error: {e}")
        return None

    if not isinstance(data, dict) or "movements" not in data:
        print("[ai_staging] Main system returned an unexpected shape.")
        return None
    print(f"[ai_staging] WhiteSmile AI plan: {data.get('notes', '')}")
    return data


# ---------------------------------------------------------------------------
#  Rule-based fallback
# ---------------------------------------------------------------------------

_HEURISTIC_MOVEMENTS = {
    # Default movements for common alignment patterns
    # (tx, ty, tz, rx, ry, rz) — small corrections
    "default": (0.3, 0.0, 0.1, 0.0, 0.5, 0.0),
    # Anteriors get more movement
    "anterior": (0.5, 0.1, 0.2, 0.0, 1.0, 0.3),
    # Premolars
    "premolar": (0.3, 0.0, 0.1, 0.0, 0.5, 0.0),
}

_ANTERIOR_TEETH = {11, 12, 13, 21, 22, 23, 31, 32, 33, 41, 42, 43}
_PREMOLAR_TEETH = {14, 15, 24, 25, 34, 35, 44, 45}


def _rule_based_movement(tooth_number: int, prescription: str = "") -> dict:
    """Generate heuristic movements for a tooth based on its type."""
    if tooth_number in _ANTERIOR_TEETH:
        base = _HEURISTIC_MOVEMENTS["anterior"]
    elif tooth_number in _PREMOLAR_TEETH:
        base = _HEURISTIC_MOVEMENTS["premolar"]
    else:
        base = _HEURISTIC_MOVEMENTS["default"]

    # Parse prescription for specific tooth mentions
    tn_str = str(tooth_number)
    pattern = rf"\b{tn_str}\b.*?(\d+(?:\.\d+)?)\s*mm"
    match = re.search(pattern, prescription.lower())

    if match:
        # Override with prescribed movement magnitude
        magnitude = float(match.group(1))
        return {
            "tx": magnitude * 0.6,
            "ty": magnitude * 0.3,
            "tz": magnitude * 0.1,
            "rx": 0.0,
            "ry": magnitude * 2.0,
            "rz": magnitude * 0.5,
            "attachment_type": "ellipsoid" if magnitude > 2.0 else None,
        }

    return {
        "tx": base[0],
        "ty": base[1],
        "tz": base[2],
        "rx": base[3],
        "ry": base[4],
        "rz": base[5],
        "attachment_type": None,
    }


# ---------------------------------------------------------------------------
#  Public API
# ---------------------------------------------------------------------------

def _parse_movements(data: dict, tooth_numbers: list[int]) -> dict[int, ToothMove]:
    """Convert a raw AI response dict into {tooth_number: ToothMove}."""
    movements: dict[int, ToothMove] = {}
    if data and "movements" in data:
        for tn_str, m in data["movements"].items():
            try:
                tn = int(tn_str)
            except (ValueError, TypeError):
                continue
            movements[tn] = ToothMove(
                tooth_number=tn,
                tx=float(m.get("tx", 0)),
                ty=float(m.get("ty", 0)),
                tz=float(m.get("tz", 0)),
                rx=float(m.get("rx", 0)),
                ry=float(m.get("ry", 0)),
                rz=float(m.get("rz", 0)),
                attachment_type=m.get("attachment_type"),
            )
    # Fill in missing teeth with zero movement
    for tn in tooth_numbers:
        if tn not in movements:
            movements[tn] = ToothMove(tooth_number=tn)
    return movements


def _clamp_movements(movements: dict[int, ToothMove], num_stages: int) -> int:
    """Clamp per-tooth movement totals to clinically safe limits.

    Uses Invisalign-style per-stage limits scaled by the number of stages,
    with absolute caps so a single bad AI output can never produce a broken
    render. Returns how many teeth were clamped.
    """
    max_t = min(0.25 * num_stages, 6.0)   # mm — translation (mesial/distal/buccal)
    max_tz = min(0.20 * num_stages, 4.0)  # mm — extrusion/intrusion
    max_r = min(2.0 * num_stages, 20.0)   # degrees — rotation/tip/torque

    def _cl(v, cap):
        try:
            return max(-cap, min(cap, float(v)))
        except (TypeError, ValueError):
            return 0.0

    clamped = 0
    for tn, m in movements.items():
        nt = ToothMove(
            tooth_number=m.tooth_number,
            tx=_cl(m.tx, max_t),
            ty=_cl(m.ty, max_t),
            tz=_cl(m.tz, max_tz),
            rx=_cl(m.rx, max_r),
            ry=_cl(m.ry, max_r),
            rz=_cl(m.rz, max_r),
            attachment_type=m.attachment_type,
        )
        if (nt.tx, nt.ty, nt.tz, nt.rx, nt.ry, nt.rz) != (m.tx, m.ty, m.tz, m.rx, m.ry, m.rz):
            clamped += 1
        movements[tn] = nt
    return clamped


def generate_staging_plan(
    prescription: str,
    tooth_numbers: list[int],
    num_stages: int = 20,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    prefer_ai: bool = True,
    main_server_url: Optional[str] = None,
) -> TreatmentPlan:
    """Generate a treatment plan from a free-text prescription.

    All AI is delegated to the WhiteSmile main system (single AI brain).
    ``provider``/``model``/``api_key`` are accepted for backwards
    compatibility but ignored — use ``main_server_url`` instead.

    Parameters
    ----------
    prescription : str
        Free-text orthodontic prescription.
    tooth_numbers : list[int]
        FDI numbers of teeth present.
    num_stages : int
        Number of stages for the treatment.
    provider : str, optional
        Deprecated. Use ``main_server_url``.
    model : str, optional
        Deprecated. Use ``main_server_url``.
    api_key : str, optional
        Deprecated. Use ``main_server_url``.
    prefer_ai : bool
        If True (default), try the WhiteSmile main system AI before
        falling back to rule-based heuristics.
    main_server_url : str, optional
        URL of the WhiteSmile main system (e.g. http://localhost:3000).
        Defaults to the saved config, then the ``WHITESMILE_SERVER_URL``
        env var, then ``http://localhost:3000``.

    Returns
    -------
    TreatmentPlan
        Fully populated plan (without computed stages).
    """
    # Heuristic-only shortcut — keeps the lab running without any AI.
    if provider == "heuristic" or not prefer_ai:
        print(f"[ai_staging] Using rule-based fallback ({provider=})")
        movements = {
            tn: ToothMove(
                tooth_number=tn,
                **_rule_based_movement(tn, prescription),
            )
            for tn in tooth_numbers
        }
        return TreatmentPlan(
            tooth_numbers=tooth_numbers,
            movements=movements,
            num_stages=num_stages,
            shell_thickness_mm=SHELL_THICKNESS_MM,
            description=f"Heuristic: {prescription[:80]}",
        )

    cfg = load_main_config()
    server_url = main_server_url or cfg.get("main_server_url", DEFAULT_MAIN_SERVER)

    _build_prompt(prescription, tooth_numbers, num_stages)  # informational
    result = _call_main_server(prescription, tooth_numbers, num_stages, server_url)

    if result and "movements" in result:
        movements = _parse_movements(result, tooth_numbers)
        # Safety: clamp AI output to clinically safe per-tooth totals.
        n_clamped = _clamp_movements(movements, int(result.get("num_stages", num_stages)))
        print(f"[ai_staging] Using WhiteSmile AI plan ({len(movements)} teeth"
              f"{f', {n_clamped} clamped to biological limits' if n_clamped else ''})")
        return TreatmentPlan(
            tooth_numbers=tooth_numbers,
            movements=movements,
            num_stages=result.get("num_stages", num_stages),
            shell_thickness_mm=result.get("shell_thickness_mm", SHELL_THICKNESS_MM),
            description=f"WhiteSmile AI: {result.get('notes', prescription[:80])}",
        )

    print("[ai_staging] Main system AI unavailable — using heuristic fallback.")
    return generate_staging_plan(
        prescription, tooth_numbers, num_stages,
        provider="heuristic", prefer_ai=True,
    )
