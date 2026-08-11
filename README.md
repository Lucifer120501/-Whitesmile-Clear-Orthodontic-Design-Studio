

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

Local development notes:

When running locally, ensure the frontend calls the real backend (no simulated fallbacks) by setting `VITE_API_BASE` to your backend URL. You can set it inline or use the provided npm script.

Windows (cmd):

```
set "VITE_API_BASE=http://localhost:3001" && npm run dev
```

Or run the included script:

```
npm run dev:local
```

If you prefer a runtime override in the browser console for testing:

```
window.__API_BASE__ = 'http://localhost:3001'
```

## WhiteSmile Clear — Unified Three-System Architecture

This workspace is the **main system** — the single AI brain and design studio. Two
satellite systems plug into it:

```
                    ┌─────────────────────────────────────────────┐
                    │  MAIN SYSTEM (this folder) — port 3000      │
                    │  · Design studio UI + Gemini AI (AI Manager)│
                    │  · POST /api/ai/staging-plan   (staging)    │
                    │  · POST /api/ai/cut-ratio       (agliner)   │
                    │  · GET/POST /api/system/config  (shared)    │
                    │  · Shared storage folder (/storage)         │
                    └──────────────┬──────────────────────────────┘
                                   │
          AI + config              │ storage folder (segmented STLs)
                                   ▼
┌──────────────────────┐   ┌──────────────────────────────────────────┐
│ AGLINER PIPELINE     │──►│  ORTHO — staging + Blender render         │
│ (ai cad/)            │   │  (ortho/) — port 8765                    │
│ · STL segmentation   │   │ · auto-discovers segmented STLs from      │
│ · delegates AI cut   │   │   the shared storage folder               │
│   height to main AI  │   │ · delegates staging plans to main AI      │
└──────────────────────┘   └──────────────────────────────────────────┘
```

- **AI Manager (main system)** is the *only* place API keys are stored. Both satellites
  call the main system's AI bridge endpoints and keep rule-based fallbacks if it's offline.
- **Shared storage folder** (default `<workspace>/storage`, configurable via
  `GET/POST /api/system/config` or the Storage tab): the agliner pipeline deposits
  segmented teeth here, and the ortho system reads them for staging/rendering.

### Start all three systems

```bash
# 1. Main system (AI + design studio)
npm run dev                                    # http://localhost:3000

# 2. Agliner segmentation pipeline (Electron UI)
cd "ai cad/aligner-ui" && npm run vite:dev     # terminal 1
cd "ai cad/aligner-ui" && npm run electron:dev # terminal 2

# 3. Ortho staging + render (FastAPI)
cd ortho/aligner_pipeline && python server.py  # http://localhost:8765
```
