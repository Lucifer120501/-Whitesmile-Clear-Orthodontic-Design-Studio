import { DentalCase } from "../types";
import { History, FileCode, Trash2, Calendar, HardDrive, CheckCircle2 } from "lucide-react";

interface CaseHistoryProps {
  cases: DentalCase[];
  onSelectCase: (c: DentalCase) => void;
  onDeleteCase: (id: string) => void;
  activeCaseId?: string;
}

export default function CaseHistory({ cases, onSelectCase, onDeleteCase, activeCaseId }: CaseHistoryProps) {
  const formatDate = (isoStr: string) => {
    try {
      const date = new Date(isoStr);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return isoStr;
    }
  };

  return (
    <div id="case-history-sidebar" className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
      <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
        <History className="w-5 h-5 text-blue-600" id="history-icon" />
        <h3 className="font-semibold text-slate-800 text-sm">Lab Case Logs</h3>
        <span className="ml-auto bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
          {cases.length} Total
        </span>
      </div>

      <div className="overflow-y-auto divide-y divide-slate-100 max-h-[220px]" id="history-list">
        {cases.length === 0 ? (
          <div className="p-8 text-center" id="empty-history">
            <p className="text-slate-400 text-sm italic">No cases logged yet.</p>
            <p className="text-slate-400 text-xs mt-1">Uploaded cases will show up here.</p>
          </div>
        ) : (
          cases.map((c) => {
            const isActive = c.id === activeCaseId;
            const appliance = c.result?.design_parameters?.appliance;
            const arch = c.result?.design_parameters?.arch;
            const warningsCount = c.result?.warnings?.length || 0;

            return (
              <div
                key={c.id}
                onClick={() => onSelectCase(c)}
                className={`p-4 text-left cursor-pointer transition-all ${
                  isActive
                    ? "bg-blue-50/50 border-l-4 border-blue-600"
                    : "hover:bg-slate-50/70 border-l-4 border-transparent"
                }`}
                id={`history-item-${c.id}`}
              >
                <div className="flex justify-between items-start mb-1.5">
                  <span className="font-mono text-xs font-semibold text-slate-800 uppercase">
                    {c.id}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {warningsCount > 0 ? (
                      <span className="bg-rose-50 text-rose-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-rose-100">
                        {warningsCount} Warning{warningsCount > 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-emerald-100 flex items-center gap-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        Clear
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteCase(c.id);
                      }}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                      title="Delete case log"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Prescription preview */}
                <p className="text-slate-600 text-xs line-clamp-2 leading-relaxed mb-3 pr-2">
                  {c.prescriptionText || "No prescription text provided."}
                </p>

                {/* Tags & Metadata */}
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 font-medium">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatDate(c.createdAt)}
                  </span>

                  {(() => {
                    const stlFiles = c.files.filter((f) => !f.isAttachment);
                    const attachmentFiles = c.files.filter((f) => f.isAttachment);
                    return (
                      <>
                        {stlFiles.length > 0 && (
                          <span className="flex items-center gap-1 bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                            <HardDrive className="w-3 h-3 text-slate-400" />
                            {stlFiles.length} STL
                          </span>
                        )}
                        {attachmentFiles.length > 0 && (
                          <span className="flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded">
                            <FileCode className="w-3 h-3 text-amber-500" />
                            {attachmentFiles.length} Attach.
                          </span>
                        )}
                      </>
                    );
                  })()}

                  {appliance && (
                    <span className={`px-1.5 py-0.5 rounded font-semibold ${
                      appliance === "Essix"
                        ? "bg-blue-100 text-blue-800"
                        : appliance === "Hawley"
                        ? "bg-indigo-100 text-indigo-800"
                        : "bg-slate-100 text-slate-700"
                    }`}>
                      {appliance} ({arch || "N/A"})
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
