// ── Sync Service: Frontend API Layer ──────────────────────────────────────
// All communication with backend sync endpoints goes through this service.

export interface SyncFileEntry {
  name: string;
  relativePath: string;
  extension: string;
  size: number;
  sizeFormatted: string;
  modifiedAt: string;
  isDirectory: boolean;
  selected: boolean;
  status: 'not-synced' | 'queued' | 'reading' | 'writing' | 'synced' | 'error' | 'skipped';
}

export interface SyncStats {
  files: number;
  folders: number;
  totalSize: string;
  totalSizeBytes: number;
  synced: number;
  pending: number;
  errors: number;
}

export interface SyncProgress {
  percent: number;
  currentFile: string;
  filesCompleted: number;
  totalFiles: number;
  stage: string;
}

export interface ContainerState {
  id: string;
  folderPath: string;
  files: SyncFileEntry[];
  fileTree: FolderNode[];
  syncing: boolean;
  scanning: boolean;
  complete: boolean;
  error: string | null;
  stats: SyncStats;
  progress: SyncProgress;
  pendingUnsync: boolean;
  monitoring: boolean;
  changesDetected: boolean;
}

export interface FolderNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: FolderNode[];
  files: SyncFileEntry[];
  expanded: boolean;
}

export interface ScanResponse {
  success: boolean;
  message: string;
  folderPath: string;
  files: Array<{
    name: string;
    relativePath: string;
    extension: string;
    size: number;
    sizeFormatted: string;
    modifiedAt: string;
    isDirectory: boolean;
  }>;
  stats: SyncStats;
}

export interface SyncResponse {
  success: boolean;
  message: string;
  syncedFiles: number;
  errors: string[];
}

export function createEmptyState(id: string): ContainerState {
  return {
    id,
    folderPath: '',
    files: [],
    fileTree: [],
    syncing: false,
    scanning: false,
    complete: false,
    error: null,
    stats: { files: 0, folders: 0, totalSize: '0 Bytes', totalSizeBytes: 0, synced: 0, pending: 0, errors: 0 },
    progress: { percent: 0, currentFile: '', filesCompleted: 0, totalFiles: 0, stage: '' },
    pendingUnsync: false,
    monitoring: false,
    changesDetected: false,
  };
}

export function buildFileTree(files: SyncFileEntry[]): FolderNode[] {
  const root: FolderNode[] = [];
  const map = new Map<string, FolderNode>();

  // Collect all unique directory paths
  const dirs = new Set<string>();
  for (const file of files) {
    if (file.relativePath) {
      const parts = file.relativePath.replace(/\\/g, '/').split('/');
      let path = '';
      for (let i = 0; i < parts.length - 1; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        dirs.add(path);
      }
    }
  }

  // Create folder nodes
  for (const dir of dirs) {
    const parts = dir.split('/');
    const name = parts[parts.length - 1];
    const node: FolderNode = {
      name,
      path: dir,
      isDirectory: true,
      children: [],
      files: [],
      expanded: false,
    };
    map.set(dir, node);
  }

  // Build hierarchy
  for (const [path, node] of map) {
    const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
    if (parentPath && map.has(parentPath)) {
      map.get(parentPath)!.children.push(node);
    } else {
      root.push(node);
    }
  }

  // Assign files to folders
  for (const file of files) {
    // Determine the parent directory path from relativePath
    const normalized = file.relativePath ? file.relativePath.replace(/\\/g, '/') : '';
    const hasDir = normalized.includes('/');
    const dir = hasDir ? normalized.replace(/\/[^/]+$/, '') : '';
    if (dir && map.has(dir)) {
      map.get(dir)!.files.push(file);
    } else if (!dir) {
      // Root-level file (no directory component in relative path)
      // Also skip directory entries marked as isDirectory — they get their own FolderNode above
      if (file.isDirectory) continue;
      const rootNode: FolderNode = {
        name: file.name,
        path: file.relativePath,
        isDirectory: false,
        children: [],
        files: [file],
        expanded: false,
      };
      root.push(rootNode);
    }
  }

  return root;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      if (resp.ok) return resp;

      // If the response was not OK (404/502/etc) and we're in a browser,
      // attempt fallback localhost ports before returning the original response.
      if (typeof window !== 'undefined' && typeof url === 'string' && url.startsWith('/')) {
        const fallbackPorts = [3001, 3000];
        for (const p of fallbackPorts) {
          try {
            const alt = `${window.location.protocol}//${window.location.hostname}:${p}${url}`;
            const r2 = await fetch(alt, { ...options, signal: controller.signal });
            if (r2.ok) return r2;
          } catch {
            // try next
          }
        }
      }

      // Return the original non-OK response if fallbacks didn't succeed
      return resp;
    } catch (err) {
      // If running in a browser and the URL is relative, attempt known localhost ports
      if (typeof window !== 'undefined' && typeof url === 'string' && url.startsWith('/')) {
        const fallbackPorts = [3001, 3000];
        for (const p of fallbackPorts) {
          try {
            const alt = `${window.location.protocol}//${window.location.hostname}:${p}${url}`;
            const resp = await fetch(alt, { ...options, signal: controller.signal });
            return resp;
          } catch {
            // try next
          }
        }
      }
      throw err;
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function scanFolder(folderPath: string): Promise<ScanResponse> {
  const res = await fetchWithTimeout('/api/sync/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath: folderPath.trim() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to scan folder');
  return data;
}

export async function syncFiles(
  folderPath: string,
  selectedFiles: string[],
  syncMode: 'reference' | 'patient' | 'storage',
  storageTarget?: string,
  onProgress?: (progress: SyncProgress) => void
): Promise<SyncResponse> {
  // Initiate sync — files stay in-place, no copying
  const res = await fetchWithTimeout('/api/sync/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folderPath: folderPath.trim(),
      selectedFiles,
      syncMode,
      storageTarget,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to start sync');
  if (!data.syncId) return data;

  // Poll for progress (job completes quickly since no file copying)
  const syncId = data.syncId;
  return new Promise((resolve, reject) => {
    let pollCount = 0;
    const MAX_POLLS = 200; // 200 * 300ms = 60s max
    const poll = async () => {
      if (pollCount++ >= MAX_POLLS) {
        reject(new Error('Sync timed out after 60 seconds'));
        return;
      }
      try {
        const progressRes = await fetchWithTimeout(`/api/sync/progress/${syncId}`, {});
        const progressData = await progressRes.json();
        if (progressData.status === 'completed') {
          resolve(progressData.result || { success: true, message: 'Sync completed', syncedFiles: 0, errors: [] });
        } else if (progressData.status === 'error') {
          reject(new Error(progressData.error || 'Sync failed'));
        } else {
          if (onProgress && progressData.progress) {
            onProgress(progressData.progress);
          }
          setTimeout(poll, 300);
        }
      } catch (err) {
        reject(err);
      }
    };
    poll();
  });
}

export async function unsyncFolder(folderPath: string, containerId: string, allowWrite: boolean): Promise<{ success: boolean; queued: boolean }> {
  const res = await fetchWithTimeout('/api/sync/unsync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath: folderPath.trim(), containerId, allowWrite }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to unsync');
  return data;
}

export interface ImportTerminalResult {
  success: boolean;
  command: string;
  output: string;
  error?: string;
  stderr?: string;
  filesProcessed?: number;
}

export async function importToTerminal(
  folderPath: string,
  selectedFiles: string[],
  command?: string
): Promise<ImportTerminalResult> {
  const res = await fetchWithTimeout('/api/sync/import-terminal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folderPath: folderPath.trim(),
      selectedFiles,
      command: command?.trim() || undefined,
    }),
  });
  // Try to parse JSON; if the body is empty, get the status text for debugging
  let data: any;
  try {
    data = await res.json();
  } catch {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Server returned ${res.status} ${res.statusText} with empty/invalid body` +
      (text ? `: ${text.slice(0, 200)}` : '')
    );
  }
  if (!res.ok) throw new Error(data.error || 'Failed to execute terminal command');
  return data;
}

export async function checkForChanges(folderPath: string): Promise<{ changed: boolean; newFiles: string[]; deletedFiles: string[]; modifiedFiles: string[] }> {
  const res = await fetchWithTimeout('/api/sync/check-changes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath: folderPath.trim() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to check changes');
  return data;
}

export async function readFileFromSource(folderPath: string, relativePath: string): Promise<{
  success: boolean;
  name: string;
  relativePath: string;
  extension: string;
  size: number;
  mimeType: string;
  content: string;
  modifiedAt: string;
}> {
  const res = await fetchWithTimeout('/api/sync/read-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath: folderPath.trim(), relativePath }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to read file');
  return data;
}

export async function writeFileToSource(
  folderPath: string,
  relativePath: string,
  content: string,
  mimeType?: string
): Promise<{ success: boolean; message: string; path: string; size: number }> {
  const res = await fetchWithTimeout('/api/sync/write-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folderPath: folderPath.trim(),
      relativePath,
      content,
      mimeType: mimeType || 'application/octet-stream',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to write file');
  return data;
}

export async function validateLocalPath(path: string): Promise<{ valid: boolean; error?: string }> {
  // Reject URLs
  if (/^https?:\/\//i.test(path)) {
    return { valid: false, error: 'Web URLs are not accepted. Please use a local file system path.' };
  }
  if (/^(dropbox|googledrive|onedrive|ftp):\/\//i.test(path)) {
    return { valid: false, error: 'Cloud storage URLs are not accepted. Please use a local file system path.' };
  }
  // Accept local paths (drive letters or UNC paths)
  if (!/^[a-zA-Z]:\\|^[a-zA-Z]:\/|^\\\\/.test(path.trim())) {
    return { valid: false, error: 'Please enter a valid local folder path (e.g. C:\\Patients\\Folder).' };
  }
  return { valid: true };
}

// ── URL Knowledge Summarization ─────────────────────────────────────────
export interface SummarizeUrlResponse {
  success: boolean;
  message: string;
  file: {
    name: string;
    relativePath: string;
    extension: string;
    size: number;
    sizeFormatted: string;
    modifiedAt: string;
  };
  summary: string;
}

export async function summarizeUrl(
  url: string,
  folderPath: string
): Promise<SummarizeUrlResponse> {
  const res = await fetchWithTimeout('/api/sync/summarize-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url.trim(), folderPath: folderPath.trim() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to summarize URL');
  return data;
}

// ── Storage Helpers ─────────────────────────────────────────────────────
// These functions manage saved analysis data in the storage folder.

export interface SavedAnalysis {
  id: string;
  caseId: string;
  patientName: string;
  createdAt: string;
  fileName: string;
  relativePath: string;
  appliance: string;
  arch: string;
  stageCount: number;
  fileSize: number;
}

/** Browser-compatible base64 encode */
function toBase64(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    // Fallback for older browsers
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let result = '';
    const bytes = new TextEncoder().encode(str);
    for (let i = 0; i < bytes.length; i += 3) {
      const b1 = bytes[i], b2 = bytes[i + 1] || 0, b3 = bytes[i + 2] || 0;
      const p1 = b1 >> 2, p2 = ((b1 & 3) << 4) | (b2 >> 4);
      const p3 = ((b2 & 15) << 2) | (b3 >> 6), p4 = b3 & 63;
      result += chars[p1] + chars[p2] + (bytes[i + 1] ? chars[p3] : '=') + (bytes[i + 2] ? chars[p4] : '=');
    }
    return result;
  }
}

/** Save an analysis result to the storage folder */
export async function saveAnalysisToStorage(
  storagePath: string,
  caseId: string,
  analysisData: Record<string, unknown>
): Promise<{ success: boolean; fileName: string; relativePath: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const params = analysisData.design_parameters as Record<string, unknown> | undefined;
  const patientHint = (params?.patientName as string) || caseId || 'unknown';
  const sanitized = String(patientHint).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const fileName = `analysis_${sanitized}_${timestamp}.json`;
  const relativePath = `saved-analyses/${fileName}`;
  const jsonStr = JSON.stringify(analysisData, null, 2);
  const base64 = toBase64(jsonStr);

  const res = await fetchWithTimeout('/api/sync/write-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folderPath: storagePath,
      relativePath,
      content: base64,
      mimeType: 'application/json',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save analysis to storage');
  return { success: true, fileName, relativePath };
}

/** Save temporary analysis working data (like RAM) */
export async function saveTempToStorage(
  storagePath: string,
  sessionId: string,
  data: Record<string, unknown>,
  fileName: string
): Promise<{ success: boolean; relativePath: string }> {
  const relativePath = `temp/${sessionId}/${fileName}`;
  const jsonStr = JSON.stringify(data, null, 2);
  const base64 = toBase64(jsonStr);

  const res = await fetchWithTimeout('/api/sync/write-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folderPath: storagePath,
      relativePath,
      content: base64,
      mimeType: 'application/json',
    }),
  });
  const data2 = await res.json();
  if (!res.ok) throw new Error(data2.error || 'Failed to save temp data');
  return { success: true, relativePath };
}

/** List saved analyses from the storage folder */
export async function listSavedAnalyses(storagePath: string): Promise<SavedAnalysis[]> {
  try {
    const res = await fetchWithTimeout('/api/sync/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: storagePath + '/saved-analyses' }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const files = (data.files || []) as ScanResponse['files'];
    
    return files
      .filter(f => f.name.endsWith('.json') && !f.isDirectory)
      .map(f => {
        // Parse metadata from filename: analysis_{patientName}_{timestamp}.json
        const parts = f.name.replace(/\.json$/, '').split('_');
        const id = f.relativePath;
        const timestamp = f.modifiedAt;
        const patientName = parts.length >= 3 ? parts.slice(1, -2).join('_') : 'Unknown';
        return {
          id,
          caseId: id,
          patientName,
          createdAt: f.modifiedAt,
          fileName: f.name,
          relativePath: f.relativePath,
          appliance: '—',
          arch: '—',
          stageCount: 0,
          fileSize: f.size,
        };
      });
  } catch {
    return [];
  }
}

/** Load a saved analysis JSON file from storage */
export async function loadSavedAnalysis(
  storagePath: string,
  relativePath: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch('/api/sync/read-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: storagePath, relativePath }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.parse(data.content);
  } catch {
    return null;
  }
}
