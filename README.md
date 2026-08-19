
# Whitesmile Clear Orthodontic Design Studio

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/1ad4c4b9-f62f-405c-be3d-f3d934a9303a

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

---

## Multi-User Beta Edition (Login, Companies & Feature Packs)

The system is now a **multi-user server** running 24/7 on the admin's PC.

### First run
1. Start the server: `npm run dev` (or the production build)
2. Open `http://localhost:3000` — you'll see **Create Administrator Account**
3. Create your admin account (this is the only time this screen appears)

### Users connect over the network
- Open the **Admin Panel → Connection** tab to see the LAN URLs to share
  (e.g. `http://192.168.1.50:3000`)
- Users open that URL in their own browser and sign in with the account you
  created for them. No install needed on their machine.

### Admin Panel (admin account only)
- **Companies & Packs** — create companies (clinics), toggle feature packs per
  company (Analysis / Blender / Ortho / Agliner), and toggle **Company Data Sync**
  (ON = users in that company share cases, OFF = private records)
- **Users** — admins create/activate/deactivate/delete user accounts
- **Updates** — pull the latest version from git (auto rebuild + restart) or
  roll back the last update if a bug slips in
- **Connection** — LAN addresses to share with users

### Data isolation
- Users see only their own cases (plus company cases when sync is ON).
- Admins see everything — the collected cases feed the AI knowledge base.
- Admin-only features (folder sync, storage, API keys, AI manager, security
   scans) are hidden from users **and** blocked server-side.

### Data files (never commit these — already git-ignored)
- `server-data/` — users, companies, sessions, update log
- `uploads/history.json` — case history
