# WhiteSmile Aligner Segmentation Pipeline

The **segmentation stage** of the WhiteSmile Clear system. Takes full-arch dental scan
STLs (upper/lower) and splits them into individual tooth STLs (`tooth_11.stl` …
`tooth_48.stl` + `gingiva.stl`).

## WhiteSmile Unified System Integration

```
Main System (http://localhost:3000)  ← single AI brain (Gemini via AI Manager)
      │  POST /api/ai/cut-ratio              (AI-optimized segmentation cut height)
      │  GET  /api/system/config             (shared storage folder)
      ▼
Agliner Pipeline (this folder) ── segmentation ──► shared storage folder ──► Ortho
      (tooth_XX.stl + gingiva.stl + manifest.json)                    (staging + Blender render)
```

- **No AI keys or provider SDKs live here anymore.** AI cut optimization is delegated
  to the WhiteSmile main system via `POST /api/ai/cut-ratio`. If the main system is
  unreachable the pipeline falls back to the clinically-safe default cut ratio (0.3).
- **Storage export:** pass `--storage <folder>` and the segmented STLs (plus a
  `manifest.json`) are copied into `<storage>/<case>/segmented_stls/` so the ortho
  system can pick them up for staging & rendering.

## Usage (CLI)

```bash
# Segment a single arch STL into teeth + gingiva (uses main system AI)
python aligner_pipeline/fast_pipeline.py scan_upper.stl ./out/ --upper \
    --main-server http://localhost:3000 \
    --storage "C:\path\to\shared\storage"

# Segment a whole patient folder (auto-detects upper/lower scans)
python aligner_pipeline/fast_pipeline.py ./patient_folder/ ./out/ \
    --main-server http://localhost:3000 \
    --storage "C:\path\to\shared\storage"
```

## Usage (Electron UI)

```bash
cd aligner-ui
npm install
npm run vite:dev        # terminal 1 — Vite dev server
npm run electron:dev    # terminal 2 — Electron app
```

In the app:

1. **Auto tab** — pick the patient STL/folder, click **Segment Teeth**.
2. **Setup tab** — set the **Main System URL** (default `http://localhost:3000`)
   and the **Shared Storage Folder** (same folder the ortho system reads).
3. The header shows the live **WhiteSmile AI** connection status and the storage
   folder. After segmentation the STLs are copied into the storage folder
   automatically.

## Files

| File | Purpose |
|------|---------|
| `fast_pipeline.py` | Fast morphological segmentation (no Blender, ~5s/arch) |
| `segment_teeth_trimesh.py` | Height-cut + connected-component segmentation |
| `diagnose.py` | Mesh diagnostics / visualization helpers |
| `aligner-ui/` | Electron + React UI for the pipeline |

## Requirements

- Python 3.10+ with `numpy`, `scipy`, `trimesh[all]`
- WhiteSmile main system running on `http://localhost:3000` (for AI features)
