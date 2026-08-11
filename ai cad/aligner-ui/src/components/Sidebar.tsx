import type { SharedPipelineConfig } from '../types/pipeline'

interface SidebarProps {
  aiStatus: 'checking' | 'online' | 'offline'
  aiError: string
  storageDir: string
  sharedConfig: SharedPipelineConfig | null
}

export default function Sidebar({ aiStatus, aiError, storageDir, sharedConfig }: SidebarProps) {
  const statusColor =
    aiStatus === 'online' ? 'bg-emerald-500' : aiStatus === 'checking' ? 'bg-slate-400 animate-pulse' : 'bg-amber-500'
  const statusText =
    aiStatus === 'online'
      ? 'Connected to WhiteSmile main system'
      : aiStatus === 'checking'
        ? 'Connecting to WhiteSmile main system…'
        : 'Main system offline'
  const statusLabel =
    aiStatus === 'online' ? 'Online' : aiStatus === 'checking' ? 'Connecting' : 'Offline'

  return (
    <div className="w-full h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 md:p-10 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">Aligner Segmentation</h1>
          <p className="text-sm text-slate-400 mt-1">Connected satellite — shared pipeline configuration</p>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-xs">
          <span className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-700">{statusText}</p>
            {aiError && <p className="text-xs text-amber-700 mt-0.5">{aiError}</p>}
          </div>
          <span
            className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${
              aiStatus === 'online'
                ? 'bg-emerald-50 text-emerald-700'
                : aiStatus === 'checking'
                  ? 'bg-slate-100 text-slate-500'
                  : 'bg-amber-50 text-amber-700'
            }`}
          >
            {statusLabel}
          </span>
        </div>

        {/* Shared Pipeline Configuration */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-800">Shared Pipeline Configuration</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Managed by the WhiteSmile main system — no local setup needed
            </p>
          </div>
          <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <ConfigTile label="Stages" value={String(sharedConfig?.stages ?? '—')} />
            <ConfigTile label="Expansion" value={String(sharedConfig?.expansion ?? '—')} />
            <ConfigTile label="Shell (mm)" value={String(sharedConfig?.shellMm ?? '—')} />
            <ConfigTile label="Undercut (°)" value={String(sharedConfig?.undercutDeg ?? '—')} />
            <div className="col-span-2 sm:col-span-3">
              <ConfigTile label="Shared Storage" value={storageDir || sharedConfig?.storageFolder || '—'} mono />
            </div>
          </div>
        </div>

        <p className="text-[10px] text-slate-400 text-center">v1.0.0 — Connected satellite</p>
      </div>
    </div>
  )
}

function ConfigTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
      <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">{label}</div>
      <div className={`text-sm font-semibold text-slate-800 truncate ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </div>
    </div>
  )
}