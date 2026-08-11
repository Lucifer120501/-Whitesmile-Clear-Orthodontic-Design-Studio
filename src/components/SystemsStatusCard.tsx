import React from "react";
import { Cpu, Layers, Archive, ExternalLink, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { useSystemsStatus } from "../hooks/useSystemsStatus";

/**
 * WhiteSmile Unified Systems — vertical status card for the left sidebar.
 * Shows Main / Agliner / Ortho stacked top-to-bottom with shared storage + AI status.
 */
export default function SystemsStatusCard() {
  const { status, checking, checkStatus } = useSystemsStatus();

  const systemCards = [
    {
      id: "main" as const,
      name: "Main System",
      description: "AI brain · design studio · API keys",
      icon: <Layers className="w-5 h-5 text-white" />,
      up: true,
      url: status.main.url,
      badge: "ONLINE",
      color: "bg-[#46c0bd]",
    },
    {
      id: "agliner" as const,
      name: "Agliner Segmentation",
      description: "Tooth segmentation & export",
      icon: <Cpu className="w-5 h-5 text-white" />,
      up: status.agliner.up,
      url: status.agliner.url,
      badge: status.agliner.up ? "ONLINE" : "OFFLINE",
      color: status.agliner.up ? "bg-[#46c0bd]" : "bg-slate-400",
    },
    {
      id: "ortho" as const,
      name: "Ortho Staging & Render",
      description: "Aligner staging & design",
      icon: <Archive className="w-5 h-5 text-white" />,
      up: status.ortho.up,
      url: status.ortho.url,
      badge: status.ortho.up ? "ONLINE" : "OFFLINE",
      color: status.ortho.up ? "bg-[#46c0bd]" : "bg-slate-400",
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs">
      {/* Card header */}
      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-[#46c0bd]" />
          WhiteSmile Unified Systems
        </span>
        <button
          onClick={checkStatus}
          className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
          title="Refresh status"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Vertical system status list */}
      <div className="p-2 space-y-1">
        {systemCards.map((s) => (
          <div key={s.id} className="border border-slate-200 rounded-lg px-2 py-1.5 flex items-center gap-2">
            <div className={`w-7 h-7 rounded-lg ${s.color} flex items-center justify-center shrink-0`}>
              {s.icon}
            </div>
            <div className="min-w-0 flex-1 flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-800 truncate">{s.name}</span>
              {s.up ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
              ) : (
                <XCircle className="w-3 h-3 text-rose-500 shrink-0" />
              )}
              <span
                className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                  s.up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"
                }`}
              >
                {s.badge}
              </span>
            </div>
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="text-slate-300 hover:text-[#46c0bd] transition-colors shrink-0 cursor-pointer"
              title={`Open ${s.name} in a new tab`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        ))}

        {/* Shared storage + AI status */}
        <div className="pt-1.5 mt-1 border-t border-slate-100 text-[9px] space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-600 flex items-center gap-1 shrink-0">
              <Archive className="w-3 h-3 text-[#46c0bd]" />
              Storage:
            </span>
            <span
              className={`font-mono px-1.5 py-0.5 rounded truncate min-w-0 ${
                status.storageExists ? "bg-slate-50 text-slate-600" : "bg-amber-50 text-amber-700"
              }`}
              title={status.storageFolder || "not configured"}
            >
              {status.storageFolder || "not configured"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-600">WhiteSmile AI:</span>
            {status.aiAvailable ? (
              <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold">ONLINE</span>
            ) : (
              <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-bold">NO API KEY</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
