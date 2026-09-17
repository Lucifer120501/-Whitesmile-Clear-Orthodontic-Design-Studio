# Clear Aligner CAD Pipeline

A Blender-based pipeline for generating clear aligner treatment stages from segmented tooth STL files.

## Overview

```
segmented STLs  ──►  Treatment Plan  ──►  Staging Engine  ──►  Blender CAD  ──►  Aligner STLs
(tooth_11.stl,       (JSON: per-tooth       (interpolate          (import, move,        (per-stage:
 gingiva.stl)         movement targets)       N stages)            block undercuts,       teeth/ +
                                                                    add attachments,       aligner.stl)
                                                                    solidify shell)
```

## WhiteSmile Unified System Integration

This pipeline is the **rendering/staging stage** of the WhiteSmile Clear system:

```
Main System (http://localhost:3000)  ← single AI brain (Gemini via AI Manager)
      │  POST /api/ai/staging-plan          (staging plans)
      │  GET  /api/system/config            (shared storage folder)
      ▼
Agliner Pipeline ── segmentation ──► shared storage folder ──► Ortho (this pipeline)
      (tooth_XX.stl + gingiva.stl + manifest.json)                (staging + Blender render)
```

- **No AI keys or provider SDKs live here anymore.** Staging plans are delegated to
  the WhiteSmile main system via `POST /api/ai/staging-plan`. A rule-based heuristic
  fallback keeps the lab running if the main system is unreachable.
- **Segmented STLs are auto-discovered** from the shared storage folder (deposited by
  the agliner pipeline). Open the **New Plan** modal and pick a case from the dropdown,
  or leave the STL dir empty and the server will find the latest case automatically.
- Configure the main system URL in the **AI Preset** tab (default `http://localhost:3000`).

## Directory Structure

```
aligner_pipeline/
├── run_pipeline.py           # CLI orchestrator (main entry point)
├── config/
│   └── treatment_plan.py     # Data models (TreatmentPlan, ToothMove, Stage)
├── plan/
│   ├── plan_io.py            # JSON/CSV I/O, STL discovery
│   └── staging.py            # Stage interpolation engine
├── blender/
│   ├── aligner_cad.py        # ** Blender-side script ** (runs inside Blender)
│   └── run_blender.py        # Subprocess wrapper for Blender
├── ui/
│   └── plan_editor.py        # Tkinter GUI for treatment plan editing
├── requirements.txt
└── README.md
```

## Quick Start

### 1. Discover teeth and create a plan

```bash
python run_pipeline.py plan --stls ../segmented_stls --output case_001 --stages 20
```

This creates `case_001/treatment_plan.json` with all detected teeth and zero movements.  
**Edit the JSON** to set per-tooth translation/rotation targets.

### 2. Launch the interactive plan editor

```bash
python run_pipeline.py plan-ui
```

### 3. Run the full pipeline

```bash
python run_pipeline.py all --plan case_001/treatment_plan.json
```

Or provide movement targets directly:

```bash
python run_pipeline.py all --stls ../segmented_stls --output case_001 ^
    --stages 20 --shell 0.75 --undercut 45 --movements movements.json
```

### 4. Test a single stage

```bash
python run_pipeline.py stage --plan case_001/treatment_plan.json --stage 0
```

## Treatment Plan JSON Structure

```json
{
  "patient_id": "P001",
  "case_name": "case_001",
  "tooth_numbers": [11, 12, 13, 14, 21, 22],
  "num_stages": 20,
  "shell_thickness_mm": 0.75,
  "offset_mm": 0.1,
  "undercut_block_angle": 45.0,
  "gingiva_margin_mm": 1.0,
  "attachments_enabled": true,
  "stl_dir": "../segmented_stls",
  "output_dir": "case_001",
  "movements": {
    "11": { "tx": 0.0, "ty": 0.0, "tz": 0.0, "rx": 0.0, "ry": 0.0, "rz": 0.0 },
    "12": { "tx": 1.2, "ty": 0.0, "tz": 0.5, "rx": 2.0, "ry": 0.0, "rz": 1.0, "attachment_type": "ellipsoid" }
  }
}
```

## Pipeline Features

| Feature | Description |
|---------|-------------|
| **Tooth staging** | Linear or eased (ease-out, ease-in-out) interpolation of movements across N stages |
| **Undercut blocking** | Face-normal based removal of undercut surfaces above configurable angle |
| **Attachments** | Ellipsoid or beveled-box attachment geometry added to specified teeth |
| **Aligner shell** | Solidify modifier to create aligner shell with configurable thickness and offset gap |
| **Per-stage export** | Individual tooth STLs + combined aligner STL per stage |
| **Plan editor UI** | Tkinter GUI for interactive treatment plan creation |

## Requirements

- **Blender 5.2+** (or 4.x) installed at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`
- Python 3.10+ with `numpy` (for host orchestration)
- Segmented STL files named `tooth_XX.stl` and `gingiva.stl`

## Coordinate System

- +X = patient right
- +Y = posterior (distal)
- +Z = superior (occlusal)
- Rotations are XYZ Euler degrees about the tooth's centre-of-mass
- Translations are in millimetres

## Output Structure

```
case_001/
├── treatment_plan.json
├── stage_000/
│   ├── teeth/
│   │   ├── tooth_11.stl
│   │   ├── tooth_12.stl
│   │   └── gingiva.stl
│   └── aligner.stl
├── stage_001/
│   └── ...
└── stage_019/
    └── ...
```
