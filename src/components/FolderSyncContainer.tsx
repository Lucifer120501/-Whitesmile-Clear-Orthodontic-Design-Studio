import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Upload, FileText, Sparkles, Activity, RotateCcw, CheckCircle, AlertCircle,
  FileBadge, Database, Paperclip, Video, Loader2, FolderOpen, File,
  Image, Archive, Table, FileSpreadsheet, Code, FolderTree, Download,
  X, ChevronRight, ChevronDown, RefreshCw, StopCircle, Eye, EyeOff,
  Clock, HardDrive, AlertTriangle, Info
} from 'lucide-react';
import {
  ContainerState, SyncFileEntry, FolderNode, SyncProgress,
  createEmptyState, buildFileTree, scanFolder, syncFiles,
  unsyncFolder, checkForChanges, validateLocalPath,
  SavedAnalysis, listSavedAnalyses, readFileFromSource,
  summarizeUrl,
} from '../lib/syncService';

// ── Props ─────────────────────────────────────────────────────────────────
export interface FolderSyncContainerProps {
  /** Unique ID for this container instance */
  id: string;
  /** Display title (e.g. "Connected Reference Library") */
  title: string;
  /** Short description shown below title */
  description?: string;
  /** Status badge label (e.g. "AWAITING SCAN", "CONNECTED") */
  statusLabel?: string;
  /** Status color variant */
  statusVariant?: 'awaiting' | 'connected' | 'error' | 'syncing';
  /** Icon component */
  icon?: React.ReactNode;
  /** Sync mode determines backend behaviour */
  syncMode: 'reference' | 'patient' | 'storage';
  /** Where synced data should be stored (for storage mode) */
  storageTarget?: string;
  /** Whether AI can write to this folder */
  allowWrite: boolean;
  /** External state container — enables parent control */
  state: ContainerState;
  /** State setter */
  setState: React.Dispatch<React.SetStateAction<ContainerState>>;
  /** Callback when sync completes successfully */
  onSyncComplete?: (state: ContainerState) => void;
  /** Callback when files are selected */
  onSelectionChange?: (selectedFiles: SyncFileEntry[]) => void;
  /** Callback when a saved analysis is selected to be loaded back into the workspace (storage mode only) */
  onLoadSavedAnalysis?: (analysisData: Record<string, unknown>) => void;
  /** Optional inline class name */
  className?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

function getFileIcon(ext: string, isDir: boolean) {
  if (isDir) return <FolderOpen className="w-4 h-4 text-amber-500" />;
  switch (ext.toLowerCase()) {
    case '.stl': return <FileBadge className="w-4 h-4 text-blue-500" />;
    case '.pdf': return <FileText className="w-4 h-4 text-red-500" />;
    case '.doc':
    case '.docx': return <FileText className="w-4 h-4 text-blue-600" />;
    case '.xls':
    case '.xlsx':
    case '.csv': return <Table className="w-4 h-4 text-emerald-600" />;
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.gif':
    case '.webp':
    case '.bmp': return <Image className="w-4 h-4 text-purple-500" />;
    case '.zip':
    case '.rar':
    case '.7z':
    case '.gz': return <Archive className="w-4 h-4 text-orange-500" />;
    case '.json':
    case '.xml':
    case '.html':
    case '.md':
    case '.txt': return <Code className="w-4 h-4 text-slate-500" />;
    case '.mp4':
    case '.mov':
    case '.avi':
    case '.webm': return <Video className="w-4 h-4 text-rose-500" />;
    default: return <File className="w-4 h-4 text-slate-400" />;
  }
}

function getStatusBadge(status: SyncFileEntry['status']) {
  switch (status) {
    case 'not-synced': return <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Pending</span>;
    case 'queued': return <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded animate-pulse">Queued</span>;
    case 'reading': return <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded animate-pulse">Reading</span>;
    case 'writing': return <span className="text-[9px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded animate-pulse">Writing</span>;
    case 'synced': return <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Synced</span>;
    case 'error': return <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">Error</span>;
    case 'skipped': return <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Skipped</span>;
  }
}

// ── Tree Helpers ─────────────────────────────────────────────────────────
/** Recursively collect all file paths under a FolderNode */
function getAllDescendantFilePaths(node: FolderNode): string[] {
  const paths: string[] = [];
  for (const file of node.files) {
    paths.push(file.relativePath);
  }
  for (const child of node.children) {
    paths.push(...getAllDescendantFilePaths(child));
  }
  return paths;
}

// ── Folder Tree Node Component ───────────────────────────────────────────
function FolderTreeNode({
  node,
  depth,
  sortBy,
  onToggle,
  onSelect,
  onSelectFolder,
  selectedSet,
  expandedFolders,
}: {
  node: FolderNode;
  depth: number;
  sortBy: 'name' | 'type' | 'size' | 'date';
  onToggle: (path: string) => void;
  onSelect: (file: SyncFileEntry) => void;
  onSelectFolder: (folderPath: string) => void;
  selectedSet: Set<string>;
  expandedFolders: Set<string>;
}) {
  const isExpanded = expandedFolders.has(node.path);

  // Hooks must be before any early return
  const allDescendantPaths = getAllDescendantFilePaths(node);
  const selectedCount = allDescendantPaths.filter(p => selectedSet.has(p)).length;
  const allSelected = selectedCount === allDescendantPaths.length && allDescendantPaths.length > 0;
  const someSelected = selectedCount > 0 && selectedCount < allDescendantPaths.length;
  const checkboxRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  if (!node.isDirectory && node.files.length > 0) {
    const file = node.files[0];
    return (
      <div
        className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer text-xs min-w-0"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => onSelect(file)}
      >
        <input
          type="checkbox"
          checked={selectedSet.has(file.relativePath)}
          onChange={() => onSelect(file)}
          className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer shrink-0"
          onClick={(e) => e.stopPropagation()}
        />
        {getFileIcon(file.extension, false)}
        <span className="font-medium text-slate-700 truncate flex-1 min-w-0">{file.name}</span>
        <span className="text-[10px] text-slate-400 hidden sm:inline shrink-0">{file.sizeFormatted}</span>
        <span className="text-[10px] text-slate-400 hidden md:inline shrink-0">{formatDate(file.modifiedAt)}</span>
        <span className="ml-auto shrink-0">{getStatusBadge(file.status)}</span>
      </div>
    );
  }

  // Directory node
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer text-xs font-semibold text-slate-600"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <input
          type="checkbox"
          ref={checkboxRef}
          checked={allSelected}
          onChange={(e) => { e.stopPropagation(); onSelectFolder(node.path); }}
          onClick={(e) => e.stopPropagation()}
          className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer shrink-0"
        />
        <div className="flex items-center gap-2 flex-1 min-w-0" onClick={() => onToggle(node.path)}>
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
          <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="truncate">{node.name}</span>
          <span className="text-[10px] text-slate-400 ml-auto whitespace-nowrap">{allDescendantPaths.length} file{allDescendantPaths.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      {isExpanded && (
        <div>
          {[...node.files].sort((a, b) => {
            switch (sortBy) {
              case 'name': return a.name.localeCompare(b.name);
              case 'type': return a.extension.localeCompare(b.extension) || a.name.localeCompare(b.name);
              case 'size': return b.size - a.size;
              case 'date': return b.modifiedAt.localeCompare(a.modifiedAt);
              default: return a.name.localeCompare(b.name);
            }
          }).map((file, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer text-xs min-w-0"
              style={{ paddingLeft: `${24 + depth * 16}px` }}
              onClick={() => onSelect(file)}
            >
              <input
                type="checkbox"
                checked={selectedSet.has(file.relativePath)}
                onChange={() => onSelect(file)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer shrink-0"
                onClick={(e) => e.stopPropagation()}
              />
              {getFileIcon(file.extension, false)}
              <span className="font-medium text-slate-700 truncate flex-1 min-w-0">{file.name}</span>
              <span className="text-[10px] text-slate-400 hidden sm:inline shrink-0">{file.sizeFormatted}</span>
              <span className="text-[10px] text-slate-400 hidden md:inline shrink-0">{formatDate(file.modifiedAt)}</span>
              <span className="ml-auto shrink-0">{getStatusBadge(file.status)}</span>
            </div>
          ))}
          {[...node.children]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((child, idx) => (
            <FolderTreeNode
              key={idx}
              node={child}
              depth={depth + 1}
              sortBy={sortBy}
              onToggle={onToggle}
              onSelect={onSelect}
              onSelectFolder={onSelectFolder}
              selectedSet={selectedSet}
              expandedFolders={expandedFolders}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tree Sort Helper ─────────────────────────────────────────────────────
function sortTree(nodes: FolderNode[], sortBy: 'name' | 'type' | 'size' | 'date'): FolderNode[] {
  const sorted = [...nodes].map(node => ({
    ...node,
    children: sortTree(node.children, sortBy),
    files: [...node.files].sort((a, b) => {
      switch (sortBy) {
        case 'name': return a.name.localeCompare(b.name);
        case 'type': return a.extension.localeCompare(b.extension) || a.name.localeCompare(b.name);
        case 'size': return b.size - a.size;
        case 'date': return b.modifiedAt.localeCompare(a.modifiedAt);
        default: return a.name.localeCompare(b.name);
      }
    }),
  }));

  // Sort directories first, then leaf-nodes (files without children),
  // each group sorted by name
  return sorted.sort((a, b) => {
    const aIsDir = a.isDirectory || a.children.length > 0;
    const bIsDir = b.isDirectory || b.children.length > 0;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.name.localeCompare(b.name);
  });
}

// ── Main Component ────────────────────────────────────────────────────────
export default function FolderSyncContainer({
  id,
  title,
  description,
  statusLabel,
  statusVariant = 'awaiting',
  icon,
  syncMode,
  storageTarget,
  allowWrite,
  state,
  setState,
  onSyncComplete,
  onSelectionChange,
  onLoadSavedAnalysis,
  className = '',
}: FolderSyncContainerProps) {
  const [folderInput, setFolderInput] = useState(state.folderPath || '');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [viewMode, setViewMode] = useState<'tree' | 'flat'>('flat');
  const [sortBy, setSortBy] = useState<'name' | 'type' | 'size' | 'date'>('type');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);
  const fileContainerRef = useRef<HTMLDivElement>(null);

  // Storage mode: saved analyses
  const isStorage = syncMode === 'storage';

  // URL knowledge summarization (reference mode only)
  const isReference = syncMode === 'reference';
  const [urlInput, setUrlInput] = useState('');
  const [summarizingUrl, setSummarizingUrl] = useState(false);
  const [urlSummaries, setUrlSummaries] = useState<Array<{
    url: string;
    status: 'processing' | 'completed' | 'error';
    message: string;
    fileName?: string;
  }>>([]);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(false);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);

  // No terminal state needed — import sends files via callback

  // Sync input with state
  useEffect(() => {
    setFolderInput(state.folderPath);
  }, [state.folderPath]);

  // Derive selected files
  const selectedFiles = state.files.filter(f => f.selected);
  const selectedPaths = new Set(state.files.filter(f => f.selected).map(f => f.relativePath));

  // Flat list — sort all real files (not directory entries) by type then name
  const flatFileList = state.files
    .filter(f => !f.isDirectory)
    .sort((a, b) => {
      switch (sortBy) {
        case 'name': return a.name.localeCompare(b.name);
        case 'type': return a.extension.localeCompare(b.extension) || a.name.localeCompare(b.name);
        case 'size': return b.size - a.size;
        case 'date': return b.modifiedAt.localeCompare(a.modifiedAt);
        default: return a.extension.localeCompare(b.extension) || a.name.localeCompare(b.name);
      }
    });

  // ── Path Validation ──────────────────────────────────────────────────────
  const pathValidation = (() => {
    if (!folderInput.trim()) return null;
    if (/^https?:\/\//i.test(folderInput.trim())) return { valid: false, message: 'Web URLs are not accepted.' };
    if (/^(dropbox|googledrive|onedrive|ftp):\/\//i.test(folderInput.trim())) return { valid: false, message: 'Cloud URLs are not accepted.' };
    if (/^[a-zA-Z]:\\|^[a-zA-Z]:\/|^\\\\/.test(folderInput.trim())) return { valid: true, message: '' };
    return { valid: false, message: 'Enter a local path (e.g. C:\\Patients\\Folder).' };
  })();

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handlePathChange = useCallback((value: string) => {
    let sanitized = value.replace(/["']+/g, '').trim();
    // Deduplicate — if path appears concatenated twice, use first half
    if (sanitized.length > 10) {
      const half = Math.floor(sanitized.length / 2);
      if (sanitized.substring(0, half) === sanitized.substring(half)) {
        sanitized = sanitized.substring(0, half);
      }
    }
    setFolderInput(sanitized);
    setState(prev => ({ ...prev, folderPath: sanitized, complete: false }));
  }, [setState]);

  const handleScan = useCallback(async () => {
    if (!folderInput.trim()) return;
    const validation = await validateLocalPath(folderInput.trim());
    if (!validation.valid) {
      setState(prev => ({ ...prev, error: validation.error || 'Invalid path' }));
      return;
    }

    setState(prev => ({
      ...prev,
      scanning: true,
      syncing: false,
      error: null,
      complete: false,
      files: [],
      fileTree: [],
      stats: { files: 0, folders: 0, totalSize: '0 Bytes', totalSizeBytes: 0, synced: 0, pending: 0, errors: 0 },
    }));

    try {
      const result = await scanFolder(folderInput.trim());
      const files: SyncFileEntry[] = (result.files || []).map(f => ({
        ...f,
        selected: false,
        status: 'not-synced' as const,
      }));

      // Build file tree
      const fileTree = buildFileTree(files);
      // Auto-expand first level
      const expanded = new Set<string>();
      for (const node of fileTree) {
        if (node.isDirectory) {
          expanded.add(node.path);
          // Expand second level
          for (const child of node.children) {
            if (child.isDirectory) expanded.add(child.path);
          }
        }
      }

      setState(prev => ({
        ...prev,
        files,
        fileTree,
        folderPath: result.folderPath,
        complete: true,
        scanning: false,
        error: null,
        stats: result.stats || {
          files: files.length,
          folders: result.stats?.folders || 0,
          totalSize: formatFileSize(files.reduce((sum, f) => sum + f.size, 0)),
          totalSizeBytes: files.reduce((sum, f) => sum + f.size, 0),
          synced: 0,
          pending: files.length,
          errors: 0,
        },
      }));
      setExpandedFolders(expanded);

      // Auto-fetch saved analyses in storage mode
      if (isStorage && result.folderPath) {
        try {
          const saved = await listSavedAnalyses(result.folderPath);
          setSavedAnalyses(saved);
        } catch {
          // Silently fail — saved-analyses subfolder may not exist yet
        }
      }
    } catch (err: any) {
      setState(prev => ({ ...prev, scanning: false, error: err.message || 'Scan failed' }));
    }
  }, [folderInput, isStorage, setState]);

  const handleToggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleToggleFolderSelect = useCallback((folderPath: string) => {
    setState(prev => {
      // Normalize paths to use forward slashes for consistent matching
      const normalizedFolder = folderPath.replace(/\\/g, '/');
      const prefix = normalizedFolder.endsWith('/') ? normalizedFolder : normalizedFolder + '/';
      const folderFiles = prev.files.filter(f => {
        const normalizedFile = f.relativePath.replace(/\\/g, '/');
        return normalizedFile === normalizedFolder || normalizedFile.startsWith(prefix);
      });
      if (folderFiles.length === 0) return prev;
      // Determine if all are selected — if so, deselect all; otherwise select all
      const allSelected = folderFiles.every(f => f.selected);
      const filePaths = new Set(folderFiles.map(f => f.relativePath));
      const updated = prev.files.map(f =>
        filePaths.has(f.relativePath) ? { ...f, selected: !allSelected } : f
      );
      return { ...prev, files: updated };
    });
    setTimeout(() => {
      setState(prev => {
        onSelectionChange?.(prev.files.filter(f => f.selected));
        return prev;
      });
    }, 0);
  }, [setState, onSelectionChange]);

  const handleToggleFile = useCallback((file: SyncFileEntry) => {
    setState(prev => {
      const updated = prev.files.map(f =>
        f.relativePath === file.relativePath ? { ...f, selected: !f.selected } : f
      );
      const selected = updated.filter(f => f.selected);
      return { ...prev, files: updated };
    });
    // Trigger selection callback after state update
    setTimeout(() => {
      setState(prev => {
        onSelectionChange?.(prev.files.filter(f => f.selected));
        return prev;
      });
    }, 0);
  }, [setState, onSelectionChange]);

  const handleSelectAll = useCallback(() => {
    const newVal = !selectAll;
    setSelectAll(newVal);
    setState(prev => ({
      ...prev,
      files: prev.files.map(f => ({ ...f, selected: newVal })),
    }));
  }, [selectAll, setState]);

  const handleDeselectAll = useCallback(() => {
    setSelectAll(false);
    setState(prev => ({
      ...prev,
      files: prev.files.map(f => ({ ...f, selected: false })),
    }));
  }, [setState]);

  const handleInvertSelection = useCallback(() => {
    setState(prev => {
      const updated = prev.files.map(f => ({ ...f, selected: !f.selected }));
      return { ...prev, files: updated };
    });
  }, [setState]);

  const handleSync = useCallback(async () => {
    const selected = state.files.filter(f => f.selected);
    if (selected.length === 0) return;

    setState(prev => ({
      ...prev,
      syncing: true,
      error: null,
      progress: { percent: 0, currentFile: '', filesCompleted: 0, totalFiles: selected.length, stage: 'Preparing...' },
    }));

    try {
      const selectedRelativePaths = selected.map(f => f.relativePath);
      await syncFiles(
        state.folderPath,
        selectedRelativePaths,
        syncMode,
        storageTarget,
        (progress) => {
          setState(prev => ({
            ...prev,
            progress: {
              percent: progress.percent,
              currentFile: progress.currentFile,
              filesCompleted: progress.filesCompleted,
              totalFiles: progress.totalFiles,
              stage: progress.stage,
            },
            files: prev.files.map(f =>
              f.relativePath === progress.currentFile
                ? { ...f, status: progress.stage.includes('Read') ? 'reading' as const : 'writing' as const }
                : f
            ),
          }));
        }
      );

      // Mark selected as synced
      setState(prev => ({
        ...prev,
        syncing: false,
        complete: true,
        pendingUnsync: false,
        progress: { percent: 100, currentFile: '', filesCompleted: selected.length, totalFiles: selected.length, stage: 'Complete' },
        files: prev.files.map(f =>
          f.selected ? { ...f, status: 'synced' as const } : f
        ),
        stats: {
          ...prev.stats,
          synced: prev.stats.synced + selected.length,
          pending: Math.max(0, prev.stats.pending - selected.length),
        },
        monitoring: true,
      }));

      onSyncComplete?.(state);
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        syncing: false,
        error: err.message || 'Sync failed',
      }));
    }
  }, [state, syncMode, storageTarget, setState, onSyncComplete]);

  const handleUnsync = useCallback(async () => {
    if (allowWrite && state.syncing) {
      // Queue unsync — AI is writing
      setState(prev => ({ ...prev, pendingUnsync: true }));
      return;
    }

    setState(prev => ({ ...prev, syncing: true, error: null }));
    try {
      await unsyncFolder(state.folderPath, id, allowWrite);
      setState(prev => ({
        ...createEmptyState(id),
        folderPath: '',
        monitoring: false,
      }));
      setFolderInput('');
      setSelectAll(false);
    } catch (err: any) {
      setState(prev => ({ ...prev, syncing: false, error: err.message || 'Unsync failed' }));
    }
  }, [state, id, allowWrite, setState]);

  // ── URL Summarization ───────────────────────────────────────────────────
  const handleSummarizeUrl = useCallback(async () => {
    let url = urlInput.trim();
    if (!url || !state.folderPath) return;

    // Lenient URL validation — try to auto-fix common issues instead of rejecting
    // If URL has no protocol, prepend https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    // Remove trailing punctuation that likely isn't part of the URL
    url = url.replace(/[.,;:!?]+$/, '').replace(/['"\]}>]+$/, '');

    // Quick sanity check — does it look like a URL at all?
    if (!url.includes('.') && !url.includes('localhost')) {
      showToast('Please enter a valid web URL (e.g. https://example.com/page).', 'error');
      return;
    }

    const entry = { url, status: 'processing' as const, message: 'Fetching and summarizing...' };
    setUrlSummaries(prev => [entry, ...prev]);
    setUrlInput('');
    setSummarizingUrl(true);

    try {
      const result = await summarizeUrl(url, state.folderPath);
      setUrlSummaries(prev =>
        prev.map(e =>
          e.url === url
            ? { ...e, status: 'completed' as const, message: 'Knowledge saved!', fileName: result.file.name }
            : e
        )
      );
      showToast(`Knowledge saved from ${url}`, 'success');

      // Trigger a re-scan so the new knowledge file appears in the file list
      if (inputRef.current) {
        handleScan();
      }
    } catch (err: any) {
      setUrlSummaries(prev =>
        prev.map(e =>
          e.url === url
            ? { ...e, status: 'error' as const, message: err.message || 'Failed to summarize' }
            : e
        )
      );
      showToast(`Failed to summarize: ${err.message || 'Unknown error'}`, 'error');
    } finally {
      setSummarizingUrl(false);
    }
  }, [urlInput, state.folderPath]);

  // ── Toast helper for storage mode ─────────────────────────────────────
  const addToast = (message: string, type: 'success' | 'error' | 'info') => {
    const id = Math.random().toString(36).substring(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  // ── Storage Mode: Load Saved Analysis ──────────────────────────────────
  const handleLoadAnalysis = useCallback(async (analysis: SavedAnalysis) => {
    if (!state.folderPath || !onLoadSavedAnalysis) return;
    setSelectedAnalysisId(analysis.id);
    try {
      // Read the saved analysis file directly
      const data = await readFileFromSource(state.folderPath, analysis.relativePath).then(r => {
        try { return JSON.parse(atob(r.content)); } catch { return null; }
      });
      if (data) {
        onLoadSavedAnalysis(data);
        addToast(`Loaded analysis: ${analysis.fileName}`, 'success');
      } else {
        addToast('Failed to load analysis data', 'error');
      }
    } catch {
      addToast('Error loading analysis', 'error');
    } finally {
      setSelectedAnalysisId(null);
    }
  }, [state.folderPath, onLoadSavedAnalysis]);

  // ── Storage Mode: Refresh Saved Analyses ──────────────────────────────
  const handleRefreshAnalyses = useCallback(async () => {
    if (!state.folderPath) return;
    setLoadingAnalyses(true);
    try {
      const saved = await listSavedAnalyses(state.folderPath);
      setSavedAnalyses(saved);
      addToast(`Found ${saved.length} saved analysis(es)`, 'info');
    } catch {
      addToast('Failed to list saved analyses', 'error');
    } finally {
      setLoadingAnalyses(false);
    }
  }, [state.folderPath]);

  // ── Storage Mode: Refresh analyses when folder path changes ───────────
  useEffect(() => {
    if (isStorage && state.complete && state.folderPath) {
      listSavedAnalyses(state.folderPath).then(setSavedAnalyses).catch(() => {});
    }
  }, [isStorage, state.complete, state.folderPath]);

  // Background monitoring via polling
  useEffect(() => {
    if (!state.monitoring || !state.folderPath) return;
    const interval = window.setInterval(async () => {
      try {
        const result = await checkForChanges(state.folderPath);
        if (result.changed) {
          setState(prev => ({ ...prev, changesDetected: true }));
        }
      } catch {
        // Silently fail
      }
    }, 15000);

    return () => window.clearInterval(interval);
  }, [state.monitoring, state.folderPath, setState]);

  // Auto-unsync after write completes
  useEffect(() => {
    if (state.pendingUnsync && !state.syncing) {
      handleUnsync();
    }
  }, [state.pendingUnsync, state.syncing, handleUnsync]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Drag & Drop ─────────────────────────────────────────────────────────
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = e.dataTransfer.items;
    if (!items) return;
    // Try to get folder path from dropped item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry?.isDirectory) {
          // Can't get full path from browser security — user must type it
          showToast('Please enter the folder path manually. Browser security does not expose the full path.', 'info');
          return;
        }
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  // ── Toast Helper ────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'error' | 'info' }>>([]);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  // ── Status Badge Render ────────────────────────────────────────────────
  const renderStatusBadge = () => {
    const variantStyles = {
      awaiting: 'bg-slate-100 text-slate-500 border-slate-200',
      connected: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      error: 'bg-rose-100 text-rose-800 border-rose-200',
      syncing: 'bg-amber-100 text-amber-800 border-amber-200',
    };
    const dotStyles = {
      awaiting: 'bg-slate-400',
      connected: 'bg-emerald-500',
      error: 'bg-rose-500',
      syncing: 'bg-amber-500 animate-pulse',
    };
    return (
      <span className={`text-[10px] border px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 ${variantStyles[statusVariant]}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${dotStyles[statusVariant]}`}></span>
        {statusLabel || (state.complete ? 'CONNECTED' : state.error ? 'ERROR' : state.syncing ? 'SYNCING' : 'AWAITING SCAN')}
      </span>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 p-6 shadow-xs w-full flex flex-col justify-between transition-all duration-200 ${dragOver ? 'border-teal-400 ring-2 ring-teal-100' : ''} ${className}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-sm w-full">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-3 rounded-xl shadow-lg border flex items-start gap-2 transition-all duration-300 text-xs ${
              toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : toast.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800'
                : 'bg-cyan-50 border-cyan-200 text-cyan-800'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              : toast.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              : <Info className="w-4 h-4 shrink-0 mt-0.5" />}
            <span className="font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            {icon || <Database className="w-5 h-5 text-teal-600" />}
            <div>
              <h2 className="text-md font-bold text-slate-800">{title}</h2>
              {description && <p className="text-[10px] text-slate-400 mt-0.5">{description}</p>}
            </div>
          </div>
          {renderStatusBadge()}
        </div>

        {/* ── Folder Path Input ───────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase text-slate-400 block mb-1">
            <HardDrive className="w-3.5 h-3.5 inline mr-1" />
            Folder Path
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={folderInput}
                onChange={(e) => handlePathChange(e.target.value)}
                onPaste={(e) => {
                  e.preventDefault();
                  const pasted = e.clipboardData.getData('text/plain').trim().replace(/["']+/g, '');
                  if (pasted) {
                    handlePathChange(pasted);
                  }
                }}
                placeholder="e.g. C:\Patients\Reference_Library"
                className={`w-full bg-slate-50 border rounded-xl p-2.5 text-xs focus:bg-white focus:outline-none focus:ring-1 font-medium transition-all ${
                  pathValidation && !pathValidation.valid
                    ? 'border-rose-300 focus:ring-rose-500'
                    : 'border-slate-200 focus:ring-teal-500'
                }`}
                disabled={state.syncing}
              />
              {pathValidation && !pathValidation.valid && (
                <p className="text-[10px] text-rose-500 mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {pathValidation.message}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleScan}
              disabled={state.scanning || state.syncing || !folderInput.trim() || (pathValidation && !pathValidation.valid)}
              className="px-4 py-2.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-all disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer shrink-0 flex items-center gap-1.5"
            >
              {state.scanning ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning</>
              ) : (
                <><FolderOpen className="w-3.5 h-3.5" /> Scan</>
              )}
            </button>
          </div>
        </div>

        {/* ── Error Banner ────────────────────────────────────────────────── */}
        {state.error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-rose-800">Error</p>
              <p className="text-rose-700 mt-0.5">{state.error}</p>
            </div>
          </div>
        )}

        {/* ── Changes Detected Banner ────────────────────────────────────── */}
        {state.changesDetected && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-amber-600" />
              <span className="font-bold text-amber-800">Changes detected in folder</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleScan}
                className="text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                Re-scan
              </button>
              <button
                onClick={() => setState(prev => ({ ...prev, changesDetected: false }))}
                className="text-xs font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                Ignore
              </button>
            </div>
          </div>
        )}

        {/* ── Pending Unsync Banner ──────────────────────────────────────── */}
        {state.pendingUnsync && (
          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-2 text-xs">
            <Loader2 className="w-4 h-4 text-indigo-600 animate-spin shrink-0" />
            <div>
              <p className="font-bold text-indigo-800">Waiting for current write operation...</p>
              <p className="text-indigo-600 mt-0.5">Unsync will begin automatically when writing completes.</p>
            </div>
          </div>
        )}

        {/* ── Sync Progress ──────────────────────────────────────────────── */}
        {state.syncing && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 text-teal-600 animate-spin" />
                {state.progress.stage || 'Syncing...'}
              </span>
              <span className="font-bold text-teal-600">{state.progress.percent}%</span>
            </div>
            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
              <div
                className="bg-teal-500 h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${state.progress.percent}%` }}
              ></div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>
                {state.progress.filesCompleted} / {state.progress.totalFiles} files
              </span>
              {state.progress.currentFile && (
                <span className="flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  <span className="truncate max-w-[200px]">{state.progress.currentFile}</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Statistics Bar (when connected) ─────────────────────────────── */}
        {state.complete && !state.syncing && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { label: 'Files', value: state.stats.files, color: 'text-slate-800' },
              { label: 'Folders', value: state.stats.folders, color: 'text-slate-800' },
              { label: 'Size', value: state.stats.totalSize, color: 'text-slate-800' },
              { label: 'Synced', value: state.stats.synced, color: 'text-emerald-600' },
              { label: 'Pending', value: state.stats.pending, color: 'text-amber-600' },
              { label: 'Errors', value: state.stats.errors, color: state.stats.errors > 0 ? 'text-rose-600' : 'text-slate-800' },
            ].map((stat, idx) => (
              <div key={idx} className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                <div className={`text-xs font-bold ${stat.color}`}>{stat.value}</div>
                <div className="text-[9px] text-slate-400 uppercase tracking-wide">{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Reference Mode: URL Knowledge Summarization ──────────────── */}
        {isReference && state.complete && !state.syncing && (
          <div className="bg-cyan-50/40 border border-cyan-100 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="w-4 h-4 text-cyan-600"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <span className="text-xs font-bold text-slate-700">Resource Knowledge URLs</span>
              <span className="text-[9px] text-slate-400 font-medium">(AI will fetch, summarize &amp; save as knowledge)</span>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !summarizingUrl) handleSummarizeUrl(); }}
                  placeholder="Paste a resource URL — e.g. https://pubmed.ncbi.nlm.nih.gov/..."
                  className="w-full bg-white border rounded-xl p-2.5 text-xs focus:outline-none focus:ring-1 font-medium transition-all border-slate-200 focus:ring-cyan-500"
                  disabled={summarizingUrl}
                />
              </div>
              <button
                type="button"
                onClick={handleSummarizeUrl}
                disabled={summarizingUrl || !urlInput.trim() || !state.folderPath}
                className="px-4 py-2.5 text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-all disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer shrink-0 flex items-center gap-1.5"
              >
                {summarizingUrl ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Summarizing...</>
                ) : (
                  <><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="w-3.5 h-3.5"><path d="M12 2a10 10 0 0 1 10 10"/><path d="M2 12a10 10 0 0 1 10-10"/><path d="M12 22a10 10 0 0 1-10-10"/><path d="M22 12a10 10 0 0 1-10 10"/><path d="M12 2v20"/><path d="M2 12h20"/></svg> Fetch &amp; Summarize</>
                )}
              </button>
            </div>

            {/* URL Summary entries */}
            {urlSummaries.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1">
                {urlSummaries.map((entry, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-100 text-xs">
                    {entry.status === 'processing' ? (
                      <Loader2 className="w-3.5 h-3.5 text-cyan-500 animate-spin shrink-0" />
                    ) : entry.status === 'completed' ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="w-3.5 h-3.5 text-emerald-500 shrink-0"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><polyline points="9 12 11 14 15 10"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="w-3.5 h-3.5 text-rose-500 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                    )}
                    <span className="text-[10px] text-slate-500 truncate flex-1">{entry.url}</span>
                    <span className={`text-[9px] font-bold shrink-0 ${
                      entry.status === 'processing' ? 'text-cyan-600' :
                      entry.status === 'completed' ? 'text-emerald-600' :
                      'text-rose-600'
                    }`}>{entry.message}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[9px] text-slate-400 leading-relaxed">
              URLs are fetched, summarized by AI, and saved as knowledge files in <code className="text-cyan-600 bg-cyan-50 px-1 rounded">_ai_knowledge/</code> inside your connected folder. These summaries automatically become AI guidelines when synced.
            </p>
          </div>
        )}

        {/* ── Storage Mode: Saved Analyses ──────────────────────────────── */}
        {isStorage && state.complete && !state.syncing && (
          <div className="bg-indigo-50/40 border border-indigo-100 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Archive className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-700">Saved Analyses</span>
                <span className="text-[10px] text-slate-400 font-medium">({savedAnalyses.length})</span>
              </div>
              <button
                onClick={handleRefreshAnalyses}
                disabled={loadingAnalyses}
                className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-100 hover:bg-indigo-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${loadingAnalyses ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {loadingAnalyses ? (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                Loading saved analyses...
              </div>
            ) : savedAnalyses.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-xs text-slate-400">
                  No saved analyses yet. Results are auto-saved here when you run an analysis with this storage folder configured.
                </p>
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {savedAnalyses.map((analysis) => (
                  <div
                    key={analysis.id}
                    onClick={() => handleLoadAnalysis(analysis)}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all cursor-pointer text-xs ${
                      selectedAnalysisId === analysis.id
                        ? 'bg-indigo-100 border-indigo-300'
                        : 'bg-white border-indigo-100 hover:border-indigo-200 hover:bg-indigo-50/50'
                    }`}
                  >
                    <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-700 truncate">{analysis.fileName}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {analysis.patientName} &middot; {new Date(analysis.createdAt).toLocaleDateString()} &middot; {Math.round(analysis.fileSize / 1024)} KB
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleLoadAnalysis(analysis); }}
                      disabled={selectedAnalysisId === analysis.id}
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {selectedAnalysisId === analysis.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : 'Load'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── File Preview Area ───────────────────────────────────────────── */}
        {state.files.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  Files ({state.files.filter(f => !f.isDirectory).length})
                </span>
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  title={showPreview ? 'Hide file list' : 'Show file list'}
                >
                  {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {/* View mode toggle */}
                <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setViewMode('flat')}
                    className={`text-[10px] font-bold px-2 py-1 transition-colors cursor-pointer ${
                      viewMode === 'flat' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                    title="Flat list view — all files in one list"
                  >
                    List
                  </button>
                  <button
                    onClick={() => setViewMode('tree')}
                    className={`text-[10px] font-bold px-2 py-1 transition-colors cursor-pointer ${
                      viewMode === 'tree' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                    title="Tree view — organised by folder structure"
                  >
                    Tree
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSelectAll}
                  className="text-[10px] font-bold text-teal-600 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 px-2 py-1 rounded transition-colors cursor-pointer"
                >
                  Select All
                </button>
                <button
                  onClick={handleDeselectAll}
                  className="text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded transition-colors cursor-pointer"
                >
                  Deselect
                </button>
                <button
                  onClick={handleInvertSelection}
                  className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded transition-colors cursor-pointer"
                >
                  Invert
                </button>
              </div>
            </div>

            {showPreview && (
              <div
                ref={fileContainerRef}
                className="bg-slate-50 border border-slate-200 rounded-xl max-h-64 overflow-y-auto overflow-x-hidden overscroll-contain"
                style={{ scrollBehavior: 'smooth' }}
              >
                {/* Shared sort chips */}
                <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 border-b border-slate-200 sticky top-0 bg-slate-50 z-10">
                  <span className="text-[9px] font-semibold text-slate-400 uppercase mr-1">Sort:</span>
                  {(['type', 'name', 'size', 'date'] as const).map(key => (
                    <button
                      key={key}
                      onClick={() => setSortBy(key)}
                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                        sortBy === key
                          ? 'bg-teal-100 text-teal-700'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {key === 'type' ? 'Type' : key === 'name' ? 'Name' : key === 'size' ? 'Size' : 'Date'}
                    </button>
                  ))}
                </div>

                {viewMode === 'flat' ? (
                  /* ── Flat List View ──────────────────────────────────── */
                  <div>
                    {flatFileList.length === 0 ? (
                      <div className="p-4 text-center">
                        <p className="text-xs text-slate-400">No files to display.</p>
                      </div>
                    ) : (
                      <>
                        {/* Flat file rows */}
                        {flatFileList.map((file, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 py-1.5 px-3 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer text-xs min-w-0"
                            onClick={() => handleToggleFile(file)}
                          >
                            <input
                              type="checkbox"
                              checked={selectedPaths.has(file.relativePath)}
                              onChange={() => handleToggleFile(file)}
                              className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            />
                            {getFileIcon(file.extension, false)}
                            <span className="font-medium text-slate-700 truncate flex-1 min-w-0">{file.name}</span>
                            <span className="text-[10px] font-mono text-slate-400 hidden sm:inline shrink-0">{file.extension || '—'}</span>
                            <span className="text-[10px] text-slate-400 hidden sm:inline w-16 text-right shrink-0">{file.sizeFormatted}</span>
                            <span className="ml-2 shrink-0">{getStatusBadge(file.status)}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                ) : (
                  /* ── Tree View ───────────────────────────────────────── */
                  state.fileTree.length > 0 ? (
                    sortTree(
                      state.fileTree.filter(n => n.isDirectory || n.files.length > 0),
                      sortBy
                    ).map((node, idx) => (
                      <FolderTreeNode
                        key={idx}
                        node={node}
                        depth={0}
                        sortBy={sortBy}
                        onToggle={handleToggleFolder}
                        onSelect={handleToggleFile}
                        onSelectFolder={handleToggleFolderSelect}
                        selectedSet={selectedPaths}
                        expandedFolders={expandedFolders}
                      />
                    ))
                  ) : (
                    <div className="p-4 text-center">
                      <p className="text-xs text-slate-400">No files to display. Scan a folder to populate this view.</p>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Empty State ─────────────────────────────────────────────────── */}
        {state.files.length === 0 && !state.scanning && !state.error && (
          <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center bg-slate-50/50">
            <Activity className="w-8 h-8 text-slate-300 mx-auto mb-2 animate-pulse" />
            <p className="text-xs font-bold text-slate-600">
              {state.complete ? 'No files found' : 'Scan a Folder to Start'}
            </p>
            <p className="text-[10px] text-slate-400 mt-1 max-w-sm mx-auto font-sans">
              {state.complete
                ? 'The folder exists but contains no readable files.'
                : 'Enter a local folder path above and click Scan to view its contents.'
              }
            </p>
          </div>
        )}

        {/* ── Scanning State ──────────────────────────────────────────────── */}
        {state.scanning && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-teal-600 mx-auto animate-spin" />
            <div className="space-y-1">
              <p className="text-xs font-bold text-slate-700">Scanning directory...</p>
              <p className="text-[10px] text-slate-400">Reading folder structure and file metadata</p>
            </div>
            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
              <div className="bg-teal-500 h-full animate-pulse rounded-full" style={{ width: '60%' }}></div>
            </div>
          </div>
        )}
      </div>

      {/* ── Action Buttons ────────────────────────────────────────────────── */}
      <div className="pt-4 border-t border-slate-100 flex flex-col gap-2 mt-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={state.syncing || selectedFiles.length === 0}
            className="flex-1 inline-flex items-center justify-center gap-2 font-bold text-xs py-3 rounded-xl transition-all shadow-sm cursor-pointer bg-teal-600 hover:bg-teal-700 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {state.syncing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Syncing...</>
            ) : (
              <><Download className="w-4 h-4" /> Sync {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ''}</>
            )}
          </button>

          {state.complete && (
            <button
              type="button"
              onClick={handleUnsync}
              disabled={state.syncing}
              className="inline-flex items-center justify-center gap-2 font-bold text-xs py-3 px-4 rounded-xl transition-all cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4" />
              Unsync
            </button>
          )}
        </div>

        {/* Quick action: re-scan */}
        {state.complete && (
          <button
            type="button"
            onClick={handleScan}
            disabled={state.scanning}
            className="w-full inline-flex items-center justify-center gap-1.5 text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${state.scanning ? 'animate-spin' : ''}`} />
            Re-scan folder
          </button>
        )}
      </div>
    </div>
  );
}
