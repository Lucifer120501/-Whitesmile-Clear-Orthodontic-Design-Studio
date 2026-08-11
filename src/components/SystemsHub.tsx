import React from "react";
import { Archive, Eye, RefreshCw, XCircle, Loader2 } from "lucide-react";
import { useSystemsStatus } from "../hooks/useSystemsStatus";

/**
 * WhiteSmile Systems Hub — embedded panels for the agliner segmentation
 * pipeline and the ortho staging/render pipeline, proxied under the SAME
 * origin (localhost:3000/agliner, localhost:3000/ortho). System status is
 * shown in the sidebar via SystemsStatusCard (shared hook).
 */
export default function SystemsHub() {
  const { status, checking, checkStatus } = useSystemsStatus();

  return (
    <div className="space-y-4">
      {/* Embedded systems — stacked vertically */}

      {/* Ortho Staging & Render */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <Archive className="w-4 h-4 text-[#46c0bd]" />
          <span className="text-sm font-bold text-slate-800">Ortho Staging &amp; Render</span>
          <div className="ml-auto flex items-center gap-2">
            {checking && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
            <span className={`text-[10px] font-semibold ${status.ortho.up ? "text-emerald-600" : "text-rose-500"}`}>
              {status.ortho.up ? "● LIVE" : "● OFFLINE — start this system first"}
            </span>
          </div>
        </div>

        {status.ortho.up ? (
          <iframe
            src={`${status.ortho.url}?setup=1`}
            title="Ortho Staging & Render Pipeline"
            className="w-full border-0"
            style={{ height: 480, background: "#f8fafc" }}
          />
        ) : (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 mx-auto mb-3 flex items-center justify-center">
              <XCircle className="w-6 h-6 text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-600">Ortho staging &amp; render is starting…</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              The main system launches both satellites automatically on startup. If this stays offline,
              check the terminal running <code className="font-mono text-slate-600">npm run dev</code> for errors.
            </p>
            <button
              onClick={checkStatus}
              className="mt-4 text-xs font-semibold text-white bg-[#46c0bd] hover:bg-[#3ba6a3] rounded-lg px-4 py-2 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />
              Check Again
            </button>
          </div>
        )}
      </div>

      {/* Design Viewer — separate card, like the Ortho card above */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <Eye className="w-4 h-4 text-[#46c0bd]" />
          <span className="text-sm font-bold text-slate-800">Design Viewer</span>
          <div className="ml-auto flex items-center gap-2">
            {checking && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
            <span className={`text-[10px] font-semibold ${status.ortho.up ? "text-emerald-600" : "text-rose-500"}`}>
              {status.ortho.up ? "● LIVE" : "● OFFLINE"}
            </span>
          </div>
        </div>

        {status.ortho.up ? (
          <iframe
            src={`${status.ortho.url}?viewer=1`}
            title="Design Viewer"
            className="w-full border-0"
            style={{ height: 520, background: "#0d0d1a" }}
          />
        ) : (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 mx-auto mb-3 flex items-center justify-center">
              <XCircle className="w-6 h-6 text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-600">Design viewer is starting…</p>
            <button
              onClick={checkStatus}
              className="mt-4 text-xs font-semibold text-white bg-[#46c0bd] hover:bg-[#3ba6a3] rounded-lg px-4 py-2 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />
              Check Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
