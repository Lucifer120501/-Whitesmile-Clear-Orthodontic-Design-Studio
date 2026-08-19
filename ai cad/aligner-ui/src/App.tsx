import React, { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import type { SharedPipelineConfig } from './types/pipeline'

const DEFAULT_MAIN_SERVER = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'

export default function App() {
  const [mainServerUrl] = React.useState(
    () => localStorage.getItem('wsMainServerUrl') || DEFAULT_MAIN_SERVER
  )
  const [storageDir, setStorageDir] = React.useState(
    () => localStorage.getItem('wsStorageDir') || ''
  )
  const [sharedConfig, setSharedConfig] = React.useState<SharedPipelineConfig | null>(null)
  const [aiStatus, setAiStatus] = React.useState<'checking' | 'online' | 'offline'>('checking')
  const [aiError, setAiError] = React.useState('')

  // ── Centralized pipeline config from the main system ──
  // Setup (storage, stages, expansion, shell, undercut) is managed in the
  // main system's Shared Pipeline Configuration. This satellite only reads it.
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/system/config')
        if (!res.ok) return
        const data = await res.json()
        const cfg: SharedPipelineConfig = {
          storageFolder: data.storageFolder || '',
          stages: typeof data.stages === 'number' ? data.stages : 33,
          expansion: typeof data.expansion === 'number' ? data.expansion : 1.02,
          shellMm: typeof data.shellMm === 'number' ? data.shellMm : 0.75,
          undercutDeg: typeof data.undercutDeg === 'number' ? data.undercutDeg : 45,
        }
        setSharedConfig(cfg)
        if (cfg.storageFolder && !storageDir) setStorageDir(cfg.storageFolder)
      } catch {
        // keep current values
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Check WhiteSmile main system AI availability on mount ──
  useEffect(() => {
    const check = async () => {
      setAiStatus('checking')
      if (window.electronAPI) {
        const result = await window.electronAPI.checkMainAi(mainServerUrl)
        if (result.available) {
          setAiStatus('online')
          setAiError(result.error || '')
          if (result.storageFolder && !storageDir) setStorageDir(result.storageFolder)
        } else {
          setAiStatus('offline')
          setAiError(result.error || 'Main system unreachable')
        }
        return
      }
      // Browser preview — check the main system directly via HTTP
      try {
        const base = mainServerUrl.replace(/\/+$/, '')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 4000)
        const resp = await fetch(`${base}/api/system/config`, { signal: controller.signal })
        clearTimeout(timer)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = await resp.json()
        if (data.aiAvailable) {
          setAiStatus('online')
          setAiError('')
          if (data.storageFolder && !storageDir) setStorageDir(data.storageFolder)
        } else {
          setAiStatus('offline')
          setAiError('Main system online, but no AI API key is set. Add one in the AI Manager tab.')
        }
      } catch {
        setAiStatus('offline')
        setAiError('Main system unreachable — AI features will use default settings')
      }
    }
    check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainServerUrl])

  useEffect(() => {
    localStorage.setItem('wsMainServerUrl', mainServerUrl)
  }, [mainServerUrl])

  useEffect(() => {
    localStorage.setItem('wsStorageDir', storageDir)
  }, [storageDir])

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50">
      {/* Slim toolbar (status only — no local controls) */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-5 py-2.5 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Aligner Segmentation Pipeline
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* AI status pill */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${
              aiStatus === 'online'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : aiStatus === 'checking'
                  ? 'bg-slate-50 border-slate-200 text-slate-500'
                  : 'bg-amber-50 border-amber-200 text-amber-700'
            }`}
            title={aiError || 'WhiteSmile main system AI'}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                aiStatus === 'online'
                  ? 'bg-emerald-500'
                  : aiStatus === 'checking'
                    ? 'bg-slate-400 animate-pulse'
                    : 'bg-amber-500'
              }`}
            />
            {aiStatus === 'online'
              ? 'WhiteSmile AI Online'
              : aiStatus === 'checking'
                ? 'Checking AI...'
                : 'AI Offline — using defaults'}
          </div>
          {/* Shared storage (managed by the main system) */}
          <div
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border bg-white border-slate-300 text-slate-600"
            title={storageDir || 'Shared storage folder from the main system'}
          >
            {storageDir ? `📁 ${storageDir.split(/[\\/]/).pop()}` : '📁 Shared storage'}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Sidebar aiStatus={aiStatus} aiError={aiError} storageDir={storageDir} sharedConfig={sharedConfig} />
      </div>
    </div>
  )
}
