const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Aligner Pipeline',
    backgroundColor: '#030712',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC Handlers ──────────────────────────────────────────

// Select directory dialog
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Select file dialog
ipcMain.handle('select-file', async (_event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Read JSON file
ipcMain.handle('read-json', async (_event, filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return { error: err.message };
  }
});

// Read STL file as ArrayBuffer (base64 encoded for IPC)
ipcMain.handle('read-stl-file', async (_event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { error: 'File not found' };
    const buffer = fs.readFileSync(filePath);
    return { data: buffer.buffer ? buffer.buffer : buffer, path: filePath };
  } catch (err) {
    return { error: err.message };
  }
});

// Save dialog (for video export, etc.)
ipcMain.handle('save-dialog', async (_event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options?.title || 'Save File',
    defaultPath: options?.defaultPath || 'treatment_animation.webm',
    filters: options?.filters || [{ name: 'WebM Video', extensions: ['webm'] }],
  });
  return result.canceled ? null : result.filePath;
});

// Save file data
ipcMain.handle('save-file', async (_event, filePath, bytes) => {
  try {
    const buffer = Buffer.from(bytes);
    fs.writeFileSync(filePath, buffer);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// Transfer STL via a shared buffer approach — send raw buffer
ipcMain.handle('read-stl-buffer', async (_event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { error: 'File not found' };
    const buffer = fs.readFileSync(filePath);
    // Return the raw ArrayBuffer — Electron/Chromium can transfer this efficiently
    return {
      bytes: buffer.buffer ? buffer.buffer : buffer,
      byteLength: buffer.byteLength,
      path: filePath,
    };
  } catch (err) {
    return { error: err.message };
  }
});

// List STL files in a directory
ipcMain.handle('list-stl-files', async (_event, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) return [];
    const results = [];

    function scanDir(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.stl')) {
          results.push({ name: entry.name, path: fullPath });
        }
      }
    }

    scanDir(dirPath);
    return results;
  } catch (err) {
    return [];
  }
});

// Check if a directory/file exists
ipcMain.handle('path-exists', async (_event, filePath) => {
  return fs.existsSync(filePath);
});

// ── Pipeline Execution ────────────────────────────────────

// The agliner UI no longer holds AI API keys or talks to providers directly.
// All AI is delegated to the WhiteSmile main system (single AI brain) via
// POST /api/ai/staging-plan. If the main server is unreachable the UI shows
// a clear message and the pipeline still runs with rule-based defaults.

const DEFAULT_MAIN_SERVER = 'http://localhost:3000';

function getMainServerUrl() {
  return process.env.WHITESMILE_SERVER_URL || DEFAULT_MAIN_SERVER;
}

// Generate a staging plan through the WhiteSmile main system AI bridge
ipcMain.handle('call-main-ai', async (event, params = {}) => {
  const win = mainWindow;
  const sendLog = (text, type = 'stdout') => {
    if (win && !win.isDestroyed()) win.webContents.send('pipeline-log', { text, type, timestamp: Date.now() });
  };

  const { prescription = '', stlDir = '', mainServerUrl = getMainServerUrl(), numStages = 33 } = params;
  const base = String(mainServerUrl || getMainServerUrl()).replace(/\/+$/, '');

  sendLog(`[AI] Contacting WhiteSmile main system AI at ${base}...`, 'info');
  try {
    const resp = await fetch(`${base}/api/ai/staging-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prescription,
        num_stages: numStages,
        tooth_numbers: [],
        case_name: stlDir ? stlDir.split(/[\\/]/).pop() : 'agliner-case',
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`WhiteSmile AI error ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    sendLog(`[AI] Staging plan received from WhiteSmile AI (${data.movements ? Object.keys(data.movements).length : 0} teeth)`, 'success');
    return { success: true, data };
  } catch (err) {
    sendLog(`[AI] WhiteSmile AI unreachable — falling back to rule-based staging. ${err.message}`, 'error');
    return { error: err.message };
  }
});

// Check main system AI availability
ipcMain.handle('check-main-ai', async (_event, mainServerUrl = getMainServerUrl()) => {
  const base = String(mainServerUrl || getMainServerUrl()).replace(/\/+$/, '');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(`${base}/api/system/config`, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return { available: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return {
      available: !!data.aiAvailable,
      aiAvailable: !!data.aiAvailable,
      storageFolder: data.storageFolder || '',
      mainServerUrl: base,
      error: data.aiAvailable ? undefined : 'Main system online, but no AI API key is set. Add one in the AI Manager tab.',
    };
  } catch (err) {
    return { available: false, error: err.message || 'Main system unreachable' };
  }
});

ipcMain.handle('run-pipeline', async (event, config) => {
  const {
    pythonPath = 'python',
    pipelineScript = '',
    stlDir = '',
    outputDir = '',
    stages = 5,
    expansion = 1.02,
    shell = 0,
    undercut = 0,
    blenderPath = '',
  } = config;

  const win = mainWindow;

  // Helper to send log to renderer
  const sendLog = (text, type = 'stdout') => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pipeline-log', { text, type, timestamp: Date.now() });
    }
  };

  // ── Resolve paths ─────────────────────────────────────
  // The app is inside aligner-ui/electron/main.cjs
  // Workspace root = two levels up from here
  const appDir = path.dirname(__dirname); // aligner-ui/
  const workspaceRoot = path.resolve(appDir, '..'); // ai cad/

  // Resolve pipelineScript relative to workspace root
  const resolvedScript = path.resolve(workspaceRoot, pipelineScript);

  // Resolve pythonPath relative to workspace root
  const resolvedPython = path.resolve(workspaceRoot, pythonPath);

  // Resolve blenderPath
  const resolvedBlender = blenderPath ? path.resolve(blenderPath) : '';

  sendLog('=== Aligner Pipeline Started ===', 'system');
  sendLog(`STL Dir: ${stlDir}`, 'info');
  sendLog(`Output:  ${outputDir}`, 'info');
  sendLog(`Stages:  ${stages}`, 'info');
  sendLog(`Shell:   ${shell > 0 ? `${shell}mm` : 'OFF'}`, 'info');
  sendLog(`Blender: ${resolvedBlender || 'auto-detect'}`, 'info');
  sendLog(`Python:  ${resolvedPython}`, 'info');
  sendLog(`Script:  ${resolvedScript}`, 'info');
  sendLog('', 'system');

  // Validate inputs
  if (!fs.existsSync(resolvedScript)) {
    sendLog(`[ERROR] Pipeline script not found: ${resolvedScript}`, 'error');
    sendLog('Make sure the .venv and aligner_pipeline directories exist at the workspace root.', 'error');
    return { code: -1, output: 'Script not found' };
  }
  if (!fs.existsSync(resolvedPython)) {
    sendLog(`[ERROR] Python not found: ${resolvedPython}`, 'error');
    sendLog('Run: python -m venv .venv && .venv\\Scripts\\pip install numpy trimesh scipy', 'info');
    return { code: -1, output: 'Python not found' };
  }

  // Build the command — no manual quotes needed, spawn handles spaces
  const args = [
    resolvedScript,
    'all',
    '--stls', stlDir,
    '--output', outputDir,
    '--stages', String(stages),
    '--expansion', String(expansion),
    '--shell', String(shell),
    '--undercut', String(undercut),
  ];
  if (resolvedBlender) {
    args.push('--blender', resolvedBlender);
  }

  sendLog(`$ "${resolvedPython}" ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`, 'cmd');

  return new Promise((resolve) => {
    const proc = spawn(resolvedPython, args, {
      cwd: workspaceRoot,
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let fullOutput = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      fullOutput += text;
      const lines = text.split('\n').filter(l => l.trim());
      for (const line of lines) {
        sendLog(line, 'stdout');
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      fullOutput += text;
      const lines = text.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const type = line.toLowerCase().includes('error') || line.toLowerCase().includes('traceback')
          ? 'error' : 'stderr';
        sendLog(line, type);
      }
    });

    proc.on('close', (code) => {
      sendLog('', 'system');
      sendLog(`Pipeline exited with code ${code}`, code === 0 ? 'success' : 'error');
      if (win && !win.isDestroyed()) {
        win.webContents.send('pipeline-complete', { code, output: fullOutput });
      }
      resolve({ code, output: fullOutput });
    });

    proc.on('error', (err) => {
      sendLog(`Failed to start pipeline: ${err.message}`, 'error');
      resolve({ code: -1, output: err.message });
    });
  });
});

// ── Auto Pipeline (end-to-end from patient folder) ─────
ipcMain.handle('run-auto-pipeline', async (event, config) => {
  const {
    pythonPath = 'python',
    patientDir = '',
    stages = 33,
    shell = 0.75,
    undercut = 45,
    blenderPath = '',
  } = config;

  const win = mainWindow;

  const sendLog = (text, type = 'stdout') => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pipeline-log', { text, type, timestamp: Date.now() });
    }
  };

  const appDir = path.dirname(__dirname);
  const workspaceRoot = path.resolve(appDir, '..');
  const autoScript = path.resolve(workspaceRoot, 'aligner_pipeline', 'auto_pipeline.py');
  const resolvedPython = path.resolve(workspaceRoot, pythonPath);
  const resolvedBlender = blenderPath ? path.resolve(blenderPath) : '';

  sendLog('=== Auto Pipeline Started (end-to-end) ===', 'system');
  sendLog(`Patient: ${patientDir}`, 'info');
  sendLog(`Stages:  ${stages}`, 'info');
  sendLog(`Shell:   ${shell > 0 ? `${shell}mm` : 'OFF'}`, 'info');
  sendLog(`Blender: ${resolvedBlender || 'auto-detect'}`, 'info');
  sendLog(`Python:  ${resolvedPython}`, 'info');
  sendLog('', 'system');

  if (!fs.existsSync(autoScript)) {
    sendLog(`[ERROR] Auto-pipeline script not found: ${autoScript}`, 'error');
    return { code: -1, output: 'Script not found' };
  }
  if (!fs.existsSync(resolvedPython)) {
    sendLog(`[ERROR] Python not found: ${resolvedPython}`, 'error');
    return { code: -1, output: 'Python not found' };
  }
  if (!fs.existsSync(patientDir)) {
    sendLog(`[ERROR] Patient directory not found: ${patientDir}`, 'error');
    return { code: -1, output: 'Patient directory not found' };
  }

  const args = [
    autoScript,
    patientDir,
    '--stages', String(stages),
    '--shell', String(shell),
    '--undercut', String(undercut),
  ];
  if (resolvedBlender) {
    args.push('--blender', resolvedBlender);
  }

  sendLog(`$ "${resolvedPython}" ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`, 'cmd');

  return new Promise((resolve) => {
    const proc = spawn(resolvedPython, args, { cwd: workspaceRoot, shell: false, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let fullOutput = '';
    let exportPathDetected = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      fullOutput += text;
      for (const line of text.split('\n').filter(l => l.trim())) {
        // Detect [EXPORT_PATH] marker from Python script
        const exportMatch = line.match(/\[EXPORT_PATH\]\s+(.+)/);
        if (exportMatch) {
          exportPathDetected = exportMatch[1].trim();
          if (win && !win.isDestroyed()) {
            win.webContents.send('pipeline-export-path', exportPathDetected);
          }
        }
        sendLog(line, 'stdout');
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      fullOutput += text;
      for (const line of text.split('\n').filter(l => l.trim())) {
        const type = line.toLowerCase().includes('error') || line.toLowerCase().includes('traceback')
          ? 'error' : 'stderr';
        sendLog(line, type);
      }
    });

    proc.on('close', (code) => {
      sendLog('', 'system');
      sendLog(`Auto pipeline exited with code ${code}`, code === 0 ? 'success' : 'error');
      if (win && !win.isDestroyed()) {
        win.webContents.send('pipeline-complete', { code, output: fullOutput });
      }
      resolve({ code, output: fullOutput });
    });

    proc.on('error', (err) => {
      sendLog(`Failed to start: ${err.message}`, 'error');
      resolve({ code: -1, output: err.message });
    });
  });
});

// ── Fast Tooth Segmentation (no Blender, no staging) ──
ipcMain.handle('run-fast-pipeline', async (event, config) => {
  const {
    pythonPath = '.venv\\Scripts\\python.exe',
    inputPath = '',
    outputPath = '',
    archType = 'upper',
    cutRatio = 0.3,
    mainServerUrl = getMainServerUrl(),
    prescription = '',
    storagePath = '',
  } = config;

  const win = mainWindow;

  const sendLog = (text, type = 'stdout') => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pipeline-log', { text, type, timestamp: Date.now() });
    }
  };

  const appDir = path.dirname(__dirname);
  const workspaceRoot = path.resolve(appDir, '..');
  const scriptPath = path.resolve(workspaceRoot, 'aligner_pipeline', 'fast_pipeline.py');
  const resolvedPython = path.resolve(workspaceRoot, pythonPath);

  sendLog('=== Tooth Segmentation Started ===', 'system');
  sendLog(`Input:  ${inputPath}`, 'info');
  sendLog(`Arch:   ${archType}`, 'info');
  sendLog(`Cut:    ${cutRatio}`, 'info');
  if (mainServerUrl) sendLog(`AI:     WhiteSmile main system @ ${mainServerUrl}`, 'info');
  if (storagePath) sendLog(`Storage: ${storagePath}`, 'info');
  sendLog('', 'system');

  if (!fs.existsSync(scriptPath)) {
    sendLog(`[ERROR] Script not found: ${scriptPath}`, 'error');
    return { code: -1, output: 'Script not found' };
  }
  if (!fs.existsSync(resolvedPython)) {
    sendLog(`[ERROR] Python not found: ${resolvedPython}`, 'error');
    return { code: -1, output: 'Python not found' };
  }
  if (!fs.existsSync(inputPath)) {
    sendLog(`[ERROR] Input not found: ${inputPath}`, 'error');
    return { code: -1, output: 'Input not found' };
  }

  const args = [scriptPath, inputPath];
  if (outputPath) args.push(outputPath);
  if (archType === 'upper') args.push('--upper');
  else if (archType === 'lower') args.push('--lower');
  args.push('--cut', String(cutRatio));
  if (mainServerUrl) args.push('--main-server', mainServerUrl);
  if (prescription) args.push('--prescription', prescription);
  if (storagePath) args.push('--storage', storagePath);

  sendLog(`$ "${resolvedPython}" ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`, 'cmd');

  return new Promise((resolve) => {
    const proc = spawn(resolvedPython, args, {
      cwd: workspaceRoot,
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let fullOutput = '';
    let exportPathDetected = '';
    let completeFlag = null;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      fullOutput += text;
      for (const line of text.split('\n').filter(l => l.trim())) {
        const exportMatch = line.match(/\[EXPORT_PATH\]\s+(.+)/);
        if (exportMatch) {
          exportPathDetected = exportMatch[1].trim();
          if (win && !win.isDestroyed()) {
            win.webContents.send('pipeline-export-path', exportPathDetected);
          }
        }
        const completeMatch = line.match(/\[COMPLETE\]\s+(yes|no)/i);
        if (completeMatch) {
          completeFlag = completeMatch[1].toLowerCase() === 'yes';
        }
        sendLog(line, 'stdout');
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      fullOutput += text;
      for (const line of text.split('\n').filter(l => l.trim())) {
        const type = line.toLowerCase().includes('error') || line.toLowerCase().includes('traceback')
          ? 'error' : 'stderr';
        sendLog(line, type);
      }
    });

    proc.on('close', (code) => {
      sendLog('', 'system');
      sendLog(`Segmentation exited with code ${code}`, code === 0 ? 'success' : 'error');
      if (win && !win.isDestroyed()) {
        win.webContents.send('pipeline-complete', {
          code,
          output: fullOutput,
          complete: completeFlag !== null ? completeFlag : code === 0,
        });
      }
      resolve({ code, output: fullOutput });
    });

    proc.on('error', (err) => {
      sendLog(`Failed to start: ${err.message}`, 'error');
      resolve({ code: -1, output: err.message });
    });
  });
});
