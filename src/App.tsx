import React, { useState, useEffect, useRef, useCallback } from "react";
import { DentalCase, AnalysisResult } from "./types";
import RulesCheatsheet from "./components/RulesCheatsheet";
import AnalysisResultView from "./components/AnalysisResultView";
import CaseHistory from "./components/CaseHistory";
import LoginPage from "./components/LoginPage";
import AdminPanel from "./components/AdminPanel";
import SystemsHub from "./components/SystemsHub";
import SystemsStatusCard from "./components/SystemsStatusCard";
import { useAuth } from "./hooks/useAuth";
import { AlignerLogo } from "./components/AlignerLogo";
import { 
  Upload,
  FileText,
  Sparkles,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  FileBadge,
  Database,
  Paperclip,
  Video,
  Loader2,
  Cpu,
  Brain,
  Settings,
  BarChart3,
  Archive,
  Download,
  Shield,
  Bug,
  LogOut,
  ShieldCheck,
  UserRound,
  Terminal,
  BookOpen,
  Menu,
  X,
} from "lucide-react";

import FolderSyncContainer from "./components/FolderSyncContainer";
import { ContainerState, createEmptyState, saveAnalysisToStorage, saveTempToStorage } from "./lib/syncService";
import { getApiBase } from "./lib/apiBase";

export default function App() {
  // ── Auth & multi-tenant session ──
  const auth = useAuth();

  const [prescriptionText, setPrescriptionText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [prescriptionFiles, setPrescriptionFiles] = useState<File[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const analyzingRef = useRef(false); // Guard against concurrent analysis runs
  const [activeResult, setActiveResult] = useState<AnalysisResult | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [historyCases, setHistoryCases] = useState<DentalCase[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPrescriptionDragOver, setIsPrescriptionDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<"workspace" | "cheatsheet" | "local" | "storage" | "ai-manager" | "admin">("workspace");
  const [selectedMaterial, setSelectedMaterial] = useState("PETG 1.0mm Thermoforming Sheet");

  // Left nav drawer (hamburger — tablets/mobile friendly) — keeps nav off the top bar
  const [navOpen, setNavOpen] = useState(false);

  // Sidebar collapsible panels — keeps everything visible without scrolling
  const [sidebarAnalysisOpen, setSidebarAnalysisOpen] = useState(true);
  const [sidebarAntivirusOpen, setSidebarAntivirusOpen] = useState(false);

  // Analysis progress tracking
  const ANALYSIS_STEPS = [
    { id: 'upload', label: 'Uploading case files', svg: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> },
    { id: 'parse', label: 'Parsing STL scans & documents', svg: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg> },
    { id: 'ai', label: 'AI analyzing prescription', svg: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 0 1 10 10"/><path d="M2 12a10 10 0 0 1 10-10"/><path d="M12 22a10 10 0 0 1-10-10"/><path d="M22 12a10 10 0 0 1-10 10"/><path d="M12 2v20"/><path d="M2 12h20"/></svg> },
    { id: 'validate', label: 'Validating compliance rules', svg: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><polyline points="9 12 11 14 15 10"/></svg> },
    { id: 'generate', label: 'Generating manufacturing spec', svg: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
  ];
  const [analysisStep, setAnalysisStep] = useState(-1); // -1 = not started, 0+ = current step index
  
  // Folder Sync Container States
  const [kbSyncState, setKbSyncState] = useState<ContainerState>(createEmptyState('kb'));
  const [patientSyncState, setPatientSyncState] = useState<ContainerState>(createEmptyState('patient'));
  const [storageSyncState, setStorageSyncState] = useState<ContainerState>(createEmptyState('storage'));
  
  const [useClinicalRAG, setUseClinicalRAG] = useState(true);
  const [keepInSync, setKeepInSync] = useState(false);
  
  // Antivirus & Antibug System
  const [antivirusEnabled, setAntivirusEnabled] = useState(true);
  const [antibugEnabled, setAntibugEnabled] = useState(true);
  const [scanResults, setScanResults] = useState<{
    antivirus: { scanned: boolean; safe: boolean; threats: number; threatDetails: string[]; deleted?: boolean; file?: string } | null;
    antibug: { scanned: boolean; issuesFound: number; fixesApplied: number; fixes: string[]; issues: { file: string; line: number; message: string; severity: string; code?: string }[] } | null;
    scanning: boolean;
  }>({ antivirus: null, antibug: null, scanning: false });

  // Knowledge Resources & Auto-Learning
  const [knowledgeText, setKnowledgeText] = useState('');
  const [processingKnowledge, setProcessingKnowledge] = useState(false);
  const [knowledgeResources, setKnowledgeResources] = useState<Array<{
    type: 'text' | 'url';
    source: string;
    summary: string;
    status: 'processing' | 'completed' | 'error';
    fileName?: string;
  }>>([]);
  const [totalResourcesGathered, setTotalResourcesGathered] = useState(0);
  const [autoLearning, setAutoLearning] = useState(false);
  const [quickLearn, setQuickLearn] = useState(false);
  const [autoLearningStatus, setAutoLearningStatus] = useState<string>('');
  const [autoLearningQueries, setAutoLearningQueries] = useState<Array<{
    query: string;
    reason: string;
    status: string;
  }>>([]);

  // Toast notifications
  interface Toast { id: string; message: string; type: 'success' | 'error' | 'info' }
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Workspace Terminal — File Import Log
  interface ImportLogEntry {
    id: string;
    timestamp: string;
    category: 'stl-scan' | 'prescription-doc' | 'prescription-text';
    fileName?: string;
    fileSize?: string;
    summary: string;
  }
  const [importLog, setImportLog] = useState<ImportLogEntry[]>([]);

  const addImportLog = (category: ImportLogEntry['category'], summary: string, fileName?: string, fileSize?: string) => {
    const entry: ImportLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toLocaleTimeString(),
      category,
      fileName,
      fileSize,
      summary,
    };
    setImportLog(prev => [...prev, entry]);
  };

  // Track imported patient files (metadata from patient scanner) for analysis submission
  const [importedPatientFiles, setImportedPatientFiles] = useState<Array<{
    name: string;
    relativePath: string;
    extension: string;
    size: number;
  }>>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // ── Import to Workstation: bring selected files from Patient Case Scanner into analysis form ──
  const handleImportToWorkstation = useCallback(() => {
    const selected = patientSyncState.files.filter(f => f.selected && !f.isDirectory);
    if (selected.length === 0) {
      showToast('No files selected in Patient Case Scanner. Select files first.', 'error');
      return;
    }

    const folderPath = patientSyncState.folderPath;
    if (!folderPath) {
      showToast('No patient folder connected.', 'error');
      return;
    }

    // Categorise and log each imported file
    const stlFiles: Array<{ name: string; relativePath: string; extension: string; size: number }> = [];
    const docFiles: Array<{ name: string; relativePath: string; extension: string; size: number }> = [];
    let textContent = '';

    for (const file of selected) {
      const ext = file.extension.toLowerCase();
      if (ext === '.stl') {
        stlFiles.push({ name: file.name, relativePath: file.relativePath, extension: file.extension, size: file.size });
        addImportLog('stl-scan', 'Imported from patient folder', file.name, file.sizeFormatted);
      } else if (ext === '.pdf' || ext === '.mp4' || ext === '.mov' || ext === '.avi' || ext === '.webm') {
        docFiles.push({ name: file.name, relativePath: file.relativePath, extension: file.extension, size: file.size });
        addImportLog('prescription-doc', 'Imported from patient folder', file.name, file.sizeFormatted);
      } else if (ext === '.txt' || ext === '.md') {
        // Text files — mark for content extraction
        textContent += `[Imported note: ${file.name}]\n`;
        addImportLog('prescription-text', 'Imported note from patient folder', file.name, file.sizeFormatted);
      } else {
        // Other files treated as prescription docs
        docFiles.push({ name: file.name, relativePath: file.relativePath, extension: file.extension, size: file.size });
        addImportLog('prescription-doc', 'Imported attachment from patient folder', file.name, file.sizeFormatted);
      }
    }

    // Store imported files for submission
    const allImported = [...stlFiles, ...docFiles];
    setImportedPatientFiles(allImported);

    // Append text notes to prescription text
    if (textContent) {
      setPrescriptionText(prev => {
        const clean = prev.trim();
        return clean ? `${clean}\n\n${textContent}` : textContent;
      });
    }

    showToast(`Imported ${allImported.length} file(s) to workstation`, 'success');
  }, [patientSyncState, addImportLog, showToast]);

  useEffect(() => {
    // Restore saved folder paths from localStorage
    if (typeof window !== "undefined") {
      const sanitize = (p: string) => {
        let s = p.replace(/["']+/g, '').trim();
        // Deduplicate — if the path appears concatenated twice, use first half
        if (s.length > 10) {
          const half = Math.floor(s.length / 2);
          if (s.substring(0, half) === s.substring(half)) {
            s = s.substring(0, half);
          }
        }
        return s;
      };
      const savedKB = localStorage.getItem("kbFolderPath");
      if (savedKB) setKbSyncState(prev => ({ ...prev, folderPath: sanitize(savedKB) }));
      const savedPatient = localStorage.getItem("patientFolderPath");
      if (savedPatient) setPatientSyncState(prev => ({ ...prev, folderPath: sanitize(savedPatient) }));
      const savedStorage = localStorage.getItem("storageFolderPath");
      if (savedStorage) setStorageSyncState(prev => ({ ...prev, folderPath: sanitize(savedStorage) }));
    }
  }, []);

  // API Key Management
  interface ApiKeyEntry { id: string; name: string; key: string; provider: string; active: boolean }
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [newKeyProvider, setNewKeyProvider] = useState("google-genai");
  const [savingApiKey, setSavingApiKey] = useState(false);

  const fetchApiKeys = async () => {
    try {
      const res = await fetch("/api/keys");
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.keys || []);
      }
    } catch { /* ignore */ }
  };

  const saveApiKey = async () => {
    if (!newKeyValue.trim() || !newKeyName.trim()) return;
    setSavingApiKey(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newKeyName.trim(),
          key: newKeyValue.trim(),
          provider: newKeyProvider
        })
      });
      if (res.ok) {
        await fetchApiKeys();
        setNewKeyName("");
        setNewKeyValue("");
        showToast("API key saved successfully.", "success");
      } else {
        showToast("Failed to save API key.", "error");
      }
    } catch {
      showToast("Network error saving API key.", "error");
    } finally {
      setSavingApiKey(false);
    }
  };

  const deleteApiKey = async (id: string) => {
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        setApiKeys(prev => prev.filter(k => k.id !== id));
        showToast("API key removed.", "info");
      }
    } catch { /* ignore */ }
  };

  const activateApiKey = async (id: string) => {
    try {
      const res = await fetch(`/api/keys/${id}/activate`, { method: "POST" });
      if (res.ok) {
        setApiKeys(prev => prev.map(k => ({ ...k, active: k.id === id })));
        showToast("API key activated.", "success");
      }
    } catch { /* ignore */ }
  };

  // AI Provider Registry — the multi-AI list format:
  // [ { "name":"DC-Hub AI", "vendor":"customendpoint", "apiKey":"...",
  //     "apiType":"chat-completions",
  //     "models":[ { "id":"...", "name":"...", "url":"https://.../chat/completions", ... } ] }, ... ]
  interface AiModelEntry { id: string; name?: string; url?: string; toolCalling?: boolean; vision?: boolean; maxInputTokens?: number; maxOutputTokens?: number }
  interface AiProviderEntry { id: string; name: string; vendor: string; apiType?: string; hasApiKey: boolean; models: AiModelEntry[]; active: boolean; priority?: number | null; activeModelId?: string }
  const [aiProviders, setAiProviders] = useState<AiProviderEntry[]>([]);
  const [aiProvidersJson, setAiProvidersJson] = useState("");
  const [aiProvidersError, setAiProvidersError] = useState("");
  const [registeringProviders, setRegisteringProviders] = useState(false);
  const [activatingProvider, setActivatingProvider] = useState<string | null>(null);
  const aiProviderFileInputRef = useRef<HTMLInputElement>(null);

  const fetchAiProviders = async () => {
    try {
      const res = await fetch("/api/ai/providers");
      if (res.ok) {
        const data = await res.json();
        setAiProviders(data.providers || []);
      }
    } catch { /* ignore */ }
  };

  // Detect & register the pasted provider list
  const registerAiProviders = async () => {
    setRegisteringProviders(true);
    setAiProvidersError("");
    try {
      const trimmed = aiProvidersJson.trim();
      if (!trimmed) {
        setAiProvidersError("Paste a JSON list of AI providers first.");
        setRegisteringProviders(false);
        return;
      }
      const res = await fetch("/api/ai/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: trimmed }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiProviders(data.providers || []);
        showToast(`Detected ${data.activatedCount || 0} AI provider(s) from ${data.format || "the config"} and activated them.`, "success");
      } else {
        const err = await res.text().catch(() => "");
        setAiProvidersError(err || "Failed to register providers.");
        showToast("Failed to register providers.", "error");
      }
    } catch {
      setAiProvidersError("Invalid JSON — check the syntax and try again.");
      showToast("Invalid JSON.", "error");
    } finally {
      setRegisteringProviders(false);
    }
  };

  const importAiProviderFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setAiProvidersError("AI configuration files must be 5 MB or smaller.");
      return;
    }
    try {
      setAiProvidersJson(await file.text());
      setAiProvidersError("");
      showToast(`${file.name} loaded. Click Detect & Activate to apply it.`, "success");
    } catch {
      setAiProvidersError("Could not read that configuration file as text.");
    } finally {
      if (aiProviderFileInputRef.current) aiProviderFileInputRef.current.value = "";
    }
  };

  const activateProvider = async (id: string, modelId?: string) => {
    setActivatingProvider(id);
    try {
      const res = await fetch(`/api/ai/providers/${encodeURIComponent(id)}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modelId ? { modelId } : {}),
      });
      if (res.ok) {
        await fetchAiProviders();
        const p = aiProviders.find(x => x.id === id);
        const activeCount = aiProviders.filter(x => x.active).length;
        showToast(
          `Activated ${p ? p.name : id} — ${activeCount === 0 ? "it's now the PRIMARY AI" : `added to the active set (${activeCount + 1} active total).`}`,
          "success"
        );
      } else {
        const err = await res.text().catch(() => "");
        setAiProvidersError(err || "Failed to activate.");
        showToast("Failed to activate provider.", "error");
      }
    } catch {
      showToast("Network error activating provider.", "error");
    } finally {
      setActivatingProvider(null);
    }
  };

  const deactivateProvider = async (id: string) => {
    const p = aiProviders.find(x => x.id === id);
    try {
      const res = await fetch(`/api/ai/providers/${encodeURIComponent(id)}/deactivate`, { method: "POST" });
      if (res.ok) {
        await fetchAiProviders();
        const remaining = aiProviders.filter(x => x.active && x.id !== id).length;
        showToast(
          `Deactivated ${p ? p.name : id} — ${remaining === 0 ? "no registry AIs active (falls back to simple Gemini config)." : `${remaining} AI(s) still active.`}`,
          "info"
        );
      }
    } catch { /* ignore */ }
  };

  const setProviderPriority = async (id: string, priority: number) => {
    try {
      const res = await fetch(`/api/ai/providers/${encodeURIComponent(id)}/priority`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      if (res.ok) await fetchAiProviders();
    } catch { /* ignore */ }
  };

  const selectProviderModel = async (id: string, modelId: string) => {
    // Model change on an already-active provider just updates the selection
    const p = aiProviders.find(x => x.id === id);
    if (p && p.active) {
      try {
        await fetch(`/api/ai/providers/${encodeURIComponent(id)}/activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId }),
        });
        await fetchAiProviders();
      } catch { /* ignore */ }
    } else {
      await activateProvider(id, modelId);
    }
  };

  const removeProvider = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        await fetchAiProviders();
        showToast("Provider removed.", "info");
      }
    } catch { /* ignore */ }
  };

  // Core Memory Prompt states
  const [coreMemory, setCoreMemory] = useState<{ chatInstructions: string; analysisInstructions: string }>({
    chatInstructions: "",
    analysisInstructions: ""
  });
  const [chatInstructionsInput, setChatInstructionsInput] = useState("");
  const [analysisInstructionsInput, setAnalysisInstructionsInput] = useState("");
  const [savingCoreMemory, setSavingCoreMemory] = useState(false);

  const fetchCoreMemory = async () => {
    try {
      const res = await fetch("/api/core-memory");
      if (res.ok) {
        const data = await res.json();
        setCoreMemory(data);
        setChatInstructionsInput(data.chatInstructions);
        setAnalysisInstructionsInput(data.analysisInstructions);
      }
    } catch (e) {
      console.error("Failed to fetch core memory:", e);
    }
  };

  // Save folder paths to localStorage when they change
  useEffect(() => {
    if (typeof window !== "undefined" && kbSyncState.folderPath) {
      localStorage.setItem("kbFolderPath", kbSyncState.folderPath);
    }
  }, [kbSyncState.folderPath]);

  useEffect(() => {
    if (typeof window !== "undefined" && patientSyncState.folderPath) {
      localStorage.setItem("patientFolderPath", patientSyncState.folderPath);
    }
  }, [patientSyncState.folderPath]);

  useEffect(() => {
    if (typeof window !== "undefined" && storageSyncState.folderPath) {
      localStorage.setItem("storageFolderPath", storageSyncState.folderPath);
    }
  }, [storageSyncState.folderPath]);

  const handleSaveCoreMemory = async () => {
    setSavingCoreMemory(true);
    try {
      const res = await fetch("/api/core-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatInstructions: chatInstructionsInput,
          analysisInstructions: analysisInstructionsInput
        })
      });
      if (res.ok) {
        setCoreMemory({
          chatInstructions: chatInstructionsInput,
          analysisInstructions: analysisInstructionsInput
        });
        showToast("Core Memory guidelines saved and applied to AI model.", "success");
      } else {
        showToast("Failed to save Core Memory.", "error");
      }
    } catch (e) {
      showToast("Network error saving Core Memory.", "error");
    } finally {
      setSavingCoreMemory(false);
    }
  };

  // ── Knowledge Resources: Process pasted text + links ─────────────────
  const handleProcessKnowledge = async () => {
    if (!knowledgeText.trim()) return;
    setProcessingKnowledge(true);
    setKnowledgeResources([]);

    try {
      // Count URLs in the text for immediate feedback
      // Matches: protocol URLs, bare www. URLs, and bare subdomain.domain.tld URLs
      const urlRegex = /https?:\/\/(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>{}|\\^`[\]]*)?|(?:^|\s)(www\.(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>{}|\\^`[\]]*)?)|(?:^|\s)((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+(?:com|org|net|edu|gov|io|co|int|mil|info|biz|app|dev|ai|me|tv|uk|de|jp|au|fr|ca|it|es|nl|br|in|ru|cn|nz|se|no|fi|dk|pl|be|at|ch|kr|hk|sg|my|ph|th|za|mx|ar|cl|pt|gr|ie|hu|cz|ro|il|eu|us)(?:\/[^\s<>{}|\\^`[\]]*)?)/gi;
      const urls = knowledgeText.match(urlRegex) || [];
      const folderPath = kbSyncState.folderPath || storageSyncState.folderPath || '';

      showToast(`Processing ${urls.length} URL(s) and text content...`, 'info');

      const res = await fetch('/api/knowledge/process-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: knowledgeText,
          folderPath,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process knowledge');

      if (data.resources) {
        setKnowledgeResources(data.resources);
        setTotalResourcesGathered(prev => prev + data.totalResources);
      }

      showToast(
        `✅ Processed ${data.totalResources} resource(s) — ${data.urlCount} URL(s) analyzed. Knowledge saved to AI knowledge base.`,
        'success'
      );
      setKnowledgeText('');
    } catch (err: any) {
      showToast(`Failed to process: ${err.message || 'Unknown error'}`, 'error');
    } finally {
      setProcessingKnowledge(false);
    }
  };

  // ── Auto-Learning: Autonomous online research ────────────────────────
  const handleAutoLearn = async () => {
    if (autoLearning) return;
    setAutoLearning(true);
    setAutoLearningStatus(quickLearn ? 'Quick-learning in progress...' : 'Generating research plan...');
    setAutoLearningQueries([]);

    try {
      const context = `
Current Core Memory (Chat Instructions):
${chatInstructionsInput.slice(0, 2000)}

Current Core Memory (Analysis Instructions):
${analysisInstructionsInput.slice(0, 2000)}

Cases Analyzed: ${historyCases.length}
RAG Enabled: ${useClinicalRAG}
Reference Library Connected: ${kbSyncState.complete ? 'Yes' : 'No'}
`;
      const folderPath = kbSyncState.folderPath || storageSyncState.folderPath || '';

      const res = await fetch('/api/knowledge/auto-learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context,
          folderPath,
          coreMemoryContext: analysisInstructionsInput.slice(0, 4000),
          quickLearn, // true = fewer topics, shallow research; false = deep, comprehensive research
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auto-learning failed');

      if (data.queries) {
        setAutoLearningQueries(data.queries);
      }
      setAutoLearningStatus(`Researching ${data.totalQueries || 0} topic(s)...`);

      showToast(
        quickLearn
          ? `⚡ Quick-learn: ${data.totalQueries || 0} topic(s) — fast overview in progress.`
          : `🧠 Auto-learning started: ${data.totalQueries || 0} research topic(s) being investigated. Results will be saved to knowledge base and core memory.`,
        'success'
      );

      // Poll for completion — shorter timeout for quick learn
      const completionDelay = quickLearn ? 6000 : 15000;
      const completionTimer = setTimeout(async () => {
        setAutoLearningStatus('Finalizing research & updating core memory...');
        // Re-fetch core memory to show any auto-updates
        await fetchCoreMemory();
        setAutoLearningStatus(quickLearn ? 'Quick-learn complete!' : 'Auto-learning complete!');
        showToast(quickLearn ? '⚡ Quick-learn complete!' : '🧠 Auto-learning complete! Core memory updated with new research findings.', 'success');
        setAutoLearning(false);
      }, completionDelay);
      // Store timer ref for cleanup on unmount
      if (typeof window !== 'undefined') {
        const cleanupKey = `_autoLearnTimer_${Date.now()}`;
        (window as any)[cleanupKey] = completionTimer;
        // Auto-cleanup after max delay
        setTimeout(() => { delete (window as any)[cleanupKey]; }, completionDelay + 1000);
      }
    } catch (err: any) {
      showToast(`Auto-learning failed: ${err.message || 'Unknown error'}`, 'error');
      setAutoLearning(false);
      setAutoLearningStatus('');
    }
  };

  useEffect(() => {
    fetchCoreMemory();
    fetchApiKeys();
    fetchAiProviders();
  }, []);

  // Background polling for Keep in Sync
  useEffect(() => {
    if (!keepInSync || !kbSyncState.complete) return;
    
    let shownActive = false;
    
    const interval = setInterval(async () => {
      if (!shownActive) {
        showToast("Background Sync is active. Monitoring for changes...", "info");
        shownActive = true;
      }
    }, 12000);
    
    return () => clearInterval(interval);
  }, [keepInSync, kbSyncState.complete]);
  
  const prescriptionFilesRef = useRef<HTMLInputElement>(null);

  const getDetectedAppliance = () => {
    const text = prescriptionText.toLowerCase();
    if (text.includes("essix") || text.includes("clear") || text.includes("thermoform")) {
      return "Essix";
    }
    if (text.includes("hawley") || text.includes("acrylic") || text.includes("wire") || text.includes("bow")) {
      return "Hawley";
    }
    return "Other";
  };

  const detectedAppliance = getDetectedAppliance();

  const getSuggestedMaterial = () => {
    if (detectedAppliance === "Essix") {
      return "PETG 1.0mm Thermoforming Sheet";
    }
    if (detectedAppliance === "Hawley") {
      return "PMMA Acrylic Baseplate + 0.7mm Stainless Steel Labial Bow";
    }
    return "PETG 1.0mm Thermoforming Sheet";
  };

  const checkMaterialCompliance = () => {
    if (detectedAppliance === "Essix") {
      if (selectedMaterial.includes("PETG")) {
        return { valid: true, message: "Material is fully compliant with Essix retainer guidelines." };
      }
      return { 
        valid: false, 
        message: "Rule Violation: Essix retainers are vacuum thermoformed clear plastic sheets. Acrylic baseplates or wires are invalid." 
      };
    }
    if (detectedAppliance === "Hawley") {
      if (selectedMaterial.includes("Acrylic") || selectedMaterial.includes("PMMA")) {
        return { valid: true, message: "Material and hardware are fully compliant with Hawley guidelines." };
      }
      return { 
        valid: false, 
        message: "Rule Violation: Hawley retainers require an acrylic PMMA baseplate and stainless steel wire bow. PETG sheets are invalid." 
      };
    }
    return { valid: true, message: "Custom or unspecified appliance type. Verify manual specification." };
  };

  const compliance = checkMaterialCompliance();

  // Auto-suggest action
  const handleApplySuggestedMaterial = () => {
    const suggestion = getSuggestedMaterial();
    setSelectedMaterial(suggestion);
    
    // Also append to prescription text if not already there
    if (!prescriptionText.toLowerCase().includes(suggestion.toLowerCase())) {
      setPrescriptionText(prev => {
        const clean = prev.trim();
        return clean ? `${clean}\nMaterial specification: ${suggestion}.` : `Material specification: ${suggestion}.`;
      });
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Window-level drag & drop fallback ──────────────────────────────────
  // Prevents the browser from navigating away when files are dropped just
  // outside a drop zone (the #1 real-world cause of "drag & drop does
  // nothing"). Any drop that wasn't already handled by a zone's own onDrop
  // (they stopPropagation) lands here and is routed by file type.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      // Chromium exposes 'Files' in types; Firefox may list the actual
      // file extension types instead. Either way a drag without any type
      // is not a file drag (e.g. selected text being moved inside inputs).
      return !!types && (Array.from(types).includes('Files') || types.length > 0);
    };
    const onWindowDragOver = (e: DragEvent) => {
      // Allow the drop: without this the browser shows a "no-drop" cursor
      // and silently rejects the drop anywhere on the page.
      if (hasFiles(e)) e.preventDefault();
    };
    const onWindowDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const dt = e.dataTransfer;
      if (!dt) return;
      const stlFiles: File[] = [];
      const docFiles: File[] = [];
      for (const f of Array.from(dt.files)) {
        if (f && typeof f.size === 'number' && f.size > 0) {
          if (f.name.toLowerCase().endsWith('.stl')) stlFiles.push(f);
          else docFiles.push(f);
        }
      }
      if (stlFiles.length > 0) {
        setSelectedFiles((prev) => [...prev, ...stlFiles]);
      }
      if (docFiles.length > 0) {
        setPrescriptionFiles((prev) => [...prev, ...docFiles]);
      }
      if (stlFiles.length > 0 || docFiles.length > 0) {
        showToast(`Imported ${stlFiles.length + docFiles.length} file(s) from drag & drop.`);
      }
    };
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, []);

  // Load history from backend whenever authenticated user changes
  useEffect(() => {
    if (auth.user) {
      fetchHistory();
    } else {
      setHistoryCases([]);
      setActiveCaseId(null);
      setActiveResult(null);
      setPrescriptionText("");
    }
  }, [auth.user?.id]);

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/history");
      if (res.ok) {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await res.json();
          setHistoryCases(data);
          return data;
        } else {
          console.warn("Expected JSON from /api/history but got:", contentType);
        }
      }
    } catch (e) {
      console.error("Failed to fetch case history:", e);
    }
    return [];
  };

  const handleSelectCase = async (c: DentalCase) => {
    setActiveCaseId(c.id);
    setPrescriptionText(c.prescriptionText);
    setActiveResult(c.result ?? null);
    setCurrentTab("workspace");

    // Prefill the workspace form with the case's files (scans + attachments)
    const stlFiles: File[] = [];
    const attachmentFiles: File[] = [];
    for (const f of c.files || []) {
      if (!f.url || f.url.startsWith("file://")) continue; // file:// paths aren't fetchable from the browser
      try {
        const res = await fetch(f.url);
        if (!res.ok) continue;
        const blob = await res.blob();
        const file = new File([blob], f.name, {
          type: f.mimeType || blob.type || "application/octet-stream",
        });
        if (f.isAttachment) attachmentFiles.push(file);
        else stlFiles.push(file);
      } catch (e) {
        console.warn(`Failed to load history file ${f.name}:`, e);
      }
    }
    setSelectedFiles(stlFiles);
    setPrescriptionFiles(attachmentFiles);
  };

  const handleDeleteCase = async (id: string) => {
    try {
      const res = await fetch(`/api/history/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setHistoryCases((prev) => prev.filter((item) => item.id !== id));
        if (activeCaseId === id) {
          setActiveResult(null);
          setActiveCaseId(null);
        }
      }
    } catch (e) {
      console.error("Failed to delete case:", e);
    }
  };

  const handleUpdateCase = async (updatedResult: AnalysisResult, newStatus?: "pending" | "processed" | "confirmed" | "failed") => {
    if (!activeCaseId) return;
    try {
      const currentCase = historyCases.find((c) => c.id === activeCaseId);
      if (!currentCase) return;

      const payload = {
        result: updatedResult,
        status: newStatus || currentCase.status
      };

      const res = await fetch(`/api/history/${activeCaseId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setHistoryCases((prev) => 
          prev.map((c) => 
            c.id === activeCaseId 
              ? { ...c, result: updatedResult, status: (newStatus || c.status) as any } 
              : c
          )
        );
        setActiveResult(updatedResult);
      } else {
        console.error("Failed to update case on server");
      }
    } catch (e) {
      console.error("Error updating case:", e);
    }
  };

  // Drag and Drop File Handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear the highlight when actually leaving the zone (not when
    // moving between child elements inside it).
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  // Enhanced drop handler: supports files and folders (recursively)
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    try {
      const items = e.dataTransfer.items;
      if (items && items.length > 0) {
        const files = (await getFilesFromDataTransferItems(items)).filter((f) => typeof f.size === 'number' && f.size > 0);
        if (files.length > 0) {
          setSelectedFiles((prev) => [...prev, ...files]);
          return;
        }
      }
      if (e.dataTransfer.files) {
        const filesArray = Array.from(e.dataTransfer.files).filter((f) => typeof f.size === 'number' && f.size > 0);
        if (filesArray.length > 0) {
          setSelectedFiles((prev) => [...prev, ...filesArray]);
        }
      }
    } catch (err) {
      console.warn('Error handling drop:', err);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      setSelectedFiles((prev) => [...prev, ...filesArray]);
    }
  };

  // Same helper for prescription drops
  const handlePrescriptionDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPrescriptionDragOver(false);
    try {
      const items = e.dataTransfer.items;
      if (items && items.length > 0) {
        const files = (await getFilesFromDataTransferItems(items)).filter((f) => typeof f.size === 'number' && f.size > 0);
        if (files.length > 0) {
          setPrescriptionFiles((prev) => [...prev, ...files]);
          return;
        }
      }
      if (e.dataTransfer.files) {
        const filesArray = Array.from(e.dataTransfer.files).filter((f) => typeof f.size === 'number' && f.size > 0);
        if (filesArray.length > 0) {
          setPrescriptionFiles((prev) => [...prev, ...filesArray]);
        }
      }
    } catch (err) {
      console.warn('Error handling prescription drop:', err);
    }
  };

  const handlePrescriptionDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPrescriptionDragOver(true);
  };

  const handlePrescriptionDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPrescriptionDragOver(true);
  };

  const handlePrescriptionDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsPrescriptionDragOver(false);
    }
  };

  const handlePrescriptionFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      setPrescriptionFiles((prev) => [...prev, ...filesArray]);
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const removePrescriptionFile = (index: number) => {
    setPrescriptionFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Helper to extract File objects from DataTransferItemList, including folders
  async function getFilesFromDataTransferItems(items: DataTransferItemList): Promise<File[]> {
    const files: File[] = [];

    // ⚠ CRITICAL: webkitGetAsEntry() / getAsFile() are ONLY valid SYNCHRONOUSLY
    // during the drop event. If we await between items, every item after the
    // first silently returns null — multi-file drops lose files #2, #3, #4…
    // So snapshot ALL entries synchronously first, then traverse them async.
    const entries: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      let entry: any = null;
      try {
        entry = (item as any).webkitGetAsEntry ? (item as any).webkitGetAsEntry() : null;
      } catch { /* some engines throw; ignore */ }
      if (!entry) {
        // Fallback: get file directly (also must happen synchronously)
        try {
          const f = (item as any).getAsFile ? (item as any).getAsFile() : null;
          if (f) {
            files.push(f);
            continue;
          }
        } catch { /* ignore */ }
      }
      if (entry) entries.push(entry);
    }

    // Traverse FileSystemEntry (webkitGetAsEntry) recursively
    async function traverseEntry(entry: any) {
      if (!entry) return;
      if (entry.isFile) {
        await new Promise<void>((resolve) => {
          entry.file((f: File) => {
            files.push(f);
            resolve();
          }, () => resolve());
        });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const readEntries = () => new Promise<void>((resolve) => {
          reader.readEntries(async (entries: any[]) => {
            if (!entries || entries.length === 0) { resolve(); return; }
            for (const ent of entries) {
              await traverseEntry(ent);
            }
            // Some implementations return partial results; keep reading until empty
            await readEntries();
            resolve();
          }, () => resolve());
        });
        await readEntries();
      }
    }

    for (const entry of entries) {
      await traverseEntry(entry);
    }

    return files;
  }

  const clearForm = () => {
    setPrescriptionText("");
    setSelectedFiles([]);
    setPrescriptionFiles([]);
    setError(null);
    setImportLog([]);
  };

  // Quick preset templates to assist lab technicians with testing
  const presets = [
    {
      label: "Standard Upper Essix",
      text: "Standard Upper Arch Essix retainer. Please use 1.0mm clear PETG thermoforming material. Ensure full coverage up to the second molars, and scalloped trim line 1-2mm above the gingival margin. Block out labial undercuts around anterior incisors.",
    },
    {
      label: "Lower Hawley Retainer",
      text: "Lower Hawley retainer with high gloss acrylic baseplate. Incorporate a standard 0.7mm stainless steel labial bow wire canine to canine. Adams clasps optional on first molars for posterior retention. Lingual flange coverage.",
    },
    {
      label: "Dual Arch Essix (Thin)",
      text: "Provide clear Essix retainers for BOTH upper and lower arches. Use thin 0.75mm thermoforming material for high patient comfort. Trim precisely along the gumline with standard labial frenum relief areas.",
    },
    {
      label: "Prescription with Issues (Warnings Check)",
      text: "Thermoformed clear retainer please. (Missing: material thickness, which arch, and has contradictory requests for wire bow in Essix). Note: upper scan was slightly bubbles-distorted on the distal molar surface.",
    }
  ];

  const applyPreset = (text: string) => {
    setPrescriptionText(text);
    setError(null);
  };

  // Submit and analyze
  const handleAnalyze = async (e?: React.FormEvent) => {
    if (e?.preventDefault) {
      e.preventDefault();
    }
    // Prevent concurrent analysis runs
    if (analyzingRef.current) return;
    setError(null);

    if (!prescriptionText.trim() && selectedFiles.length === 0 && prescriptionFiles.length === 0 && importedPatientFiles.length === 0) {
      setError("Please specify prescription instructions, upload an STL dental scan, add reference attachment files, or import files from the Patient Case Scanner.");
      return;
    }

    analyzingRef.current = true;
    setAnalyzing(true);
    setAnalysisStep(0); // Start: Uploading
    setActiveResult(null); // Clear previous results so progress panel shows
      setImportLog([]); // Clear import log on new submission
      setImportedPatientFiles([]); // Clear imported files

    const analyzeStartTime = Date.now();

    // ── Security scans before analysis ──────────────────────────────────
    setScanResults({ antivirus: null, antibug: null, scanning: true });
    const abResults: { scanned: boolean; issuesFound: number; fixesApplied: number; fixes: string[]; issues: { file: string; line: number; message: string; severity: string; code?: string }[] } = { scanned: false, issuesFound: 0, fixesApplied: 0, fixes: [], issues: [] };

    // Antivirus: server-side scan of uploaded files (handled in /api/analyze-case)
    // just pass the enabled flag in the form data so the server knows to scan

    // Antibug: scan source code for bugs and auto-fix
    if (antibugEnabled) {
      try {
        const resp = await fetch("/api/security/antibug", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceRoot: '' }), // empty = server uses cwd
        });
        const data = await resp.json();
        if (data.success) {
          abResults.scanned = true;
          abResults.issuesFound = data.issuesFound || 0;
          abResults.fixesApplied = data.fixesApplied || 0;
          abResults.fixes = data.fixes || [];
          abResults.issues = (data.issues || []).map((i: any) => ({
            file: i.file, line: i.line, message: i.message, severity: i.severity, code: i.code,
          }));
        }
      } catch (e) {
        console.warn("[Security] Antibug scan error:", e);
      }
    }

    setScanResults({ antivirus: null, antibug: abResults, scanning: false });

    // Advance steps every 800ms for quick visual progress through all stages (5 steps ≈ 4s).
    // Server response overrides with exact step when it arrives (never goes backward).
    const stepInterval = window.setInterval(() => {
      setAnalysisStep(prev => {
        if (prev < 0) return 0;
        const lastStep = ANALYSIS_STEPS.length - 1;
        if (prev >= lastStep) return lastStep;
        return prev + 1;
      });
    }, 800);
    // Steps advance roughly: 0 at 0s, 1 at 0.8s, 2 at 1.6s, 3 at 2.4s, 4 at 3.2s

    try {
      const formData = new FormData();
      formData.append("prescriptionText", prescriptionText);
      formData.append("antivirusEnabled", antivirusEnabled ? "true" : "false");
      selectedFiles.forEach((file) => {
        formData.append("stlFiles", file);
      });
      prescriptionFiles.forEach((file) => {
        formData.append("prescriptionFiles", file);
      });

      // Include imported patient files from folder sync
      if (patientSyncState.folderPath && importedPatientFiles.length > 0) {
        formData.append("importedFolderPath", patientSyncState.folderPath);
        formData.append("importedFiles", JSON.stringify(importedPatientFiles));
      }

      // Include Connected Reference Library path so server can read sample treatment plans
      if (kbSyncState.folderPath) {
        formData.append("referenceLibraryPath", kbSyncState.folderPath);
      }

      // Validate file sizes: prevent submitting files that are 0 bytes
      const emptyFile = selectedFiles.concat(prescriptionFiles).find(f => f && typeof (f as File).size === 'number' && (f as File).size === 0) || importedPatientFiles.find(f => f && typeof f.size === 'number' && f.size === 0);
      if (emptyFile) {
        setError('One or more selected files appear to be empty (0 bytes). Please re-upload the files.');
        analyzingRef.current = false;
        setAnalyzing(false);
        window.clearInterval(stepInterval);
        return;
      }

      const apiBase = getApiBase();
      const response = await fetch(`${apiBase}/api/analyze-case`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errMsg = "Failed to analyze retainer case.";
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errData = await response.json();
            errMsg = errData.error || errMsg;
          } else {
            const text = await response.text();
            if (text.includes("<title>")) {
              const titleMatch = text.match(/<title>([\s\S]*?)<\/title>/i);
              if (titleMatch && titleMatch[1]) {
                errMsg = `Server Error: ${titleMatch[1].trim()}`;
              } else {
                errMsg = "Server returned an HTML error page. Please check that the server is online.";
              }
            } else {
              errMsg = text.slice(0, 150) || errMsg;
            }
          }
        } catch (e) {
          console.error("Error reading error response:", e);
        }
        throw new Error(errMsg);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server did not return a valid JSON response. Please check server logs.");
      }

      // Progress: validating (never go backwards — interval may have advanced further)
      setAnalysisStep(prev => Math.max(prev, 3));
      await new Promise(r => setTimeout(r, 300));

      const result: AnalysisResult = await response.json();
      
      // Capture antivirus scan results from server response
      if ((result as any).antivirusScan && Array.isArray((result as any).antivirusScan)) {
        const avScan = (result as any).antivirusScan as { file: string; safe: boolean; threats: string[]; deleted: boolean }[];
        const infected = avScan.filter(s => !s.safe);
        if (infected.length > 0) {
          setScanResults(prev => ({
            ...prev,
            antivirus: {
              scanned: true,
              safe: false,
              threats: infected.reduce((sum, f) => sum + f.threats.length, 0),
              threatDetails: infected.flatMap(f => f.threats.map(t => `[${f.file}] ${t}`)),
              deleted: infected.every(f => f.deleted),
              file: infected.map(f => f.file).join(', '),
            },
          }));
        }
      }
      
      // Progress: generating spec
      setAnalysisStep(prev => Math.max(prev, 4));
      await new Promise(r => setTimeout(r, 500));

      setActiveResult(result);

      // ── Share the generated treatment plan with the Agliner Rx tab ──
      if (result.treatment_plan) {
        try {
          localStorage.setItem('wsGeneratedRx', result.treatment_plan);
        } catch { /* ignore storage errors */ }
      }

      // ── Domino: auto-run Agliner segmentation on the uploaded STLs ──
      // Main AI completes → segmentation runs → segmented teeth land in the
      // shared storage folder → Ortho picks them up automatically.
      const uploadedStls = ((result as any).files || [])
        .filter((f: any) => !f.isAttachment && String(f.url || '').startsWith('/uploads/') && String(f.url).toLowerCase().endsWith('.stl'))
        .map((f: any) => ({ name: f.name, url: f.url }));
      if (uploadedStls.length > 0) {
        try {
          await fetch(`${apiBase}/api/agliner/pipeline-on-uploads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              files: uploadedStls,
              prescription: (result as any).treatment_plan || prescriptionText,
            }),
          });
        } catch (segErr) {
          console.warn('[Domino] Auto segmentation trigger failed:', segErr);
        }
      }

      // ── Auto-save analysis result to storage folder (if configured) ──
      if (storageSyncState.folderPath) {
        try {
          const sessionId = `session_${Date.now()}`;
          // Save final analysis result permanently
          await saveAnalysisToStorage(storageSyncState.folderPath, activeCaseId || 'case', result as unknown as Record<string, unknown>);
          // Save temp working data
          await saveTempToStorage(storageSyncState.folderPath, sessionId, {
            prescriptionText,
            result,
            timestamp: new Date().toISOString(),
          }, 'working-data.json');
          showToast('Analysis saved to storage folder', 'success');
        } catch (saveErr) {
          console.warn('Failed to auto-save to storage:', saveErr);
        }
      }

      // Retrieve new case ID by refetching history
      const updatedHistory = await fetchHistory();
      // Set the active case ID to the newest case
      const newestCase = updatedHistory[0];
      if (newestCase) {
        setActiveCaseId(newestCase.id);
      }
      
      // Clear files after successful upload/submission
      setSelectedFiles([]);
      setPrescriptionFiles([]);
      setImportLog([]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred. Please try again.");
    } finally {
      analyzingRef.current = false;
      // Ensure the progress panel is visible for at least 1.5s to avoid flashing
      const elapsed = Date.now() - analyzeStartTime;
      if (elapsed < 1500) {
        await new Promise(r => setTimeout(r, 1500 - elapsed));
      }
      setAnalyzing(false);
      window.clearInterval(stepInterval);
    }
  };

  // Format file sizes elegantly
  const formatBytes = (bytes?: number) => {
    if (!bytes || typeof bytes !== 'number' || isNaN(bytes)) return "0 Bytes";
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const idx = Math.min(i, sizes.length - 1);
    return Number.parseFloat((bytes / (k ** idx)).toFixed(2)) + " " + sizes[idx];
  };

  // ── Auth gate ─────────────────────────────────────────────────────────
  if (auth.loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-[#46c0bd]/20 border-t-[#46c0bd] animate-spin" />
        <p className="text-sm text-slate-500 font-medium">Connecting to server...</p>
      </div>
    );
  }

  if (!auth.user) {
    return (
      <LoginPage
        needsSetup={auth.needsSetup}
        onLogin={auth.login}
        onSetupAdmin={auth.setupAdmin}
      />
    );
  }

  const isAdmin = auth.user.role === "admin";
  const analysisEnabled = auth.enabledPacks.includes("analysis");

  // Navigation items for the left hamburger drawer
  const navItems: {
    id: "workspace" | "cheatsheet" | "local" | "storage" | "ai-manager" | "admin";
    label: string;
    icon: React.ReactNode;
    adminOnly?: boolean;
  }[] = [
    { id: "workspace", label: "Workspace Terminal", icon: <Terminal className="w-4 h-4" /> },
    { id: "cheatsheet", label: "Manufacturing Rules Cheatsheet", icon: <BookOpen className="w-4 h-4" /> },
    { id: "ai-manager", label: "AI Manager", icon: <Sparkles className="w-4 h-4" />, adminOnly: true },
    { id: "local", label: "Local Folder Sync", icon: <Database className="w-4 h-4" />, adminOnly: true },
    { id: "storage", label: "Storage", icon: <Archive className="w-4 h-4" />, adminOnly: true },
    { id: "admin", label: "Admin Panel", icon: <ShieldCheck className="w-4 h-4" />, adminOnly: true },
  ];

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white font-sans flex flex-col antialiased">
      {/* Floating Toast Notifications */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-xl shadow-lg border flex items-start gap-3 transition-all duration-300 ${
              toast.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : toast.type === "error"
                ? "bg-rose-50 border-rose-200 text-rose-800"
                : "bg-cyan-50 border-cyan-200 text-cyan-800"
            }`}
          >
            {toast.type === "success" ? (
              <span className="text-emerald-500 font-bold text-lg leading-none">✓</span>
            ) : toast.type === "error" ? (
              <span className="text-rose-500 font-bold text-lg leading-none">⚠</span>
            ) : (
              <span className="text-cyan-500 font-bold text-lg leading-none">ℹ</span>
            )}
            <div className="text-xs font-medium leading-relaxed">{toast.message}</div>
          </div>
        ))}
      </div>

      {/* Dental Lab Industrial Style Header — hamburger nav for tablets/mobile */}
      <header className="bg-[#46c0bd] border-b border-[#3ba6a3] py-3 px-4 md:px-6 shadow-sm shrink-0 print:hidden z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className="p-2 rounded-lg text-white hover:bg-white/10 active:bg-white/15 transition-colors cursor-pointer shrink-0"
              aria-label="Open navigation menu"
              title="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <AlignerLogo iconOnly={true} className="text-white shrink-0" />
            <div className="h-8 w-[1px] bg-white/20 hidden sm:block shrink-0"></div>
            <div className="min-w-0 hidden sm:block">
              <h1 className="text-lg font-bold text-white tracking-tight truncate">Whitesmile Clear</h1>
              <p className="text-[11px] text-white/80 mt-0.5 font-medium tracking-wide truncate">Orthodontic Design Studio</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 text-white">
              <UserRound className="w-4 h-4 text-white/70" />
              <div className="leading-tight hidden sm:block">
                <span className="text-xs font-bold block">{auth.user.username}</span>
                <span className="text-[9px] text-white/70 block">
                  {auth.company ? auth.company.name : isAdmin ? "Administrator" : "No company"}
                </span>
              </div>
            </div>
            <button
              onClick={async () => {
                await auth.logout();
                setCurrentTab("workspace");
              }}
              className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Tablet / Mobile Left Nav Drawer (hamburger) — about 1/4–1/3 screen width */}
      <div
        className={`fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm transition-opacity duration-200 ${
          navOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`fixed inset-y-0 left-0 z-[70] w-72 max-w-[85vw] bg-slate-900 border-r border-slate-800 shadow-2xl transform transition-transform duration-300 ease-out flex flex-col ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Main navigation"
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <AlignerLogo iconOnly={false} className="text-[#46c0bd]" />
          </div>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            aria-label="Close navigation menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav items — touch friendly */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-1">
          {navItems
            .filter((ni) => !ni.adminOnly || isAdmin)
            .map((ni) => (
              <button
                key={ni.id}
                type="button"
                onClick={() => {
                  setCurrentTab(ni.id);
                  setNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer text-left ${
                  currentTab === ni.id
                    ? "bg-[#46c0bd]/15 text-[#46c0bd] border border-[#46c0bd]/30"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white border border-transparent"
                }`}
              >
                <span className="shrink-0">{ni.icon}</span>
                <span className="truncate">{ni.label}</span>
              </button>
            ))}
        </nav>

        {/* Drawer footer — current user + sign out */}
        <div className="p-4 border-t border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#46c0bd]/20 text-[#46c0bd] flex items-center justify-center font-bold shrink-0">
              {auth.user.username.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{auth.user.username}</p>
              <p className="text-[11px] text-slate-400 truncate">
                {auth.company ? auth.company.name : isAdmin ? "Administrator" : "No company"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              await auth.logout();
              setCurrentTab("workspace");
              setNavOpen(false);
            }}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-sm font-semibold transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </div>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 flex flex-col lg:flex-row gap-8 overflow-hidden print:block print:p-0 print:m-0 print:max-w-none">
        
        {/* Left Hand: History Sidebar (Workspace only) */}
        {currentTab === "workspace" && (
          <section className="w-full lg:w-80 shrink-0 print:hidden flex flex-col gap-2" id="sidebar-section">
            {isAdmin && (
              <div className="shrink-0">
                <SystemsStatusCard />
              </div>
            )}

            <div className="shrink-0">
              <CaseHistory
                cases={historyCases}
                onSelectCase={handleSelectCase}
                onDeleteCase={handleDeleteCase}
                activeCaseId={activeCaseId || undefined}
              />
            </div>

            {/* Persistent analysis status footer */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs shrink-0">
              <button
                onClick={() => setSidebarAnalysisOpen(!sidebarAnalysisOpen)}
                className="w-full px-5 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-100 transition-colors"
                title={sidebarAnalysisOpen ? 'Collapse' : 'Expand'}
              >
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  Analysis Status
                </span>
                <span className={`text-slate-400 text-[10px] transition-transform ${sidebarAnalysisOpen ? 'rotate-180' : ''}`}>▼</span>
              </button>
              {sidebarAnalysisOpen && (
              <div className="p-3">
                <div className="space-y-1">
                  {ANALYSIS_STEPS.map((step, idx) => {
                    const allDone = activeResult !== null;
                    const isActive = analyzing && idx === analysisStep && !allDone;
                    const isDone = allDone || (analyzing && idx < analysisStep) || (!analyzing && activeResult !== null && idx <= analysisStep);
                    const isPending = !isDone && !isActive;
                    return (
                      <div key={step.id} className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[9px] ${
                          isDone
                            ? 'bg-emerald-100 text-emerald-600'
                            : isActive
                            ? 'bg-blue-100 text-blue-600'
                            : 'bg-slate-100 text-slate-300'
                        }`}>
                          {isDone ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          ) : isActive ? (
                            <div className="w-2 h-2 border-1.5 border-blue-600 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <span className="font-bold">{idx + 1}</span>
                          )}
                        </div>
                        <span className={`text-[10px] font-medium ${
                          isDone ? 'text-emerald-700' : isActive ? 'text-blue-700' : 'text-slate-400'
                        }`}>
                          {step.label}
                        </span>
                        {isActive && (
                          <span className="ml-auto text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded animate-pulse">
                            Working...
                          </span>
                        )}
                        {isDone && idx === ANALYSIS_STEPS.length - 1 && (
                          <span className="ml-auto text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                            {activeResult ? 'Complete' : 'Done'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              )}
            </div>

            {/* ── Antivirus & Antibug System Container ────────────────────────── */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden shrink-0">
              <button
                onClick={() => setSidebarAntivirusOpen(!sidebarAntivirusOpen)}
                className="w-full px-5 py-3 border-b border-slate-100 bg-gradient-to-r from-rose-50 to-red-50/50 flex items-center gap-2 text-left cursor-pointer hover:brightness-95 transition-all"
                title={sidebarAntivirusOpen ? 'Collapse' : 'Expand'}
              >
                <Shield className="w-5 h-5 text-rose-600 shrink-0" />
                <div className="flex-1">
                  <h2 className="text-sm font-bold text-slate-800">Security &amp; File Integrity</h2>
                  <p className="text-[10px] text-slate-500 mt-0.5">Protects patient data and ensures file integrity</p>
                </div>
                <span className={`text-slate-400 text-[10px] transition-transform shrink-0 ${sidebarAntivirusOpen ? 'rotate-180' : ''}`}>▼</span>
              </button>
              {sidebarAntivirusOpen && (
              <div className="p-2.5 space-y-2">
                {/* Antivirus */}
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Shield className={`w-4 h-4 ${antivirusEnabled ? 'text-emerald-600' : 'text-slate-400'}`} />
                      <span className="text-xs font-bold text-slate-700">Security Scanning</span>
                    </div>
                    <p className="text-[9px] text-slate-500 mt-0.5 leading-snug line-clamp-1">Scans incoming files for security threats.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                    <input type="checkbox" checked={antivirusEnabled} onChange={() => setAntivirusEnabled(!antivirusEnabled)} className="sr-only peer" />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                    <span className={`ml-2 text-[10px] font-bold ${antivirusEnabled ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {antivirusEnabled ? 'ON' : 'OFF'}
                    </span>
                  </label>
                </div>
                {/* Divider */}
                <div className="border-t border-slate-100" />
                {/* Antibug */}
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Bug className={`w-4 h-4 ${antibugEnabled ? 'text-amber-600' : 'text-slate-400'}`} />
                      <span className="text-xs font-bold text-slate-700">File Repair</span>
                    </div>
                    <p className="text-[9px] text-slate-500 mt-0.5 leading-snug line-clamp-1">Ensures files are complete and error-free.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                    <input type="checkbox" checked={antibugEnabled} onChange={() => setAntibugEnabled(!antibugEnabled)} className="sr-only peer" />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                    <span className={`ml-2 text-[10px] font-bold ${antibugEnabled ? 'text-amber-700' : 'text-slate-400'}`}>
                      {antibugEnabled ? 'ON' : 'OFF'}
                    </span>
                  </label>
                </div>
                {/* Scan results / Status indicators */}
                {scanResults.scanning && (
                  <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-[10px]">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-spin" />
                    <span className="font-bold text-blue-700">Scanning...</span>
                  </div>
                )}

                {/* Antivirus scan result — infected files are deleted immediately */}
                {scanResults.antivirus?.scanned && !scanResults.scanning && !scanResults.antivirus.safe && (
                  <div className="flex flex-col gap-1.5 rounded-lg px-3 py-2 text-[10px] border bg-rose-50 border-rose-200">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                      <span className="font-bold text-rose-700">Antivirus: {scanResults.antivirus.threats} threat(s) detected</span>
                    </div>
                    <div className="text-rose-600 space-y-0.5 ml-3">
                      {scanResults.antivirus.threatDetails.map((d, i) => (
                        <div key={`threat-${i}`} className="truncate">{d}</div>
                      ))}
                    </div>
                    {scanResults.antivirus.deleted && (
                      <div className="flex items-center gap-1 text-emerald-700 font-semibold ml-3">
                        <span>🗑 Infected file(s) deleted</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Antibug scan result with fix actions */}
                {scanResults.antibug?.scanned && !scanResults.scanning && (
                  <div className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-[10px] border ${scanResults.antibug.issuesFound > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-100'}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${scanResults.antibug.issuesFound > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                      <span className={`font-bold ${scanResults.antibug.issuesFound > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                        Antibug: {scanResults.antibug.issuesFound} issue{scanResults.antibug.issuesFound !== 1 ? 's' : ''} remaining
                      </span>
                      {scanResults.antibug.fixesApplied > 0 && (
                        <span className="text-emerald-600 font-semibold">· {scanResults.antibug.fixesApplied} auto-fixed ✅</span>
                      )}
                    </div>
                    {scanResults.antibug.issues.length > 0 && (
                      <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                        {scanResults.antibug.issues.slice(0, 5).map((issue, i) => (
                          <div key={`${issue.file}-${issue.line}-${i}`} className="flex items-start gap-1 text-slate-600">
                            <div className="flex-1 min-w-0">
                              <span className={`font-semibold ${issue.severity === 'error' ? 'text-rose-600' : 'text-amber-600'}`}>
                                [{issue.severity === 'error' ? 'ERR' : 'WARN'}]
                              </span>
                              {' '}{issue.file}:{issue.line} — <span className="truncate">{issue.message}</span>
                            </div>
                            <button
                              className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white font-bold px-1.5 py-0.5 rounded text-[9px] transition-colors cursor-pointer"
                              onClick={async () => {
                                try {
                                  const resp = await fetch('/api/security/antibug/apply-fix', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ file: issue.file, line: issue.line, code: issue.code, message: issue.message }),
                                  });
                                  const data = await resp.json();
                                  if (data.success) {
                                    showToast(data.message || 'Fix applied!', 'success');
                                    // Remove the issue from the list
                                    setScanResults(prev => {
                                      if (!prev.antibug) return prev;
                                      return {
                                        ...prev,
                                        antibug: {
                                          ...prev.antibug,
                                          issues: prev.antibug.issues.filter((_, idx) => idx !== i),
                                          issuesFound: prev.antibug.issuesFound - 1,
                                          fixesApplied: prev.antibug.fixesApplied + 1,
                                        },
                                      };
                                    });
                                  } else {
                                    showToast(data.error || 'Failed to apply fix.', 'error');
                                  }
                                } catch { showToast('Failed to apply fix.', 'error'); }
                              }}
                            >
                              Fix
                            </button>
                          </div>
                        ))}
                        {scanResults.antibug.issues.length > 5 && (
                          <div className="flex items-center justify-between text-slate-400 pt-1">
                            <span>··· and {scanResults.antibug.issues.length - 5} more</span>
                            <button
                              className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-2 py-0.5 rounded text-[9px] transition-colors cursor-pointer"
                              onClick={async () => {
                                showToast('Run analysis again to fix remaining issues.', 'info');
                              }}
                            >
                              Fix All ({scanResults.antibug.issues.length})
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Default status when idle */}
                {!scanResults.scanning && !scanResults.antivirus?.scanned && !scanResults.antibug?.scanned && (antivirusEnabled || antibugEnabled) && (
                  <div className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="font-bold text-emerald-700">System Protected</span>
                    </div>
                    <span className="text-slate-300">|</span>
                    <span className="text-slate-500">
                      {antivirusEnabled ? 'Antivirus: Active' : 'Antivirus: Off'}
                      {' · '}
                      {antibugEnabled ? 'Antibug: Active' : 'Antibug: Off'}
                    </span>
                  </div>
                )}
              </div>
              )}
            </div>
          </section>
        )}

        {/* Right Hand: Main Panel Workspace */}
        <section className="flex-1 min-w-0 space-y-6 print:space-y-0" id="workspace-main-panel">
          {currentTab === "admin" && (
            <AdminPanel
              packs={auth.packs}
              connection={auth.connection}
              onRefreshMe={auth.refresh}
            />
          )}

          {currentTab === "cheatsheet" && <RulesCheatsheet />}

          {currentTab === "local" && isAdmin && (
            <div className="space-y-6">
              {/* Connected Reference Library */}
              <FolderSyncContainer
                id="kb"
                title="Connected Reference Library"
                description="AI permanent knowledge base. All synced files become contextual knowledge for analysis."
                icon={<Database className="w-5 h-5 text-emerald-600" />}
                statusLabel={kbSyncState.complete ? "CONNECTED" : "AWAITING SCAN"}
                statusVariant={kbSyncState.complete ? "connected" : "awaiting"}
                syncMode="reference"
                allowWrite={false}
                state={kbSyncState}
                setState={setKbSyncState}
                onSyncComplete={(s) => {
                  if (s.files.length > 0) {
                    const selected = s.files.filter(f => f.selected);
                    showToast(`Reference library synced: ${selected.length} file(s)`, "success");
                  }
                }}
              />

              {/* RAG Toggle integrated inside */}
              <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useClinicalRAG}
                      onChange={(e) => setUseClinicalRAG(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-700">Enforce Biological & Biomechanical RAG</span>
                  </label>
                  <span className="text-[9px] bg-emerald-600 text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">RECOMMENDED</span>
                </div>
                <p className="text-[11px] text-slate-600 pl-6 leading-relaxed">
                  When enabled, case analysis and chat co-pilot recommendations are mathematically locked into biological limits extracted from the connected research database.
                </p>
              </div>

              {/* Auto-Learning / Self-Learning */}
              <div className="bg-gradient-to-r from-purple-50 to-indigo-50/50 border border-purple-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-bold text-slate-700">Self-Learning Mode</span>
                    <span className="text-[9px] bg-purple-100 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full font-bold">EXPERIMENTAL</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed mb-3">
                  AI independently researches topics related to your reference library, gathers clinical evidence, and updates its knowledge base with new findings.
                </p>

                {/* Quick Learn Toggle */}
                <div className="flex items-center justify-between bg-white/70 rounded-lg p-2.5 mb-3 border border-purple-100">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${quickLearn ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>
                      {quickLearn ? '⚡ Quick' : '🧠 Deep'}
                    </span>
                    <span className="text-[11px] font-medium text-slate-600">
                      {quickLearn ? 'Fast overview — fewer topics, lighter research' : 'Comprehensive — deep research across many topics'}
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={quickLearn}
                      onChange={(e) => setQuickLearn(e.target.checked)}
                      className="sr-only peer"
                      disabled={autoLearning}
                    />
                    <div className="w-9 h-5 bg-purple-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-400"></div>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAutoLearn}
                    disabled={autoLearning}
                    className={`flex-1 py-2.5 px-4 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 ${
                      autoLearning
                        ? 'bg-purple-100 text-purple-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 shadow-xs'
                    }`}
                  >
                    {autoLearning ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> AI is Learning...</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> {quickLearn ? '⚡ Quick Learn' : 'Activate Self-Learning'}</>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentTab("ai-manager")}
                    className="px-3 py-2.5 text-xs font-bold text-purple-600 bg-purple-100 hover:bg-purple-200 rounded-xl transition-colors cursor-pointer shrink-0"
                    title="Open AI Manager for detailed controls"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </div>
                {autoLearningStatus && (
                  <p className="text-[10px] text-purple-700 mt-2 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {autoLearningStatus}
                  </p>
                )}
              </div>

              {/* Patient Case Scanner */}
              <FolderSyncContainer
                id="patient"
                title="Patient Case Scanner"
                description="Connect folders containing new patient cases for AI analysis."
                icon={<Upload className="w-5 h-5 text-teal-600" />}
                statusLabel={patientSyncState.complete ? "CONNECTED" : "AWAITING SCAN"}
                statusVariant={patientSyncState.complete ? "connected" : "awaiting"}
                syncMode="patient"
                allowWrite={false}
                state={patientSyncState}
                setState={setPatientSyncState}
                onSyncComplete={(s) => {
                  if (s.files.length > 0) {
                    const selected = s.files.filter(f => f.selected);
                    showToast(`Patient folder synced: ${selected.length} file(s)`, "success");
                  }
                }}
              />

              {/* Import to Workstation — from Patient Case Scanner */}
              {patientSyncState.files.filter(f => f.selected && !f.isDirectory).length > 0 && (
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-teal-100 text-teal-700 rounded-lg">
                      <Download className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-teal-800">
                        {patientSyncState.files.filter(f => f.selected && !f.isDirectory).length} file(s) selected in Patient Case Scanner
                      </p>
                      <p className="text-[10px] text-teal-600 mt-0.5">
                        From: {patientSyncState.folderPath}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleImportToWorkstation}
                    className="shrink-0 px-4 py-2.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
                    id="btn-import-to-workstation"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Import to Workstation
                  </button>
                </div>
              )}
            </div>
          )}

          {currentTab === "storage" && isAdmin && (
            <div className="space-y-6">
              <FolderSyncContainer
                id="storage"
                title="Storage Folder"
                description="AI-generated outputs are stored here. Acts as the application database."
                icon={<Archive className="w-5 h-5 text-indigo-600" />}
                statusLabel={storageSyncState.complete ? "CONNECTED" : "AWAITING SCAN"}
                statusVariant={storageSyncState.complete ? "connected" : "awaiting"}
                syncMode="storage"
                allowWrite={true}
                state={storageSyncState}
                setState={setStorageSyncState}
                storageTarget={storageSyncState.folderPath}
                onLoadSavedAnalysis={(analysisData) => {
                  const result = analysisData as unknown as AnalysisResult;
                  if (result && result.design_parameters) {
                    setActiveResult(result);
                    setActiveCaseId(`storage_${Date.now()}`);
                    setCurrentTab("workspace");
                    showToast("Loaded saved analysis into workspace", "success");
                  } else {
                    showToast("Invalid analysis data format", "error");
                  }
                }}
                onSyncComplete={(s) => {
                  if (s.files.length > 0) {
                    showToast(`Storage folder synced: ${s.files.filter(f => f.selected).length} file(s)`, "success");
                  }
                }}
              />
              {/* Storage hierarchy info */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
                <div className="flex items-center gap-2 mb-2">
                  <Archive className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-bold text-slate-700">Folder Hierarchy</span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Storage <span className="text-slate-400">→</span> Region <span className="text-slate-400">(optional)</span> <span className="text-slate-400">→</span> Doctor Name <span className="text-slate-400">(optional)</span> <span className="text-slate-400">→</span> <strong>Patient Name</strong> <span className="text-slate-400">(required)</span> <span className="text-slate-400">→</span> AI generated files
                </p>
              </div>
            </div>
          )}

          {currentTab === "ai-manager" && isAdmin && (
            <div className="space-y-6">

              {/* API Key Management */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-4 mb-4">
                  <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                  </div>
                  <div>
                    <h3 className="text-md font-bold text-slate-800">API Keys & Provider Configuration</h3>
                    <p className="text-xs text-slate-400 font-medium">Manage AI provider credentials. Changes apply immediately.</p>
                  </div>
                </div>

                {/* Add new key form */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Provider</label>
                    <select
                      value={newKeyProvider}
                      onChange={(e) => setNewKeyProvider(e.target.value)}
                      className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-medium"
                    >
                      <option value="google-genai">Google Gemini</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic Claude</option>
                      <option value="custom">Custom Endpoint</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Key Name</label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g. Production Gemini Key"
                      className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-medium"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">API Key</label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={newKeyValue}
                        onChange={(e) => setNewKeyValue(e.target.value)}
                        placeholder="Paste your API key here..."
                        className="flex-1 p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                      />
                      <button
                        onClick={saveApiKey}
                        disabled={savingApiKey || !newKeyValue.trim() || !newKeyName.trim()}
                        className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-all disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer shrink-0"
                      >
                        {savingApiKey ? "Saving..." : "Add Key"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Saved keys list */}
                {apiKeys.length > 0 ? (
                  <div className="space-y-2">
                    {apiKeys.map((entry) => (
                      <div
                        key={entry.id}
                        className={`flex items-center justify-between p-3 rounded-lg border text-xs ${
                          entry.active
                            ? "bg-emerald-50 border-emerald-200"
                            : "bg-slate-50 border-slate-200"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${entry.active ? "bg-emerald-500" : "bg-slate-300"}`} />
                          <div>
                            <span className="font-bold text-slate-700">{entry.name}</span>
                            <span className="ml-2 text-[10px] text-slate-400 uppercase">{entry.provider}</span>
                          </div>
                          <code className="text-[10px] font-mono text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                            {entry.key.substring(0, 8)}...{entry.key.slice(-4)}
                          </code>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {!entry.active && (
                            <button
                              onClick={() => activateApiKey(entry.id)}
                              className="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 bg-white hover:bg-emerald-50 border border-emerald-200 px-2 py-1 rounded transition-all cursor-pointer"
                            >
                              Activate
                            </button>
                          )}
                          {entry.active && (
                            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded">Active</span>
                          )}
                          <button
                            onClick={() => deleteApiKey(entry.id)}
                            className="text-[10px] font-bold text-rose-500 hover:text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 px-2 py-1 rounded transition-all cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center">
                    <p className="text-xs text-slate-400">No API keys configured. Add a key above to connect to an AI provider.</p>
                    <p className="text-[10px] text-slate-300 mt-1">AI analysis is unavailable until a valid key is added.</p>
                  </div>
                )}
              </div>

              {/* AI Provider Registry — paste the AI list, detect, activate/deactivate */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-4 mb-4">
                  <div className="p-2 bg-cyan-50 text-cyan-600 rounded-xl">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  </div>
                  <div>
                    <h3 className="text-md font-bold text-slate-800">AI Providers — Paste, Detect &amp; Activate</h3>
                    <p className="text-xs text-slate-400 font-medium">Paste the AI list JSON — the system detects every provider &amp; model, then you activate the ones to use. Multiple AIs can be active at once (primary + backups).</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <input
                    ref={aiProviderFileInputRef}
                    type="file"
                    accept=".json,.py,.ts,.tsx,.js,.mjs,.cjs,.env,.txt"
                    className="hidden"
                    onChange={(e) => void importAiProviderFile(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => aiProviderFileInputRef.current?.click()}
                    className="px-3 py-1.5 text-xs font-bold text-cyan-700 bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 rounded-lg transition-colors cursor-pointer"
                  >
                    Import AI config file
                  </button>
                  <textarea
                    value={aiProvidersJson}
                    onChange={(e) => { setAiProvidersJson(e.target.value); setAiProvidersError(""); }}
                    spellCheck={false}
                    className="w-full h-44 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-cyan-500 leading-relaxed resize-y"
                    placeholder={`Paste the AI list JSON, e.g.:\n\n[\n  {\n    "name": "DC-Hub AI",\n    "vendor": "customendpoint",\n    "apiKey": "...",\n    "apiType": "chat-completions",\n    "models": [\n      { "id": "Qwen3.6-35B...", "name": "Qwen3.6 35B", "url": "https://.../v1/chat/completions" }\n    ]\n  },\n  {\n    "name": "OmniRoute AI",\n    "vendor": "customendpoint",\n    "apiKey": "sk-...",\n    "apiType": "chat-completions",\n    "models": [ ... ]\n  }\n]`}
                  />
                  {aiProvidersError && (
                    <p className="text-[11px] font-semibold text-rose-600">{aiProvidersError}</p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-[10px] text-slate-400">
                      Each entry needs <code className="font-mono">name</code>, <code className="font-mono">apiKey</code> and <code className="font-mono">models[]</code> with <code className="font-mono">id</code> + <code className="font-mono">url</code> (OpenAI-compatible endpoints).
                      Activate several AIs at once — calls try them in priority order (★ primary first, then backups) until one responds.
                    </p>
                    <button
                      type="button"
                      disabled={registeringProviders || !aiProvidersJson.trim()}
                      onClick={registerAiProviders}
                      className="px-5 py-2 text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg transition-all shadow-sm hover:shadow-md disabled:bg-slate-300 disabled:shadow-none cursor-pointer flex items-center gap-1.5 shrink-0"
                    >
                      {registeringProviders ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Detecting…</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Detect &amp; Activate</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Registered providers list */}
                <div className="mt-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Registered AIs ({aiProviders.length})
                    </span>
                    <button
                      type="button"
                      onClick={fetchAiProviders}
                      className="text-[10px] font-bold text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                    >
                      ↻ Refresh
                    </button>
                  </div>
                  {aiProviders.length === 0 && (
                    <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center">
                      <p className="text-xs text-slate-400">No AIs registered yet. Paste the list above and click "Detect &amp; Register".</p>
                    </div>
                  )}
                  {aiProviders.map((p) => {
                    const activeCount = aiProviders.filter(x => x.active).length;
                    const prio = p.priority ?? 0;
                    return (
                    <div
                      key={p.id}
                      className={`flex flex-col gap-2 p-3 rounded-xl border text-xs ${p.active ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${p.active ? "bg-emerald-500" : "bg-slate-300"}`} />
                          <span className="font-bold text-slate-700 truncate">{p.name}</span>
                          <span className="text-[10px] text-slate-400 uppercase shrink-0">{p.vendor}</span>
                          {p.active && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${prio === 0 ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-700"}`}>
                              {prio === 0 ? "★ PRIMARY" : activeCount > 1 ? `BACKUP ${prio}` : "ACTIVE"}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {p.active && activeCount > 1 && (
                            <>
                              <button
                                onClick={() => setProviderPriority(p.id, Math.max(0, prio - 1))}
                                disabled={prio === 0}
                                className="text-[10px] font-bold text-slate-500 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 px-2 py-1 rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                title="Move up in priority"
                              >
                                ↑
                              </button>
                              <button
                                onClick={() => setProviderPriority(p.id, prio + 1)}
                                disabled={prio >= activeCount - 1}
                                className="text-[10px] font-bold text-slate-500 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 px-2 py-1 rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                title="Move down in priority"
                              >
                                ↓
                              </button>
                            </>
                          )}
                          {p.active ? (
                            <button
                              onClick={() => deactivateProvider(p.id)}
                              className="text-[10px] font-bold text-rose-500 hover:text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 px-2.5 py-1 rounded transition-all cursor-pointer"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              disabled={activatingProvider === p.id || !p.hasApiKey || p.models.length === 0}
                              onClick={() => activateProvider(p.id)}
                              className="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 bg-white hover:bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed cursor-pointer"
                              title={!p.hasApiKey ? "No apiKey in config" : !p.models.length ? "No models in config" : "Add this AI to the active set"}
                            >
                              {activatingProvider === p.id ? "Activating…" : "Activate"}
                            </button>
                          )}
                          <button
                            onClick={() => removeProvider(p.id)}
                            className="text-[10px] font-bold text-slate-400 hover:text-rose-600 bg-white hover:bg-rose-50 border border-slate-200 px-2 py-1 rounded transition-all cursor-pointer"
                            title="Remove from registry"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      {/* Model selector (only for providers with multiple models) */}
                      {p.models.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap pl-4">
                          <span className="text-[9px] uppercase font-bold text-slate-400">Model:</span>
                          <select
                            value={p.activeModelId || p.models[0]?.id || ""}
                            onChange={(e) => selectProviderModel(p.id, e.target.value)}
                            className="text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500 max-w-[320px]"
                          >
                            {p.models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name || m.id}{m.vision ? " 👁" : ""}{m.toolCalling ? " 🔧" : ""}
                              </option>
                            ))}
                          </select>
                          {p.active && (
                            <span className="text-[10px] text-slate-400">
                              {p.models.length} model{p.models.length !== 1 ? "s" : ""} · {p.models[0]?.maxInputTokens ? `${Math.round(p.models[0].maxInputTokens / 1000)}K ctx` : ""}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>

              {/* AI Engine Status Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                      <Cpu className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-md font-bold text-slate-800">AI Engine Status</h3>
                      <p className="text-xs text-slate-400 font-medium">Real-time monitoring of AI model and inference pipeline</p>
                    </div>
                  </div>
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                    ONLINE
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wide">Model</div>
                    <div className="text-sm font-bold text-slate-800 mt-1">Gemini 2.0 Flash</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">google-genai / gemini-2.0-flash</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wide">Status</div>
                    <div className="text-sm font-bold text-emerald-600 mt-1 flex items-center gap-1.5">
                      <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                      Operational
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">All systems nominal</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wide">Analyzer</div>
                    <div className="text-sm font-bold text-slate-800 mt-1">
                      {analyzing ? "Processing..." : "Idle"}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {analyzing ? "Case analysis in progress" : "Ready for submission"}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wide">RAG</div>
                    <div className="text-sm font-bold text-slate-800 mt-1 flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${useClinicalRAG ? "bg-emerald-500" : "bg-slate-300"}`}></span>
                      {useClinicalRAG ? "Active" : "Disabled"}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {useClinicalRAG ? "Biological constraints enforced" : "Freeform mode"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Core Memory & Clinical Ruleset Panel */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs" id="core-memory-panel">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                      <Brain className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-md font-bold text-slate-800 flex items-center gap-2">
                        System Core Memory & Clinical Ruleset
                        <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-150 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></span>
                          ACTIVE ALIGNMENT
                        </span>
                      </h3>
                      <p className="text-xs text-slate-400 font-medium">Configure master guidelines for AI chat copilot and case analysis behavior.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        fetchCoreMemory();
                        showToast("Core Memory reloaded from server configuration.", "info");
                      }}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 transition-all cursor-pointer flex items-center gap-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reload
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    The instructions below act as <strong>Core Memory (system instructions)</strong>. The AI co-pilot and automated case analyzer reference these rulesets on every transaction, ensuring movements strictly respect biological limits and material guidelines.
                  </p>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700 block uppercase tracking-wide">
                          1. Chat Co-Pilot System Instructions
                        </span>
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">chat_instructions</span>
                      </div>
                      <textarea
                        value={chatInstructionsInput}
                        onChange={(e) => setChatInstructionsInput(e.target.value)}
                        className="w-full h-80 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed"
                        placeholder="Define Co-Pilot guidelines..."
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700 block uppercase tracking-wide">
                          2. Case Analyzer Clinical Guidelines
                        </span>
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">analysis_instructions</span>
                      </div>
                      <textarea
                        value={analysisInstructionsInput}
                        onChange={(e) => setAnalysisInstructionsInput(e.target.value)}
                        className="w-full h-80 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed"
                        placeholder="Define Case Analyzer guidelines..."
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setChatInstructionsInput(coreMemory.chatInstructions);
                        setAnalysisInstructionsInput(coreMemory.analysisInstructions);
                        showToast("Changes discarded.", "info");
                      }}
                      className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-lg transition-colors cursor-pointer"
                    >
                      Reset Changes
                    </button>
                    <button
                      type="button"
                      disabled={savingCoreMemory}
                      onClick={handleSaveCoreMemory}
                      className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-all shadow-sm hover:shadow-md disabled:bg-slate-300 disabled:shadow-none cursor-pointer flex items-center gap-1.5"
                    >
                      {savingCoreMemory ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Saving Guidelines...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Save & Apply Guidelines</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* AI Configuration & Controls */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-4 mb-4">
                  <div className="p-2 bg-slate-50 text-slate-600 rounded-xl">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-md font-bold text-slate-800">AI Configuration & Controls</h3>
                    <p className="text-xs text-slate-400 font-medium">Adjust inference parameters and system behavior</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div>
                        <span className="text-xs font-bold text-slate-700">Clinical RAG Enforcement</span>
                        <p className="text-[10px] text-slate-500 mt-0.5">Lock analysis to biological research data</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useClinicalRAG}
                          onChange={(e) => setUseClinicalRAG(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div>
                        <span className="text-xs font-bold text-slate-700">Keep in Sync</span>
                        <p className="text-[10px] text-slate-500 mt-0.5">Background polling for Drive changes</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={keepInSync}
                          onChange={(e) => {
                            setKeepInSync(e.target.checked);
                            if (e.target.checked) {
                              if (!kbSyncState.complete) {
                                showToast("Please sync a valid Drive folder first.", "info");
                              } else {
                                showToast("Background Sync is now active.", "success");
                              }
                            } else {
                              showToast("Background Sync disabled.", "info");
                            }
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="w-4 h-4 text-slate-500" />
                      <span className="text-xs font-bold text-slate-700">Session Analytics</span>
                    </div>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Cases Analyzed</span>
                        <span className="font-bold text-slate-800">{historyCases.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Active Case</span>
                        <span className="font-bold text-slate-800">{activeCaseId || "None"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Drive Sync</span>
                        <span className={`font-bold ${kbSyncState.complete ? "text-emerald-600" : "text-slate-400"}`}>
                          {kbSyncState.complete ? "Connected" : "Not linked"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Core Memory</span>
                        <span className={`font-bold ${coreMemory.chatInstructions ? "text-indigo-600" : "text-slate-400"}`}>
                          {coreMemory.chatInstructions ? "Loaded" : "Empty"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Knowledge Resources: Paste Text & Links to Feed AI Brain */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-teal-50 text-teal-600 rounded-xl">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/></svg>
                    </div>
                    <div>
                      <h3 className="text-md font-bold text-slate-800 flex items-center gap-2">
                        Knowledge Resources &amp; Auto-Learning
                        {totalResourcesGathered > 0 && (
                          <span className="text-[10px] bg-teal-100 text-teal-800 border border-teal-200 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                            <Database className="w-3 h-3" />
                            {totalResourcesGathered} resource{totalResourcesGathered !== 1 ? 's' : ''}
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-slate-400 font-medium">Feed the AI with pasted knowledge + links. Activate auto-learning for autonomous research.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {knowledgeResources.filter(r => r.status === 'completed').length > 0 && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                        {knowledgeResources.filter(r => r.status === 'completed').length} ready
                      </span>
                    )}
                  </div>
                </div>

                {/* Resource Counter Dashboard */}
                {totalResourcesGathered > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                    <div className="bg-teal-50 rounded-lg p-3 border border-teal-100 text-center">
                      <div className="text-lg font-bold text-teal-700">{totalResourcesGathered}</div>
                      <div className="text-[9px] text-teal-600 uppercase tracking-wide font-bold">Total Resources</div>
                    </div>
                    <div className="bg-cyan-50 rounded-lg p-3 border border-cyan-100 text-center">
                      <div className="text-lg font-bold text-cyan-700">{knowledgeResources.filter(r => r.type === 'url').length}</div>
                      <div className="text-[9px] text-cyan-600 uppercase tracking-wide font-bold">URLs Processed</div>
                    </div>
                    <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-100 text-center">
                      <div className="text-lg font-bold text-indigo-700">{knowledgeResources.filter(r => r.type === 'text').length}</div>
                      <div className="text-[9px] text-indigo-600 uppercase tracking-wide font-bold">Text Entries</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100 text-center">
                      <div className="text-lg font-bold text-emerald-700">{knowledgeResources.filter(r => r.status === 'completed').length}</div>
                      <div className="text-[9px] text-emerald-600 uppercase tracking-wide font-bold">Completed</div>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Paste text content combined with URLs below. The AI will extract all links, fetch their content, summarize everything, and save it as permanent knowledge in your AI knowledge base. This directly expands what the AI knows for better case analysis.
                  </p>

                  {/* Text + Links Input Area */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-700 block uppercase tracking-wide">
                      Paste Knowledge Content (text + links)
                    </label>
                    <textarea
                      value={knowledgeText}
                      onChange={(e) => setKnowledgeText(e.target.value)}
                      placeholder={`Paste ANY text content with URLs mixed in — research notes, clinical guidelines, PubMed links, material specs, etc.\n\nExample:\n"According to this study on PETG materials https://pubmed.ncbi.nlm.nih.gov/example1/ the optimal thickness is 1.0mm. Also refer to the ADA guidelines at https://ada.org/guidelines for more details."`}
                      className="w-full h-40 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-teal-500 leading-relaxed resize-y"
                      disabled={processingKnowledge}
                    />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 font-medium">
                          {knowledgeText.length > 0 ? `${knowledgeText.length} chars` : ''}
                          {(() => {
                            const urlRegex = /https?:\/\/(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>{}|\\^`[\]]*)?|(?:^|\s)(www\.(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>{}|\\^`[\]]*)?)|(?:^|\s)((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+(?:com|org|net|edu|gov|io|co|int|mil|info|biz|app|dev|ai|me|tv|uk|de|jp|au|fr|ca|it|es|nl|br|in|ru|cn|nz|se|no|fi|dk|pl|be|at|ch|kr|hk|sg|my|ph|th|za|mx|ar|cl|pt|gr|ie|hu|cz|ro|il|eu|us)(?:\/[^\s<>{}|\\^`[\]]*)?)/gi;
                            const urls = knowledgeText.match(urlRegex);
                            return urls && urls.length > 0
                              ? ` · ${urls.length} URL${urls.length !== 1 ? 's' : ''} detected`
                              : '';
                          })()}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setKnowledgeText('')}
                          disabled={!knowledgeText.trim()}
                          className="px-3 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-lg transition-all disabled:opacity-50 cursor-pointer"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          onClick={handleProcessKnowledge}
                          disabled={processingKnowledge || !knowledgeText.trim()}
                          className="px-4 py-2 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-all disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
                        >
                          {processingKnowledge ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing...</>
                          ) : (
                            <><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M12 2a10 10 0 0 1 10 10"/><path d="M2 12a10 10 0 0 1 10-10"/><path d="M12 22a10 10 0 0 1-10-10"/><path d="M22 12a10 10 0 0 1-10 10"/><path d="M12 2v20"/><path d="M2 12h20"/></svg> Process Resources</>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Resources Status List */}
                  {knowledgeResources.length > 0 && (
                    <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 max-h-48 overflow-y-auto space-y-1.5">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">
                        Resources ({knowledgeResources.length})
                      </div>
                      {knowledgeResources.map((res, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-100 text-xs">
                          {res.status === 'processing' ? (
                            <Loader2 className="w-3.5 h-3.5 text-cyan-500 animate-spin shrink-0" />
                          ) : res.status === 'completed' ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-emerald-500 shrink-0"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><polyline points="9 12 11 14 15 10"/></svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-rose-500 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                          )}
                          <span className="text-[10px] text-slate-500 truncate flex-1">
                            {res.type === 'url' ? (
                              <span className="truncate block max-w-[300px]" title={res.source}>{res.source}</span>
                            ) : (
                              <span className="text-indigo-600 font-semibold">Pasted Text Content</span>
                            )}
                          </span>
                          <span className={`text-[9px] font-bold shrink-0 ${
                            res.status === 'processing' ? 'text-cyan-600' :
                            res.status === 'completed' ? 'text-emerald-600' : 'text-rose-600'
                          }`}>{res.status === 'completed' ? 'Saved' : res.status}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Divider */}
                  <div className="border-t border-slate-100 pt-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Brain className="w-4 h-4 text-purple-600" />
                      <span className="text-xs font-bold text-slate-700">Auto-Learning Mode</span>
                      <span className="text-[9px] bg-purple-100 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full font-bold">EXPERIMENTAL</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed mb-4">
                      When activated, the AI independently researches topics related to your core memory context. It searches online, gathers clinical evidence, updates its knowledge base, and can even auto-update its own Core Memory instructions with new findings.
                    </p>

                    {/* Quick Learn Toggle */}
                    <div className="flex items-center justify-between bg-purple-50/70 rounded-lg p-3 mb-4 border border-purple-100">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${quickLearn ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>
                          {quickLearn ? '⚡ Quick' : '🧠 Deep'}
                        </span>
                        <span className="text-xs text-slate-600">
                          {quickLearn ? 'Fast overview — fewer topics, lighter research' : 'Comprehensive — deep research across many topics'}
                        </span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={quickLearn}
                          onChange={(e) => setQuickLearn(e.target.checked)}
                          className="sr-only peer"
                          disabled={autoLearning}
                        />
                        <div className="w-9 h-5 bg-purple-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-400"></div>
                      </label>
                    </div>

                    {/* Auto-Learning Status */}
                    {autoLearningStatus && (
                      <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-4 space-y-2">
                        <div className="flex items-center gap-2 text-xs">
                          {autoLearning ? (
                            <Loader2 className="w-4 h-4 text-purple-600 animate-spin" />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-emerald-500" />
                          )}
                          <span className="font-bold text-purple-800">{autoLearningStatus}</span>
                        </div>
                        {autoLearningQueries.length > 0 && (
                          <div className="space-y-1.5 mt-2">
                            {autoLearningQueries.map((q, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-[10px] bg-white rounded-lg p-2 border border-purple-100">
                                <div className={`w-2 h-2 rounded-full ${q.status === 'completed' ? 'bg-emerald-500' : q.status === 'researching' ? 'bg-amber-500 animate-pulse' : 'bg-slate-300'}`} />
                                <span className="text-slate-700 font-medium flex-1 truncate">{q.query}</span>
                                <span className="text-slate-400 shrink-0">{q.reason.slice(0, 60)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleAutoLearn}
                      disabled={autoLearning}
                      className={`w-full py-3 px-4 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 ${
                        autoLearning
                          ? 'bg-purple-100 text-purple-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 shadow-sm hover:shadow-md'
                      }`}
                    >
                      {autoLearning ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>AI is Learning Independently...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>{quickLearn ? '⚡ Quick Learn — Fast Research Overview' : '🧠 Activate Auto-Learning — AI Independently Researches &amp; Updates Its Brain'}</span>
                        </>
                      )}
                    </button>
                    <p className="text-[9px] text-slate-400 mt-2 text-center">
                      The AI will search for relevant clinical studies, extract guidelines, save them to your knowledge base, and optionally update its own Core Memory.
                    </p>
                  </div>
                </div>
              </div>

            </div>
          )}

          {currentTab === "workspace" && (
            <div className="space-y-6 print:space-y-0">
              {analysisEnabled ? (
                <>

              {/* Import to Workstation — from Patient Case Scanner */}
              {patientSyncState.files.filter(f => f.selected && !f.isDirectory).length > 0 && (
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-teal-100 text-teal-700 rounded-lg">
                      <Download className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-teal-800">
                        {patientSyncState.files.filter(f => f.selected && !f.isDirectory).length} file(s) selected in Patient Case Scanner
                      </p>
                      <p className="text-[10px] text-teal-600 mt-0.5">
                        From: {patientSyncState.folderPath}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleImportToWorkstation}
                    className="shrink-0 px-4 py-2.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
                    id="btn-import-to-workstation"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Import to Workstation
                  </button>
                </div>
              )}

              {/* Form and Submission Section */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs print:hidden">
                <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                  <h2 className="text-md font-bold text-slate-800 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    Submit New Retainer Case
                  </h2>
                  <button
                    onClick={clearForm}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
                    id="btn-clear-form"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Clear Form
                  </button>
                </div>

                {error && (
                  <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2" id="form-error-banner">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleAnalyze} className="space-y-5" id="retainer-form">
                  
                  {/* STL File Drag & Drop Upload Zone */}
                  <div>
                    <label className="text-xs font-bold uppercase text-slate-400 block mb-2">
                      Orthodontic STL Scans (Maxillary / Mandibular)
                    </label>
                    <div
                      onDragEnter={handleDragEnter}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer select-none flex flex-col items-center justify-center ${
                        isDragOver
                          ? "bg-blue-50 border-blue-500"
                          : "bg-slate-50 border-slate-200 hover:bg-slate-50/70 hover:border-slate-300"
                      }`}
                      id="drag-drop-zone"
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        multiple
                        accept="*/*"
                        className="hidden"
                      />
                      <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs mb-3 text-slate-600">
                        <Upload className="w-6 h-6 text-blue-600" />
                      </div>
                      <p className="text-sm font-semibold text-slate-800">
                        Drag and drop STL scans here, or <span className="text-blue-600">browse</span>
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Accepts digital impression .stl mesh files (Upper, Lower, or Dual Arch)
                      </p>
                    </div>

                    {/* Selected Files List */}
                    {selectedFiles.length > 0 && (
                      <div className="mt-3 space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200" id="uploaded-files-list">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">
                          Scans Staged for Manufacture ({selectedFiles.length}):
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {selectedFiles.map((file, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between bg-white p-2 rounded border border-slate-200 text-xs shadow-3xs"
                            >
                              <div className="flex items-center gap-2 truncate pr-2">
                                <div className="p-1 bg-blue-50 text-blue-600 rounded">
                                  <FileBadge className="w-4 h-4" />
                                </div>
                                <div className="truncate">
                                  <p className="font-semibold text-slate-800 truncate" title={file.name}>
                                    {file.name}
                                  </p>
                                  <p className="text-[10px] text-slate-400">
                                    {formatBytes(file.size)}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeFile(idx);
                                }}
                                className="text-slate-400 hover:text-rose-600 font-semibold text-xs px-1.5 py-1 cursor-pointer"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Imported patient files (metadata only) */}
                    {importedPatientFiles.length > 0 && (
                      <div className="mt-3 space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200" id="imported-patient-files-list">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">
                          Imported Patient Files ({importedPatientFiles.length}):
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {importedPatientFiles.map((entry, idx) => (
                            <div key={`${entry.relativePath || entry.name}_${idx}`} className="flex items-center justify-between bg-white p-2 rounded border border-slate-200 text-xs shadow-3xs">
                              <div className="flex items-center gap-2 truncate pr-2">
                                <div className="p-1 bg-blue-50 text-blue-600 rounded">
                                  <FileBadge className="w-4 h-4" />
                                </div>
                                <div className="truncate">
                                  <p className="font-semibold text-slate-800 truncate" title={entry.name}>{entry.name}</p>
                                  <p className="text-[10px] text-slate-400">{formatBytes(entry.size)}</p>
                                </div>
                              </div>
                              <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded shrink-0">Imported</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Imported STL files from folder sync */}
                    {importLog.filter(e => e.category === 'stl-scan').length > 0 && (
                      <div className="mt-3 space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200" id="imported-stl-files-list">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">
                          Imported STL Scans from Folder Sync ({importLog.filter(e => e.category === 'stl-scan').length}):
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {importLog.filter(e => e.category === 'stl-scan').map(entry => (
                            <div
                              key={entry.id}
                              className="flex items-center justify-between bg-white p-2 rounded border border-blue-200 text-xs shadow-3xs"
                            >
                              <div className="flex items-center gap-2 truncate pr-2">
                                <div className="p-1 bg-blue-50 text-blue-600 rounded">
                                  <FileBadge className="w-4 h-4" />
                                </div>
                                <div className="truncate">
                                  <p className="font-semibold text-slate-800 truncate" title={entry.fileName}>
                                    {entry.fileName}
                                  </p>
                                  {entry.fileSize && <p className="text-[10px] text-slate-400">{entry.fileSize}</p>}
                                </div>
                              </div>
                              <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded shrink-0">Sync</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Prescription PDF & Video Attachments Upload (Primary Source) */}
                  <div 
                    onDragEnter={handlePrescriptionDragEnter}
                    onDragOver={handlePrescriptionDragOver}
                    onDragLeave={handlePrescriptionDragLeave}
                    onDrop={handlePrescriptionDrop}
                    className={`p-4 rounded-xl border border-dashed transition-all ${
                      isPrescriptionDragOver
                        ? "bg-[#46c0bd]/15 border-[#46c0bd] ring-2 ring-[#46c0bd]/20 scale-[1.01]"
                        : "border-[#46c0bd]/40 bg-[#46c0bd]/5"
                    }`} id="prescription-attachments-container">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Paperclip className="w-4 h-4 text-[#46c0bd]" />
                        <span className="text-xs font-bold uppercase text-slate-700 tracking-wider">
                          Prescription Documents & Videos <span className="text-[#46c0bd]">(Primary Source)</span>
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => prescriptionFilesRef.current?.click()}
                        className="text-xs font-bold text-[#46c0bd] hover:text-white hover:bg-[#46c0bd] transition-colors flex items-center gap-1 cursor-pointer bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-3xs"
                        id="btn-add-attachment"
                      >
                        <Upload className="w-3 h-3" />
                        Add File
                      </button>
                    </div>
                    
                    <input
                      type="file"
                      ref={prescriptionFilesRef}
                      onChange={handlePrescriptionFilesChange}
                      multiple
                      accept="*/*"
                      className="hidden"
                    />

                    {prescriptionFiles.length === 0 && importLog.filter(e => e.category === 'prescription-doc').length === 0 ? (
                      <p className="text-xs text-slate-500 italic">
                        No primary prescription files uploaded yet. Upload patient prescription sheets, dental scans or case walkthrough videos. (Supports PDFs and MP4/MOV video files).
                      </p>
                    ) : (
                      <>
                        {prescriptionFiles.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2" id="staged-attachments-list">
                            {prescriptionFiles.map((file, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-slate-200 text-xs shadow-3xs"
                              >
                                <div className="flex items-center gap-2 truncate pr-2">
                                  <div className="p-1.5 bg-[#46c0bd]/10 text-[#46c0bd] rounded">
                                    {file.type.includes("pdf") ? (
                                      <FileText className="w-3.5 h-3.5" />
                                    ) : file.type.includes("video") ? (
                                      <Video className="w-3.5 h-3.5" />
                                    ) : (
                                      <FileBadge className="w-3.5 h-3.5" />
                                    )}
                                  </div>
                                  <div className="truncate">
                                    <p className="font-semibold text-slate-800 truncate" title={file.name}>
                                      {file.name}
                                      <span className="text-[10px] text-[#46c0bd] ml-1 font-medium bg-[#46c0bd]/5 px-1 py-0.5 rounded">Primary</span>
                                    </p>
                                    <p className="text-[9px] text-slate-400">
                                      {formatBytes(file.size)}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removePrescriptionFile(idx)}
                                  className="text-slate-400 hover:text-rose-600 font-bold text-xs px-2 py-1 cursor-pointer"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Imported prescription docs from folder sync */}
                        {importLog.filter(e => e.category === 'prescription-doc').length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2" id="imported-docs-list">
                            {importLog.filter(e => e.category === 'prescription-doc').map(entry => (
                              <div
                                key={entry.id}
                                className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-teal-200 text-xs shadow-3xs"
                              >
                                <div className="flex items-center gap-2 truncate pr-2">
                                  <div className="p-1.5 bg-teal-50 text-teal-600 rounded">
                                    <FileText className="w-3.5 h-3.5" />
                                  </div>
                                  <div className="truncate">
                                    <p className="font-semibold text-slate-800 truncate" title={entry.fileName}>
                                      {entry.fileName}
                                      <span className="text-[10px] text-teal-600 ml-1 font-medium bg-teal-50 px-1 py-0.5 rounded">Sync</span>
                                    </p>
                                    {entry.fileSize && <p className="text-[9px] text-slate-400">{entry.fileSize}</p>}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Prescription Instructions Text (Optional) */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold uppercase text-slate-500">
                        Dentist's Prescription Instructions <span className="text-slate-400 font-normal italic lowercase">(Optional)</span>
                      </label>
                      <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Text Note</span>
                    </div>
                    <textarea
                      value={prescriptionText}
                      onChange={(e) => {
                        setPrescriptionText(e.target.value);
                        setError(null);
                      }}
                      placeholder="e.g. Upper Essix retainer, 1.0mm thermoforming. Scallop 1.5mm above gumline. Relieve labial frenum..."
                      className="w-full h-28 p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden text-sm text-slate-800 placeholder:text-slate-400 font-medium transition-all"
                      id="prescription-text-area"
                    />

                    {/* Presets/Templates */}
                    <div className="mt-2.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">
                        Quick Prescription Templates:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {presets.map((preset, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => applyPreset(preset.text)}
                            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Imported text notes from folder sync */}
                    {importLog.filter(e => e.category === 'prescription-text').length > 0 && (
                      <div className="mt-3 p-3 bg-amber-50/50 rounded-lg border border-amber-200">
                        <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wide block mb-1.5 flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
                          Imported Notes from Folder Sync ({importLog.filter(e => e.category === 'prescription-text').length})
                        </span>
                        {importLog.filter(e => e.category === 'prescription-text').map(entry => (
                          <div key={entry.id} className="text-xs text-slate-600 italic leading-relaxed bg-white rounded px-2.5 py-2 border border-amber-100">
                            {entry.summary}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                    {/* Live Lab Compliance & Material Suggestion */}
                    <div className="mt-4 p-4 rounded-xl border bg-slate-50/60 border-slate-200" id="material-assistant-section">
                      <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-150">
                        <div className="flex items-center gap-2">
                          <span className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                            <Sparkles className="w-4 h-4" />
                          </span>
                          <div>
                            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Whitesmile Clear AI</span>
                            <h4 className="text-xs font-bold text-slate-700">Real-Time Material Planner</h4>
                          </div>
                        </div>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                          detectedAppliance === "Essix" ? "bg-amber-100 text-amber-800 border border-amber-200" :
                          detectedAppliance === "Hawley" ? "bg-indigo-50 text-indigo-800 border border-indigo-200" :
                          "bg-slate-200 text-slate-600 border border-slate-300"
                        }`}>
                          Appliance Detected: <strong className="font-bold">{detectedAppliance}</strong>
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                        {/* Selector */}
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">
                            Technician Selected Material:
                          </label>
                          <select
                            value={selectedMaterial}
                            onChange={(e) => setSelectedMaterial(e.target.value)}
                            className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-blue-500 font-medium text-slate-700"
                            id="material-select-dropdown"
                          >
                            <option value="PETG 0.75mm Thermoforming Sheet">PETG 0.75mm Thermoforming Sheet</option>
                            <option value="PETG 1.0mm Thermoforming Sheet">PETG 1.0mm Thermoforming Sheet</option>
                            <option value="PETG 1.5mm Thermoforming Sheet">PETG 1.5mm Thermoforming Sheet</option>
                            <option value="PMMA Acrylic Baseplate + 0.7mm Stainless Steel Labial Bow">PMMA Acrylic Baseplate + 0.7mm Stainless Steel Labial Bow</option>
                            <option value="Specialized Surgical Guide Resin">Specialized Surgical Guide Resin</option>
                            <option value="Custom Other Material">Custom Other Material</option>
                          </select>
                        </div>

                        {/* Suggestions and compliance details */}
                        <div className="flex flex-col justify-between">
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">
                              System Suggestion:
                            </span>
                            <div className="flex items-center justify-between bg-white border border-slate-150 rounded-lg p-2 text-xs">
                              <span className="font-semibold text-slate-700 truncate mr-2">
                                {detectedAppliance === "Other" ? "Write Essix or Hawley above" : getSuggestedMaterial()}
                              </span>
                              {detectedAppliance !== "Other" && (
                                <button
                                  type="button"
                                  onClick={handleApplySuggestedMaterial}
                                  className="shrink-0 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-2 py-1 rounded text-[10px] transition-colors cursor-pointer"
                                  id="btn-apply-suggestion"
                                >
                                  Apply
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Live Compliance Rule Status Indicator */}
                      <div className={`mt-3 p-3 rounded-lg flex items-start gap-2 border text-xs ${
                        compliance.valid
                          ? "bg-emerald-50 text-emerald-800 border-emerald-100"
                          : "bg-rose-50 text-rose-800 border-rose-150 animate-pulse"
                      }`} id="compliance-status-banner">
                        {compliance.valid ? (
                          <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-bold">{compliance.valid ? "Specification Compliant" : "Compliance Hazard Detected!"}</p>
                          <p className="text-[11px] text-slate-600 mt-0.5">{compliance.message}</p>
                        </div>
                      </div>
                    </div>

                  {/* Action Row */}
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={handleAnalyze}
                      disabled={analyzing}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm px-6 py-3 rounded-xl transition-all shadow-md hover:shadow-lg disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed cursor-pointer"
                      id="btn-analyze-submit"
                    >
                      {analyzing ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent shrink-0" />
                          <span className="truncate">
                            {analysisStep >= 0 && analysisStep < ANALYSIS_STEPS.length
                              ? ANALYSIS_STEPS[analysisStep].label
                              : 'AI Processing Case ...'}
                          </span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>Analyze & Draft Manufacturing Spec</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* Dynamic Analysis Results Display */}
              {activeResult ? (
                <div className="space-y-4 print:space-y-2" id="results-wrapper">
                  <div className="flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-2 print:border-none print:pb-0">
                    <CheckCircle className="w-5 h-5 text-emerald-500 print:hidden" />
                    <h2 className="text-md font-bold print:text-lg">
                      Manufacturing Specifications for {activeCaseId || "Submitted Case"}
                    </h2>
                  </div>
                  <AnalysisResultView 
                    result={activeResult} 
                    caseId={activeCaseId || undefined} 
                    files={historyCases.find((c) => c.id === activeCaseId)?.files}
                    caseStatus={historyCases.find((c) => c.id === activeCaseId)?.status}
                    onUpdateCase={handleUpdateCase}
                  />
                </div>
              ) : (
                <div className="border border-dashed border-slate-200 rounded-xl p-12 text-center bg-white/50 print:hidden" id="waiting-state">
                  <div className="w-10 h-10 rounded-full bg-slate-100 mx-auto mb-3 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                  </div>
                  <p className="text-slate-700 text-sm font-semibold">Awaiting Case Submission</p>
                  <p className="text-slate-400 text-xs mt-1 max-w-sm mx-auto">
                    Fill in the prescription details or drag in digital STL impressions to interpret parameters, compile instructions, and audit warnings.
                  </p>
                </div>
              )}

              {/* Imported files clear button (visible when any imported files present) */}
              {importLog.length > 0 && (
                <div className="flex justify-end print:hidden">
                  <button
                    onClick={() => setImportLog([])}
                    className="text-[10px] font-semibold text-slate-400 hover:text-rose-600 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                    Clear All Imported Files
                  </button>
                </div>
              )}

                </>
              ) : null}

              {/* ── Satellite Systems (gated by feature packs) ── */}
              <SystemsHub enabledPacks={auth.enabledPacks} />

              {/* No packs enabled at all */}
              {auth.enabledPacks.length === 0 && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-slate-100 mx-auto mb-3 flex items-center justify-center">
                    <ShieldCheck className="w-6 h-6 text-slate-300" />
                  </div>
                  <p className="text-sm font-semibold text-slate-700">No Feature Packs Enabled</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                    Your company does not have any feature packs activated. Contact your administrator to enable them.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Lab Portal Footer */}
      <footer className="bg-white border-t border-slate-200 py-3.5 px-6 text-center text-[10px] text-slate-400 font-medium shrink-0 print:hidden">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Whitesmile Clear © 2026 Whitesmile Clear Orthodontic Inc.</span>
          <span className="font-mono">Compliance Audit System: V1.0-MVP</span>
        </div>
      </footer>
    </div>
  );
}

