import React, { useEffect, useRef, useState } from 'react'
import type { PipelineLog } from '../types/pipeline'

interface TerminalPanelProps {
  logs: PipelineLog[]
  logRef: React.RefObject<HTMLDivElement | null>
}

const logColors: Record<PipelineLog['type'], string> = {
  stdout: 'text-gray-300',
  stderr: 'text-yellow-400',
  error: 'text-red-400',
  system: 'text-[#46c0bd]',
  info: 'text-gray-400',
  cmd: 'text-green-400',
  success: 'text-green-400',
}

export default function TerminalPanel({ logs, logRef }: TerminalPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="border-t border-gray-800 bg-gray-950 flex flex-col">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between px-4 py-1.5 bg-gray-900 hover:bg-gray-850 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Terminal</span>
          <span className="text-[10px] text-gray-600 font-mono">
            {logs.length} lines
          </span>
          {logs.some(l => l.type === 'error') && (
            <span className="text-[10px] text-red-400 font-medium">⚠ ERRORS</span>
          )}
        </div>
        <span className="text-gray-600 text-xs">{collapsed ? '▲' : '▼'}</span>
      </button>

      {/* Log area */}
      {!collapsed && (
        <div
          ref={logRef}
          className="overflow-y-auto font-mono text-xs leading-5 px-4 py-2"
          style={{
            height: '180px',
            background: '#050a15',
            scrollBehavior: 'smooth',
          }}
        >
          {logs.length === 0 ? (
            <span className="text-gray-700 italic">
              Pipeline output will appear here...
            </span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`${logColors[log.type]} whitespace-pre-wrap`}>
                {log.text}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
