import { useState } from "react";
import { RefreshCw, AlertCircle, Layers, Boxes, Clock, Brain, Activity } from "lucide-react";
import type { LeapResult } from "../types";

interface LeapClassificationCardProps {
  leap?: LeapResult;
  caseId?: string;
}

function confidenceColor(c: number): string {
  if (c >= 0.75) return "bg-emerald-500";
  if (c >= 0.5) return "bg-teal-500";
  if (c >= 0.3) return "bg-amber-500";
  return "bg-slate-400";
}

export default function LeapClassificationCard({ leap: initial, caseId }: LeapClassificationCardProps) {
  const [leap, setLeap] = useState<LeapResult | undefined>(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rerun = async () => {
    if (!caseId || running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/leap/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "LEAP classification failed.");
      setLeap(data.leap);
    } catch (e: any) {
      setError(e?.message || "LEAP classification failed.");
    } finally {
      setRunning(false);
    }
  };

  const isFailed = leap && leap.status === "failed";
  const mainPred = leap && leap.mainClass
    ? leap.predictions.find((p) => p.label === leap.mainClass)
    : null;

  return (
    <div className="bg-white dark:bg-slate-900 dark:border-slate-700/60 rounded-xl border border-slate-200 p-6 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded-xl">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-md font-bold text-slate-800 dark:text-slate-100">LEAP Malocclusion Classification</h2>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              Leading Enhancement Assistive Planning - 15-label 3D scan classification
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={rerun}
          disabled={running || !caseId}
          title={!caseId ? "Save the case first (no case id)" : "Run the classifier again"}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-500/10 hover:bg-cyan-100 dark:hover:bg-cyan-500/20 border border-cyan-200 dark:border-cyan-500/30 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
          {running ? "Classifying..." : "Re-run classification"}
        </button>
      </div>

      {running && !leap && (
        <div className="p-6 text-center">
          <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Voxelizing scan and classifying against 15 malocclusion labels...
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {isFailed && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-xs text-amber-800 dark:text-amber-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Automatic classification failed after the treatment plan: {leap?.error}</span>
        </div>
      )}

      {!leap && !running && !error && (
        <div className="p-6 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800/40">
          <p className="text-xs text-slate-500 dark:text-slate-400">No LEAP classification yet for this case.</p>
        </div>
      )}

      {leap && leap.status !== "failed" && (
        <div className="space-y-5">
          {/* Main class */}
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wide mb-1.5 flex items-center gap-1">
              <Activity className="w-3 h-3" /> Primary sagittal relationship
            </div>
            {leap.mainClass ? (
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-50 to-teal-50 dark:from-cyan-500/10 dark:to-teal-500/10 border border-cyan-200 dark:border-cyan-500/30">
                <span className="text-lg font-extrabold text-cyan-800 dark:text-cyan-300">{leap.mainClass}</span>
                {mainPred && (
                  <span className="text-[10px] font-bold text-cyan-600 dark:text-cyan-400 bg-white/70 dark:bg-slate-900/50 px-2 py-0.5 rounded-full">
                    {Math.round(mainPred.confidence * 100)}%
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs italic text-slate-400 dark:text-slate-500">
                No dominant sagittal class detected - see subclasses below
              </span>
            )}
          </div>
          {/* Subclasses */}
          {leap.subclasses.length > 0 && (
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wide mb-1.5">
                Detected subclasses ({leap.subclasses.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {leap.subclasses.map((s) => (
                  <span
                    key={s}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-500/30"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Top-5 predictions with confidence bars */}
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wide mb-1.5">
              Top predictions (ranked by confidence)
            </div>
            <div className="space-y-2">
              {leap.predictions.map((p, i) => (
                <div key={p.label + i} className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-[9px] font-bold text-slate-500 dark:text-slate-400 flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 w-44 truncate">{p.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${confidenceColor(p.confidence)}`}
                      style={{ width: `${Math.round(p.confidence * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 w-9 text-right">
                    {Math.round(p.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Rule-engine combinations */}
          {leap.combinations.length > 0 && (
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wide mb-1.5 flex items-center gap-1">
                <Layers className="w-3 h-3" /> Rule-engine combinations
              </div>
              <div className="flex flex-wrap gap-1.5">
                {leap.combinations.map((c) => (
                  <span
                    key={c}
                    className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Clinical summary */}
          {leap.clinicalSummary && (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/60">
              <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wide mb-1">
                Diagnostic rationale
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{leap.clinicalSummary}</p>
            </div>
          )}

          {/* Sequencing note */}
          {leap.sequencingNote && (
            <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
              <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#46c0bd]" />
              <span>
                <span className="font-bold text-slate-700 dark:text-slate-200">Staging impact: </span>
                {leap.sequencingNote}
              </span>
            </div>
          )}

          {/* Voxelization footer */}
          {leap.voxelization && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 dark:text-slate-500">
              <span className="flex items-center gap-1">
                <Boxes className="w-3 h-3" />
                Voxel grid: <span className="font-mono font-bold">{leap.voxelization.grid}</span>
              </span>
              <span>
                Meshes: <span className="font-bold">{leap.voxelization.meshes}</span>
              </span>
              <span>
                Triangles: <span className="font-bold">{leap.voxelization.triangles.toLocaleString()}</span>
              </span>
              {leap.generatedAt && (
                <span className="ml-auto">Generated {new Date(leap.generatedAt).toLocaleString()}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}