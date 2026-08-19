"""
aligner-pipeline web server.

Serves the 3D staging UI, REST API for treatment plans,
WebSocket live log streaming, and STL file serving for the viewport.

Usage
-----
    python server.py
    # Opens http://localhost:8765
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

# --- Pipeline modules ---
from config.treatment_plan import (
    TreatmentPlan,
    ToothMove,
    plan_to_json,
    plan_from_json,
    save_plan,
    load_plan,
)
from plan.plan_io import discover_stl_files
from plan.staging import compute_staging, compute_staging_nonlinear
from ai_staging import (
    generate_staging_plan,
    load_main_config,
    save_main_config,
    DEFAULT_MAIN_SERVER,
)

# ===================================================================
#  Log streaming — capture Python logging to WebSocket clients
# ===================================================================

_log_clients: set[WebSocket] = set()


class WebSocketLogHandler(logging.Handler):
    """Broadcast log records to all connected WebSocket clients."""

    def emit(self, record):
        msg = self.format(record)
        # Run in a new task so we don't block the logger. Logs can also be
        # emitted from worker threads (e.g. startup cleanup) where there is
        # no running event loop — in that case just skip the broadcast.
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(_broadcast_log(msg))


async def _broadcast_log(msg: str):
    disconnected = set()
    for ws in _log_clients:
        try:
            await ws.send_json({"type": "log", "text": msg})
        except Exception:
            disconnected.add(ws)
    _log_clients.difference_update(disconnected)


def _setup_logging():
    handler = WebSocketLogHandler()
    handler.setLevel(logging.INFO)
    formatter = logging.Formatter("[%(name)s] %(message)s")
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    # Also add console handler
    console = logging.StreamHandler()
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter("[%(name)s] %(message)s"))
    root.addHandler(console)


# ===================================================================
#  App state
# ===================================================================

class AppState:
    """Shared server state."""

    def __init__(self):
        self.work_dir: str = os.path.join(os.getcwd(), "workspace")
        self.blender_exe: str = self._find_blender()
        self.current_plan: Optional[str] = None  # path to plan JSON
        self.pipeline_running: bool = False

    @staticmethod
    def _find_blender() -> str:
        candidates = [
            r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
        ]
        for p in candidates:
            if os.path.isfile(p):
                return p
        return "blender"

    @property
    def plans_dir(self) -> str:
        d = os.path.join(self.work_dir, "plans")
        os.makedirs(d, exist_ok=True)
        return d

    @property
    def storage_dir(self) -> str:
        """Dedicated shared storage folder (main system's /storage).

        Rendered aligner stage STLs are written here (never inside the
        ortho workspace) so all three WhiteSmile systems share one source
        of truth. Falls back to <repo>/storage when the main system is
        unreachable.
        """
        d = main_system_storage_folder()
        if d:
            return d
        return os.path.normpath(os.path.join(os.getcwd(), "..", "..", "storage"))

    @property
    def output_dir(self) -> str:
        # Rendered stages now live inside the shared storage folder,
        # keyed by case: <storage>/<case>/stages/stage_XXX/
        d = os.path.join(self.storage_dir)
        os.makedirs(d, exist_ok=True)
        return d


state = AppState()

# Short-TTL cache so the blocking main-system lookup doesn't hammer the
# network on every /api/storage poll (and doesn't stall the event loop).
_storage_folder_cache: dict = {"value": "", "ts": 0.0}
_STORAGE_TTL_SECONDS = 15.0


def main_system_storage_folder(server_url: Optional[str] = None) -> str:
    """Ask the WhiteSmile main system for the shared storage folder.

    This is the folder where the agliner segmentation pipeline deposits
    tooth STLs. Returns '' if the main system is unreachable. The result is
    cached for a few seconds because the config rarely changes.
    """
    now = time.monotonic()
    if _storage_folder_cache["value"] and (now - _storage_folder_cache["ts"]) < _STORAGE_TTL_SECONDS:
        return _storage_folder_cache["value"]
    try:
        import urllib.request
        cfg = load_main_config()
        base = (server_url or cfg.get("main_server_url", DEFAULT_MAIN_SERVER)).rstrip("/")
        req = urllib.request.Request(base + "/api/system/config", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            info = json.loads(resp.read())
        storage = info.get("storageFolder", "")
        result = storage if storage and os.path.isdir(storage) else ""
    except Exception as e:
        logger.warning(f"[storage] Could not reach main system for storage folder: {e}")
        result = ""
    _storage_folder_cache["value"] = result
    _storage_folder_cache["ts"] = now
    return result


def _probe_main_ai(server_url: str) -> bool:
    """Blocking probe of the main system AI availability (run in a thread)."""
    try:
        import urllib.request
        req = urllib.request.Request(server_url.rstrip("/") + "/api/system/config", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            info = json.loads(resp.read())
        return bool(info.get("aiAvailable", False))
    except Exception:
        return False


def find_segmented_dirs(storage_folder: str) -> list[str]:
    """Find every `segmented_stls` folder deposited by the agliner pipeline
    inside the shared storage folder, newest first."""
    results: list[str] = []
    if not storage_folder or not os.path.isdir(storage_folder):
        return results
    try:
        for entry in sorted(os.listdir(storage_folder)):
            case_dir = os.path.join(storage_folder, entry)
            if not os.path.isdir(case_dir):
                continue
            seg = os.path.join(case_dir, "segmented_stls")
            if os.path.isdir(seg):
                results.append(seg)
        # Newest case first — the viewer/auto-pipeline should always pick up
        # the most recently uploaded patient, not the alphabetically-first one.
        results.sort(key=lambda seg: os.path.getmtime(seg), reverse=True)
    except Exception:
        pass
    return results


FINALIZED_MARKER = ".finalized"


def is_case_finalized(case_dir: str) -> bool:
    """A case is *finalized* (saved for reopening) when its case dir in the
    shared storage contains a `.finalized` marker file. Everything else is
    temporary and gets wiped on server restart."""
    return os.path.isfile(os.path.join(case_dir, FINALIZED_MARKER))


def cleanup_temporary_cases(storage_folder: str) -> list[str]:
    """Delete every non-finalized case dir (segmented STLs + rendered stages)
    and its plan JSON. Only cases the user explicitly finalized survive.

    Returns the list of removed case names.
    """
    removed: list[str] = []
    if not storage_folder or not os.path.isdir(storage_folder):
        return removed
    for entry in sorted(os.listdir(storage_folder)):
        case_dir = os.path.join(storage_folder, entry)
        if not os.path.isdir(case_dir):
            continue
        if is_case_finalized(case_dir):
            continue
        # Only touch dirs that look like ortho cases (segmented STLs or stages)
        has_seg = os.path.isdir(os.path.join(case_dir, "segmented_stls"))
        has_stages = os.path.isdir(os.path.join(case_dir, "stages"))
        if not (has_seg or has_stages):
            continue
        try:
            shutil.rmtree(case_dir, ignore_errors=True)
            removed.append(entry)
            logger.info(f"[cleanup] Removed temporary case: {entry}")
        except Exception as e:
            logger.warning(f"[cleanup] Could not remove {entry}: {e}")
        # Drop the matching plan so it can't be reopened against deleted STLs
        plan_path = os.path.join(state.plans_dir, f"{entry}.json")
        if os.path.isfile(plan_path):
            try:
                os.remove(plan_path)
                logger.info(f"[cleanup] Removed plan for temporary case: {entry}")
            except OSError:
                pass
    # Orphaned plans: any plan whose case dir no longer exists in storage
    # (e.g. wiped by an earlier interrupted cleanup) must be dropped too.
    if os.path.isdir(state.plans_dir):
        for f in sorted(os.listdir(state.plans_dir)):
            if not f.endswith(".json"):
                continue
            case_name = f[: -len(".json")]
            case_dir = os.path.join(storage_folder, case_name)
            if not os.path.isdir(case_dir):
                try:
                    os.remove(os.path.join(state.plans_dir, f))
                    logger.info(f"[cleanup] Removed orphaned plan: {case_name}")
                except OSError:
                    pass
    return removed

# ===================================================================
#  FastAPI app
# ===================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    _setup_logging()
    log = logging.getLogger("server")
    log.info("=" * 50)
    log.info("Aligner Pipeline Server starting…")
    log.info(f"Blender: {state.blender_exe}")
    log.info(f"Work dir: {state.work_dir}")
    log.info(f"Plans:    {state.plans_dir}")
    log.info(f"Output:   {state.storage_dir} (shared storage, per case: <storage>/<case>/stages)")
    log.info("=" * 50)
    # Temporary STL policy: wipe every non-finalized case on startup so a
    # refresh/restart never shows a previous patient's design. Only cases the
    # user explicitly finalized (`.finalized` marker) are kept for reopening.
    try:
        storage = await asyncio.to_thread(main_system_storage_folder)
        removed = await asyncio.to_thread(cleanup_temporary_cases, storage)
        if removed:
            log.info(f"[cleanup] Wiped {len(removed)} temporary case(s): {', '.join(removed)}")
        else:
            log.info("[cleanup] No temporary cases to wipe (all finalized or none present)")
    except Exception as e:
        log.warning(f"[cleanup] Startup cleanup skipped: {e}")
    yield
    log.info("Server shutting down.")


app = FastAPI(title="Aligner Pipeline", version="1.0.0", lifespan=lifespan)
logger = logging.getLogger("server")


# ---------------------------------------------------------------------------
#  Static files
# ---------------------------------------------------------------------------

static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def index():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.isfile(index_path):
        # Never cache the UI — the embedded iframe must always pick up the
        # latest JS (stale cached copies caused recurring null-case crashes).
        return HTMLResponse(
            open(index_path, encoding="utf-8").read(),
            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
        )
    return HTMLResponse("<h1>Aligner Pipeline</h1><p>Frontend not built yet. Run with the UI.</p>")


# ---------------------------------------------------------------------------
#  WebSocket — live log streaming
# ---------------------------------------------------------------------------

@app.websocket("/ws/logs")
async def ws_logs(websocket: WebSocket):
    await websocket.accept()
    _log_clients.add(websocket)
    try:
        await websocket.send_json({"type": "info", "text": "Connected to pipeline log stream"})
        while True:
            # Keep connection alive, wait for client pings
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        _log_clients.discard(websocket)
    except Exception:
        _log_clients.discard(websocket)


# ---------------------------------------------------------------------------
#  REST API — plans
# ---------------------------------------------------------------------------

@app.get("/api/plans")
async def list_plans():
    """List available treatment plans."""
    plans_dir = state.plans_dir
    files = []
    for f in sorted(os.listdir(plans_dir)):
        if f.endswith(".json"):
            path = os.path.join(plans_dir, f)
            files.append({
                "name": f.replace(".json", ""),
                "path": path,
                "modified": os.path.getmtime(path),
                "size": os.path.getsize(path),
            })
    return {"plans": files}


@app.get("/api/storage")
async def list_storage_cases():
    """List segmented cases deposited in the shared WhiteSmile storage folder
    by the agliner pipeline (ready for staging & rendering here). Newest case
    first; each entry carries its finalized flag."""
    storage = await asyncio.to_thread(main_system_storage_folder)
    seg_dirs = find_segmented_dirs(storage)
    cases = []
    for seg in seg_dirs:
        case_name = os.path.basename(os.path.dirname(seg))
        case_dir = os.path.dirname(seg)
        tooth_map = discover_stl_files(seg)
        cases.append({
            "case_name": case_name,
            "segmented_dir": seg,
            "tooth_count": len([t for t in tooth_map if t != 0]),
            "has_gingiva": bool(tooth_map.get(0)),
            "manifest": os.path.isfile(os.path.join(seg, "manifest.json")),
            "finalized": is_case_finalized(case_dir),
            "modified": os.path.getmtime(seg),
        })
    return {
        "storage_folder": storage,
        "cases": cases,
    }


@app.post("/api/cases/{name}/finalize")
async def finalize_case(name: str):
    """Mark a case as finalized — it survives the next startup cleanup and can
    be reopened later. Writes a `.finalized` marker in the case dir."""
    storage = await asyncio.to_thread(main_system_storage_folder)
    case_dir = os.path.join(storage, name)
    if not os.path.isdir(case_dir):
        raise HTTPException(404, f"Case not found: {name}")
    marker = os.path.join(case_dir, FINALIZED_MARKER)
    try:
        with open(marker, "w", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S"))
    except OSError as e:
        raise HTTPException(500, f"Could not finalize case: {e}")
    logger.info(f"Finalized case: {name}")
    return {"status": "ok", "case": name, "finalized": True}


@app.post("/api/cases/{name}/discard")
async def discard_case(name: str):
    """Delete a case immediately (segmented STLs + rendered stages + plan)."""
    storage = await asyncio.to_thread(main_system_storage_folder)
    case_dir = os.path.join(storage, name)
    removed = False
    if os.path.isdir(case_dir):
        try:
            shutil.rmtree(case_dir, ignore_errors=True)
            removed = True
        except Exception as e:
            raise HTTPException(500, f"Could not discard case: {e}")
    plan_path = os.path.join(state.plans_dir, f"{name}.json")
    if os.path.isfile(plan_path):
        try:
            os.remove(plan_path)
        except OSError:
            pass
    if not removed and not os.path.isfile(plan_path):
        raise HTTPException(404, f"Case not found: {name}")
    logger.info(f"Discarded case: {name}")
    return {"status": "ok", "case": name, "discarded": True}


@app.post("/api/plans")
async def create_plan(data: dict):
    """Create a new treatment plan from STL directory or prescription."""
    stl_dir = data.get("stl_dir", "")
    prescription = data.get("prescription", "")
    num_stages = data.get("num_stages", 20)

    # Auto-discover segmented STLs from the shared WhiteSmile storage folder
    # (deposited by the agliner pipeline) when no explicit dir is given.
    if not stl_dir:
        storage = await asyncio.to_thread(main_system_storage_folder)
        seg_dirs = find_segmented_dirs(storage)
        if len(seg_dirs) == 1:
            stl_dir = seg_dirs[0]
            logger.info(f"[storage] Auto-discovered segmented STLs: {stl_dir}")
        elif len(seg_dirs) > 1:
            # If the case name matches a storage subfolder, prefer it
            case_name_hint = (data.get("case_name") or "").strip()
            for seg in seg_dirs:
                if case_name_hint and case_name_hint in seg.replace("\\", "/"):
                    stl_dir = seg
                    break
            if not stl_dir:
                stl_dir = seg_dirs[0]

    if stl_dir and not os.path.isdir(stl_dir):
        raise HTTPException(400, f"STL directory not found: {stl_dir}")

    if not stl_dir and not prescription:
        raise HTTPException(400, "Provide either stl_dir or prescription")

    # Discover STLs
    tooth_map = discover_stl_files(stl_dir) if stl_dir else {}
    tooth_numbers = sorted(t for t in tooth_map if t != 0)

    if prescription:
        # AI staging — delegated to the WhiteSmile main system (single AI brain)
        main_cfg = load_main_config()
        main_server_url = data.get("main_server_url") or main_cfg.get("main_server_url", DEFAULT_MAIN_SERVER)
        plan = generate_staging_plan(
            prescription=prescription,
            tooth_numbers=tooth_numbers or data.get("tooth_numbers", []),
            num_stages=num_stages,
            main_server_url=main_server_url,
            prefer_ai=data.get("use_ai", True),
        )
    else:
        plan = TreatmentPlan(
            tooth_numbers=tooth_numbers,
            num_stages=num_stages,
            stl_dir=stl_dir,
        )

    # Fill missing fields
    case_name = data.get("case_name", f"case_{len(tooth_numbers)}t")
    plan.case_name = case_name
    plan.stl_dir = stl_dir or plan.stl_dir
    # Rendered stages go into the dedicated shared storage folder:
    # <storage>/<case>/stages/stage_XXX/  (never inside the ortho workspace)
    plan.output_dir = os.path.join(state.storage_dir, case_name, "stages")
    plan.shell_thickness_mm = data.get("shell_thickness", plan.shell_thickness_mm)
    plan.undercut_block_angle = data.get("undercut_angle", plan.undercut_block_angle)
    plan.attachments_enabled = data.get("attachments_enabled", True)

    # Save
    path = os.path.join(state.plans_dir, f"{case_name}.json")
    save_plan(plan, path)
    state.current_plan = path

    logger.info(f"Created plan: {path} ({len(tooth_numbers)} teeth, {num_stages} stages)")
    return {"plan_path": path, "tooth_numbers": plan.tooth_numbers, "num_stages": num_stages}


@app.get("/api/plans/{name}")
async def get_plan(name: str):
    path = os.path.join(state.plans_dir, f"{name}.json")
    if not os.path.isfile(path):
        raise HTTPException(404, f"Plan not found: {name}")
    plan = load_plan(path)
    return {
        "name": name,
        "path": path,
        "plan": json.loads(plan_to_json(plan)),
    }


@app.put("/api/plans/{name}")
async def update_plan(name: str, data: dict):
    path = os.path.join(state.plans_dir, f"{name}.json")
    if not os.path.isfile(path):
        raise HTTPException(404, f"Plan not found: {name}")
    plan = load_plan(path)
    # Update movements from request
    if "movements" in data:
        for tn_str, m in data["movements"].items():
            tn = int(tn_str)
            plan.movements[tn] = ToothMove(tooth_number=tn, **m)
    if "num_stages" in data:
        plan.num_stages = int(data["num_stages"])
    save_plan(plan, path)
    logger.info(f"Updated plan: {path}")
    return {"status": "ok", "path": path}


# ---------------------------------------------------------------------------
#  WhiteSmile main system settings (single AI brain)
# ---------------------------------------------------------------------------

@app.get("/api/settings/main")
async def get_main_settings():
    """Return the WhiteSmile main system config (server URL + AI availability)."""
    cfg = load_main_config()
    server_url = cfg.get("main_server_url", DEFAULT_MAIN_SERVER)
    # Probe the main system for AI availability (non-fatal, off the event loop)
    ai_available = await asyncio.to_thread(_probe_main_ai, server_url)
    return {
        "main_server_url": server_url,
        "ai_available": ai_available,
        "default_main_server": DEFAULT_MAIN_SERVER,
    }


@app.post("/api/settings/main")
async def set_main_settings(data: dict):
    """Save the WhiteSmile main system server URL."""
    server_url = data.get("main_server_url", DEFAULT_MAIN_SERVER)
    cfg = save_main_config(server_url)
    logger.info(f"Main system settings saved: {cfg['main_server_url']}")
    return {
        "status": "ok",
        "main_server_url": cfg["main_server_url"],
    }


# ---------------------------------------------------------------------------
#  AI Design Optimization Integration (Medical-Grade)
# ---------------------------------------------------------------------------

async def _call_main_ai_optimization(current_parameters: dict, context: dict, 
                                      main_server_url: str, is_precision: bool = True) -> dict:
    """Call the WhiteSmile main system AI for design optimization."""
    import urllib.request
    url = main_server_url.rstrip("/") + "/api/design-optimization"
    body = json.dumps({
        "currentParameters": current_parameters,
        "context": context,
        "isPrecision": is_precision
    }).encode()
    headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
        return data
    except Exception as e:
        logger.error(f"[AI Optimization] Main system call failed: {e}")
        return None


async def _call_main_ai_quality_audit(parameters: dict, main_server_url: str) -> dict:
    """Call the WhiteSmile main system AI for quality audit."""
    import urllib.request
    url = main_server_url.rstrip("/") + "/api/quality-audit"
    body = json.dumps({"parameters": parameters}).encode()
    headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        return data
    except Exception as e:
        logger.error(f"[Quality Audit] Main system call failed: {e}")
        return None


@app.post("/api/plans/{name}/optimize-design")
async def optimize_design(name: str, data: dict = {}):
    """Run AI-assisted design optimization via the WhiteSmile main system.
    
    This performs a Chain-of-Thought analysis to optimize:
    - Trim line type and position
    - Shell thickness
    - Material selection
    - Attachment placement
    """
    path = os.path.join(state.plans_dir, f"{name}.json")
    if not os.path.isfile(path):
        raise HTTPException(404, f"Plan not found: {name}")
    plan = load_plan(path)
    
    # Load main system config
    cfg = load_main_config()
    main_server_url = cfg.get("main_server_url", DEFAULT_MAIN_SERVER)
    
    # Build current parameters from plan
    current_parameters = {
        "appliance": "Essix",
        "arch": "Both" if any(t >= 30 for t in plan.tooth_numbers) else "Upper",
        "trimLineType": data.get("trim_line_type", "scalloped"),
        "trimScallopOffset": data.get("trim_scallop_offset", 0.75),
        "shellThickness": plan.shell_thickness_mm,
        "selectedMaterial": data.get("material", "PETG 1.0mm Thermoforming Sheet"),
    }
    
    # Build context with clinical data
    context = {
        "tooth_numbers": plan.tooth_numbers,
        "num_stages": plan.num_stages,
        "movements": {str(tn): {
            "tx": m.tx, "ty": m.ty, "tz": m.tz,
            "rx": m.rx, "ry": m.ry, "rz": m.rz,
            "attachment_type": m.attachment_type
        } for tn, m in plan.movements.items()},
        "undercut_angle": plan.undercut_block_angle,
        "attachments_enabled": plan.attachments_enabled,
        "stl_dir": plan.stl_dir,
        "case_name": plan.case_name,
    }
    
    is_precision = data.get("precision_mode", True)
    
    logger.info(f"[AI Optimization] Starting design optimization for {name} (precision={is_precision})")
    
    result = await _call_main_ai_optimization(current_parameters, context, main_server_url, is_precision)
    
    if not result or "optimizedParameters" not in result:
        raise HTTPException(500, "AI optimization failed to return valid parameters")
    
    optimized = result["optimizedParameters"]
    reasoning = result.get("reasoning", "")
    validation = result.get("anatomicalValidation", "")
    
    # Apply optimized parameters to plan
    plan.shell_thickness_mm = optimized.get("shellThickness", plan.shell_thickness_mm)
    plan.undercut_block_angle = data.get("undercut_angle", plan.undercut_block_angle)
    
    # Store optimization metadata
    plan.description = f"AI Optimized: {reasoning[:200]}..."
    
    save_plan(plan, path)
    
    logger.info(f"[AI Optimization] Applied optimized parameters: thickness={plan.shell_thickness_mm}mm")
    
    return {
        "status": "ok",
        "optimized_parameters": optimized,
        "reasoning": reasoning,
        "anatomical_validation": validation,
        "applied": {
            "shell_thickness_mm": plan.shell_thickness_mm,
        }
    }


@app.post("/api/plans/{name}/quality-audit")
async def quality_audit(name: str):
    """Run AI quality audit on the current plan design."""
    path = os.path.join(state.plans_dir, f"{name}.json")
    if not os.path.isfile(path):
        raise HTTPException(404, f"Plan not found: {name}")
    plan = load_plan(path)
    
    cfg = load_main_config()
    main_server_url = cfg.get("main_server_url", DEFAULT_MAIN_SERVER)
    
    parameters = {
        "appliance": "Essix",
        "arch": "Both" if any(t >= 30 for t in plan.tooth_numbers) else "Upper",
        "trimLineType": "scalloped",
        "trimScallopOffset": 0.75,
        "shellThickness": plan.shell_thickness_mm,
        "selectedMaterial": "PETG 1.0mm Thermoforming Sheet",
        "tooth_numbers": plan.tooth_numbers,
        "num_stages": plan.num_stages,
        "movements": {str(tn): {
            "tx": m.tx, "ty": m.ty, "tz": m.tz,
            "rx": m.rx, "ry": m.ry, "rz": m.rz,
        } for tn, m in plan.movements.items()},
    }
    
    logger.info(f"[Quality Audit] Running safety audit for {name}")
    
    result = await _call_main_ai_quality_audit(parameters, main_server_url)
    
    if not result:
        raise HTTPException(500, "Quality audit failed")
    
    return {
        "status": "ok",
        "safe": result.get("safe", False),
        "flaws": result.get("flaws", []),
        "recommendations": result.get("recommendations", []),
    }


@app.post("/api/plans/{name}/render-optimized")
async def render_optimized_pipeline(name: str, data: dict = {}):
    """Run the complete AI-optimized rendering pipeline:
    1. AI design optimization
    2. Apply optimized parameters
    3. Run Blender batch render with medical-grade quality settings
    4. Post-render quality audit
    """
    path = os.path.join(state.plans_dir, f"{name}.json")
    if not os.path.isfile(path):
        raise HTTPException(404, f"Plan not found: {name}")
    plan = load_plan(path)
    
    if state.pipeline_running:
        raise HTTPException(400, "Pipeline already running")
    
    # Step 1: AI Design Optimization
    logger.info(f"[Optimized Pipeline] Step 1/4: AI Design Optimization for {name}")
    optimize_result = await optimize_design(name, data)
    
    # Reload plan with optimized parameters
    plan = load_plan(path)
    
    # Step 2: Prepare batch config with medical-grade quality settings
    tooth_map = discover_stl_files(plan.stl_dir)
    gingiva_path = tooth_map.get(0, "")
    
    stages_cfg = []
    for stage in plan.stages:
        positions = {}
        for tn, m in stage.tooth_positions.items():
            positions[str(tn)] = {
                "tx": m.tx, "ty": m.ty, "tz": m.tz,
                "rx": m.rx, "ry": m.ry, "rz": m.rz,
            }
        stages_cfg.append({"stage_index": stage.stage_index, "positions": positions})
    
    attachments = {}
    for tn, move in plan.movements.items():
        if move.attachment_type:
            attachments[str(tn)] = {
                "type": move.attachment_type,
                "size": list(move.attachment_size),
                "pos": [move.tx, move.ty, move.tz + 3],
            }
    
    # Medical-grade quality settings
    quality_settings = {
        "mesh_repair": True,
        "adaptive_thickness": True,
        "surface_smoothing": True,
        "qc_validation": True
    }
    
    batch_config = {
        "stl_dir": plan.stl_dir,
        "gingiva_stl": gingiva_path,
        "output_dir": plan.output_dir,
        "tooth_numbers": plan.tooth_numbers,
        "stages": stages_cfg,
        "shell_thickness": plan.shell_thickness_mm,
        "offset_mm": plan.offset_mm,
        "undercut_angle": plan.undercut_block_angle,
        "attachments_enabled": plan.attachments_enabled,
        "attachments": attachments,
        "quality_settings": quality_settings,
    }
    
    # Write batch config to temp file
    fd, cfg_path = tempfile.mkstemp(suffix="_batch.json", prefix="aligner_")
    with os.fdopen(fd, "w") as f:
        json.dump(batch_config, f, indent=2)
    
    # Step 3: Run Blender batch render
    logger.info(f"[Optimized Pipeline] Step 2/4: Starting Blender batch render")
    blender_exe = state.blender_exe
    script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "blender", "batch_aligner_cad.py")
    
    if not os.path.isfile(script_path):
        raise HTTPException(500, f"Batch script not found: {script_path}")
    
    state.pipeline_running = True
    cmd = [blender_exe, "--background", "--python", script_path, "--", cfg_path]
    logger.info(f"Starting optimized batch render: {' '.join(cmd)}")
    
    async def _run():
        global state
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            )
            async for line in proc.stdout:
                text = line.decode("utf-8", errors="replace").rstrip()
                logger.info(text)
            await proc.wait()
            logger.info(f"Optimized batch render completed (exit code {proc.returncode})")
            
            # Step 4: Post-render quality audit
            logger.info(f"[Optimized Pipeline] Step 3/4: Post-render quality audit")
            audit_result = await quality_audit(name)
            
            logger.info(f"[Optimized Pipeline] Step 4/4: Pipeline complete. Safe: {audit_result.get('safe', False)}")
            
        except Exception as e:
            logger.error(f"Optimized batch render error: {e}")
        finally:
            state.pipeline_running = False
            try:
                os.unlink(cfg_path)
            except OSError:
                pass
    
    asyncio.ensure_future(_run())
    return {
        "status": "started",
        "stages": len(stages_cfg),
        "optimization": optimize_result,
        "quality_settings": quality_settings,
    }


# ---------------------------------------------------------------------------
#  REST API — staging & pipeline
# ---------------------------------------------------------------------------

@app.post("/api/plans/{name}/staging")
async def generate_staging(name: str, data: dict = {}):
    """Compute stages for a plan (with optional easing)."""
    path = os.path.join(state.plans_dir, f"{name}.json")
    if not os.path.isfile(path):
        raise HTTPException(404, f"Plan not found: {name}")
    plan = load_plan(path)

    easing = data.get("easing", "linear")
    if easing != "linear":
        plan.stages = compute_staging_nonlinear(plan, easing=easing)
    else:
        plan.stages = compute_staging(plan)

    save_plan(plan, path)
    logger.info(f"Generated {len(plan.stages)} stages ({easing}) for {name}")
    return {"status": "ok", "num_stages": len(plan.stages), "easing": easing}


@app.get("/api/plans/{name}/stages/{stage_idx}/stls")
async def get_stage_stls(name: str, stage_idx: int):
    """List STL files for a given stage (for 3D viewport)."""
    path = os.path.join(state.plans_dir, f"{name}.json")
    if not os.path.isfile(path):
        raise HTTPException(404)
    plan = load_plan(path)
    stage_dir = os.path.join(plan.output_dir, f"stage_{stage_idx:03d}")
    if not os.path.isdir(stage_dir):
        raise HTTPException(404, f"Stage {stage_idx} not rendered yet")

    files = []
    teeth_dir = os.path.join(stage_dir, "teeth")
    if os.path.isdir(teeth_dir):
        for f in sorted(os.listdir(teeth_dir)):
            if f.endswith(".stl"):
                files.append({
                    "name": f,
                    "path": _file_url(os.path.join(teeth_dir, f)),
                    "size": os.path.getsize(os.path.join(teeth_dir, f)),
                })
    aligner_path = os.path.join(stage_dir, "aligner.stl")
    if os.path.isfile(aligner_path):
        files.append({
            "name": "aligner.stl",
            "path": _file_url(aligner_path),
            "size": os.path.getsize(aligner_path),
        })
    return {"stage": stage_idx, "files": files}


@app.post("/api/plans/{name}/render")
async def render_pipeline(name: str):
    """Run the batch Blender renderer for all stages."""
    global state
    if state.pipeline_running:
        raise HTTPException(400, "Pipeline already running")

    path = os.path.join(state.plans_dir, f"{name}.json")
    if not os.path.isfile(path):
        raise HTTPException(404, f"Plan not found: {name}")
    plan = load_plan(path)

    if not plan.stages:
        plan.stages = compute_staging(plan)
        save_plan(plan, path)

    # Build batch config
    tooth_map = discover_stl_files(plan.stl_dir)
    gingiva_path = tooth_map.get(0, "")

    stages_cfg = []
    for stage in plan.stages:
        positions = {}
        for tn, m in stage.tooth_positions.items():
            positions[str(tn)] = {
                "tx": m.tx, "ty": m.ty, "tz": m.tz,
                "rx": m.rx, "ry": m.ry, "rz": m.rz,
            }
        stages_cfg.append({"stage_index": stage.stage_index, "positions": positions})

    attachments = {}
    for tn, move in plan.movements.items():
        if move.attachment_type:
            attachments[str(tn)] = {
                "type": move.attachment_type,
                "size": list(move.attachment_size),
                "pos": [move.tx, move.ty, move.tz + 3],
            }

    batch_config = {
        "stl_dir": plan.stl_dir,
        "gingiva_stl": gingiva_path,
        "output_dir": plan.output_dir,
        "tooth_numbers": plan.tooth_numbers,
        "stages": stages_cfg,
        "shell_thickness": plan.shell_thickness_mm,
        "offset_mm": plan.offset_mm,
        "undercut_angle": plan.undercut_block_angle,
        "attachments_enabled": plan.attachments_enabled,
        "attachments": attachments,
    }

    # Write batch config to temp file
    fd, cfg_path = tempfile.mkstemp(suffix="_batch.json", prefix="aligner_")
    with os.fdopen(fd, "w") as f:
        json.dump(batch_config, f, indent=2)

    # Run Blender asynchronously (in thread pool)
    blender_exe = state.blender_exe
    script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "blender", "batch_aligner_cad.py")

    if not os.path.isfile(script_path):
        raise HTTPException(500, f"Batch script not found: {script_path}")

    state.pipeline_running = True
    cmd = [blender_exe, "--background", "--python", script_path, "--", cfg_path]
    logger.info(f"Starting batch render: {' '.join(cmd)}")

    async def _run():
        global state
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            )
            async for line in proc.stdout:
                text = line.decode("utf-8", errors="replace").rstrip()
                logger.info(text)
            await proc.wait()
            logger.info(f"Batch render completed (exit code {proc.returncode})")
        except Exception as e:
            logger.error(f"Batch render error: {e}")
        finally:
            state.pipeline_running = False
            try:
                os.unlink(cfg_path)
            except OSError:
                pass

    asyncio.ensure_future(_run())
    return {"status": "started", "stages": len(stages_cfg)}


@app.get("/api/status")
async def get_status():
    """Return current server status."""
    return {
        "pipeline_running": state.pipeline_running,
        "current_plan": state.current_plan,
        "blender": state.blender_exe,
        "work_dir": state.work_dir,
        "storage_dir": state.storage_dir,
    }


# ---------------------------------------------------------------------------
#  Serve STL/artifact files
# ---------------------------------------------------------------------------

def _file_url(path: str) -> str:
    """Build a `/api/files/...` URL for a file that may live in the ortho
    workspace OR the shared storage folder. The URL carries a root marker
    so `serve_file` knows which base to resolve against:
      - `ws/...`  → inside state.work_dir
      - `st/...`  → inside the shared storage dir
    """
    norm = os.path.normpath(path)
    try:
        rel_ws = os.path.relpath(norm, os.path.normpath(state.work_dir))
        if not rel_ws.startswith(".."):
            return "/api/files/ws/" + rel_ws.replace(os.sep, "/")
    except ValueError:
        pass
    try:
        rel_st = os.path.relpath(norm, os.path.normpath(state.storage_dir))
        if not rel_st.startswith(".."):
            return "/api/files/st/" + rel_st.replace(os.sep, "/")
    except ValueError:
        pass
    # Fallback: basename relative to work dir (legacy)
    return "/api/files/ws/" + os.path.basename(norm)


@app.get("/api/files/{rest_of_path:path}")
async def serve_file(rest_of_path: str):
    parts = rest_of_path.split("/", 1)
    root_key = parts[0] if len(parts) > 1 else ""
    sub = parts[1] if len(parts) > 1 else rest_of_path
    if root_key == "ws":
        base = os.path.normpath(state.work_dir)
        full = os.path.normpath(os.path.join(base, sub))
        if not full.startswith(base):
            raise HTTPException(403)
    elif root_key == "st":
        base = os.path.normpath(state.storage_dir)
        full = os.path.normpath(os.path.join(base, sub))
        if not full.startswith(base):
            raise HTTPException(403)
    else:
        # Legacy: resolve relative to work_dir
        base = os.path.normpath(state.work_dir)
        full = os.path.normpath(os.path.join(base, rest_of_path))
        if not full.startswith(base):
            raise HTTPException(403)
    if not os.path.isfile(full):
        raise HTTPException(404)
    return FileResponse(full, media_type="application/sla")


# ===================================================================
#  Entry
# ===================================================================

def main():
    port = int(os.environ.get("PORT", "8765"))
    url = f"http://localhost:{port}"

    logger.info(f"Starting Aligner Pipeline Server on {url}")
    logger.info(f"Open {url} in your browser for the 3D staging UI")

    # When spawned by the WhiteSmile main system the UI is embedded at
    # localhost:3000/ortho — do not pop an extra browser tab.
    if os.environ.get("ALIGNER_NO_BROWSER") != "1":
        webbrowser.open(url, new=0, autoraise=False)

    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
