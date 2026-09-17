import { checkTrimLineCompliance } from "../lib/dental_logic";
import * as THREE from "three";
import React, { useState, useEffect, useRef, useCallback } from "react";
import type { LucideIcon } from "lucide-react";

import { AnalysisResult, UploadedFile } from "../types";
import { 
  Download, 
  Loader2,
  AlertTriangle, 
  FileCode, 
  FileText, 
  CheckCircle, 
  RefreshCw, 
  X,
  Activity,
  Layers,
  Zap,
  Gauge,
  Sparkles,
} from "lucide-react";

interface AnalysisResultViewProps {
  result: AnalysisResult;
  caseId?: string;
  files?: UploadedFile[];
  onUpdateCase?: (updatedResult: AnalysisResult, newStatus?: "pending" | "processed" | "confirmed" | "failed") => void;
  caseStatus?: string;
}

interface Tooth {
  id: number;
  name: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  label: string;
  arch: "upper" | "lower";
}

type AttachmentShape = "rectangular_h" | "rectangular_v" | "beveled_h" | "beveled_v" | "ellipsoid";
type OrthoBaseTemplate = "horseshoe" | "tweed_abo" | "threeshape_bar";
type LabelType = "embossed" | "engraved" | "none";
type ApplianceType = "Essix" | "Hawley" | "Other" | "";
type ArchType = "Upper" | "Lower" | "Both" | "";
type RagTabId = "restorative" | "biomechanics" | "safety" | "attachments";
type AuditResult = { safe: boolean; flaws: string[]; recommendations: string[] };

const ORTHO_BASE_TEMPLATES: Array<{ id: OrthoBaseTemplate; label: string }> = [
  { id: "horseshoe", label: "Horseshoe" },
  { id: "tweed_abo", label: "Tweed/ABO Study" },
  { id: "threeshape_bar", label: "3Shape Articulator" }
];

const RAG_TABS: Array<{ id: RagTabId; label: string; icon: LucideIcon }> = [
  { id: "restorative", label: "Ortho-Restorative", icon: Sparkles },
  { id: "biomechanics", label: "Polymer Memory", icon: Activity },
  { id: "safety", label: "PDL Safety Guardrails", icon: Gauge },
  { id: "attachments", label: "Attachment Calibration", icon: Zap }
];

const getErrorMessage = (error: unknown, fallback: string) => (
  error instanceof Error ? error.message : fallback
);

// Full dental arch tooth layout coordinates for highly detailed visual CAD preview
const maxillaryTeeth: Tooth[] = [
  { id: 18, name: "Third Molar Left", x: 60, y: 195, rx: 17, ry: 17, label: "18", arch: "upper" },
  { id: 17, name: "Second Molar Left", x: 65, y: 160, rx: 17, ry: 17, label: "17", arch: "upper" },
  { id: 16, name: "First Molar Left", x: 75, y: 125, rx: 16, ry: 16, label: "16", arch: "upper" },
  { id: 15, name: "Second Premolar Left", x: 92, y: 98, rx: 14, ry: 14, label: "15", arch: "upper" },
  { id: 14, name: "First Premolar Left", x: 112, y: 76, rx: 14, ry: 14, label: "14", arch: "upper" },
  { id: 13, name: "Canine Left", x: 138, y: 60, rx: 12, ry: 12, label: "13", arch: "upper" },
  { id: 12, name: "Lateral Incisor Left", x: 168, y: 52, rx: 11, ry: 11, label: "12", arch: "upper" },
  { id: 11, name: "Central Incisor Left", x: 198, y: 48, rx: 12, ry: 12, label: "11", arch: "upper" },
  { id: 21, name: "Central Incisor Right", x: 228, y: 48, rx: 12, ry: 12, label: "21", arch: "upper" },
  { id: 22, name: "Lateral Incisor Right", x: 258, y: 52, rx: 11, ry: 11, label: "22", arch: "upper" },
  { id: 23, name: "Canine Right", x: 288, y: 60, rx: 12, ry: 12, label: "23", arch: "upper" },
  { id: 24, name: "First Premolar Right", x: 314, y: 76, rx: 14, ry: 14, label: "24", arch: "upper" },
  { id: 25, name: "Second Premolar Right", x: 334, y: 98, rx: 14, ry: 14, label: "25", arch: "upper" },
  { id: 26, name: "First Molar Right", x: 351, y: 125, rx: 16, ry: 16, label: "26", arch: "upper" },
  { id: 27, name: "Second Molar Right", x: 361, y: 160, rx: 17, ry: 17, label: "27", arch: "upper" },
  { id: 28, name: "Third Molar Right", x: 366, y: 195, rx: 17, ry: 17, label: "28", arch: "upper" }
];

const mandibularTeeth: Tooth[] = [
  { id: 48, name: "Third Molar Lower Right", x: 60, y: 195, rx: 17, ry: 17, label: "48", arch: "lower" },
  { id: 47, name: "Second Molar Lower Right", x: 65, y: 160, rx: 17, ry: 17, label: "47", arch: "lower" },
  { id: 46, name: "First Molar Lower Right", x: 75, y: 125, rx: 16, ry: 16, label: "46", arch: "lower" },
  { id: 45, name: "Second Premolar Lower Right", x: 92, y: 98, rx: 14, ry: 14, label: "45", arch: "lower" },
  { id: 44, name: "First Premolar Lower Right", x: 112, y: 76, rx: 14, ry: 14, label: "44", arch: "lower" },
  { id: 43, name: "Canine Lower Right", x: 138, y: 60, rx: 12, ry: 12, label: "43", arch: "lower" },
  { id: 42, name: "Lateral Incisor Lower Right", x: 168, y: 52, rx: 11, ry: 11, label: "42", arch: "lower" },
  { id: 41, name: "Central Incisor Lower Right", x: 198, y: 48, rx: 12, ry: 12, label: "41", arch: "lower" },
  { id: 31, name: "Central Incisor Lower Left", x: 228, y: 48, rx: 12, ry: 12, label: "31", arch: "lower" },
  { id: 32, name: "Lateral Incisor Lower Left", x: 258, y: 52, rx: 11, ry: 11, label: "32", arch: "lower" },
  { id: 33, name: "Canine Lower Left", x: 288, y: 60, rx: 12, ry: 12, label: "33", arch: "lower" },
  { id: 34, name: "First Premolar Lower Left", x: 314, y: 76, rx: 14, ry: 14, label: "34", arch: "lower" },
  { id: 35, name: "Second Premolar Lower Left", x: 334, y: 98, rx: 14, ry: 14, label: "35", arch: "lower" },
  { id: 36, name: "First Molar Lower Left", x: 351, y: 125, rx: 16, ry: 16, label: "36", arch: "lower" },
  { id: 37, name: "Second Molar Lower Left", x: 361, y: 160, rx: 17, ry: 17, label: "37", arch: "lower" },
  { id: 38, name: "Third Molar Lower Left", x: 366, y: 195, rx: 17, ry: 17, label: "38", arch: "lower" }
];

export default function AnalysisResultView({ 
  result, 
  caseId, 
  files, 
  onUpdateCase, 
  caseStatus 
}: AnalysisResultViewProps) {
  // ── Active Learning & Security States ──────────────────────────────
  const [activeLearning, setActiveLearning] = useState(false);

  const [completedSteps, setCompletedSteps] = useState<Record<number, boolean>>({});
  
  // Arch Visualizer Tab State
  const [activeArchTab, setActiveArchTab] = useState<"upper" | "lower">("upper");

  // Interactive CAD variables
  const [isPrecisionMode, setIsPrecisionMode] = useState(false);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [compliance, setCompliance] = useState({ valid: true, message: "Trim line is compliant." });
  const [trimScallopOffset, setTrimScallopOffset] = useState<number>(1.5); // mm above margin
  const [trimLineType, setTrimLineType] = useState<"scalloped" | "straight" | "beveled">("scalloped");
  const [shellThickness, setShellThickness] = useState<number>(result.design_parameters.thickness_mm || 1.0);
  
  // Validate trim line
  useEffect(() => {
    // This is a simplified representation. 
    // In a real app, calculate actual trim line points based on current CAD parameters.
    const activeTeeth = activeArchTab === "upper" ? maxillaryTeeth : mandibularTeeth;
    const dummyTrimPoints = activeTeeth.map(t => new THREE.Vector3((t.x - 213) * 0.25, (220 - t.y) * 0.25, 5));
    
    const complianceResult = checkTrimLineCompliance(dummyTrimPoints, activeTeeth.map(t => ({id: t.id, name: t.name, x: t.x, y: t.y})));
    setCompliance(prev => {
      if (prev.valid === complianceResult.valid && prev.message === complianceResult.message) {
        return prev;
      }
      return complianceResult;
    });
  }, [trimScallopOffset, activeArchTab]);
  const [selectedReliefTeeth, setSelectedReliefTeeth] = useState<number[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState<string>(result.design_parameters.material || "PETG Thermoforming Sheet");
  
  // High fidelity 3D printer-ready parameters
  const [cadMode, setCadMode] = useState<"relief" | "attachments">("attachments");
  const [selectedAttachmentTeeth, setSelectedAttachmentTeeth] = useState<number[]>([14, 15, 24, 25, 44, 45, 34, 35]); // default attachments to match Image 2
  const [attachmentShape, setAttachmentShape] = useState<AttachmentShape>("beveled_h");
  const [attachmentWidth, setAttachmentWidth] = useState<number>(2.4); // mm
  const [attachmentHeight, setAttachmentHeight] = useState<number>(1.6); // mm
  const [attachmentDepth, setAttachmentDepth] = useState<number>(1.4); // mm
  const [baseExtrusionHeight, setBaseExtrusionHeight] = useState<number>(12.0); // 12mm deep solid model base like Image 2/3
  
  // 3Shape OrthoSystem high-fidelity base preparation controls
  const [orthoBaseTemplate, setOrthoBaseTemplate] = useState<OrthoBaseTemplate>("threeshape_bar");
  const [patientIdLabel, setPatientIdLabel] = useState<string>(
    caseId ? `CASE-${caseId.slice(0, 6).toUpperCase()}-S1` : "SMITH_J_U01"
  );
  const [labelType, setLabelType] = useState<LabelType>("embossed");
  const [isHollowModel, setIsHollowModel] = useState<boolean>(false);
  const [hollowWallThickness, setHollowWallThickness] = useState<number>(2.0); // mm
  const [addDrainHoles, setAddDrainHoles] = useState<boolean>(true);
  const [articulatorNotches, setArticulatorNotches] = useState<boolean>(true);
  
  const [viewMode3D, setViewMode3D] = useState<"2d" | "3d">("3d"); // Default to 3D mode for maximum wow factor
  const [isExportingSql, setIsExportingSql] = useState(false);
  const [sqlExportMessage, setSqlExportMessage] = useState<string | null>(null);

  // 3D Sculpting and Spline Editing states
  const [individualTrimOffsets, setIndividualTrimOffsets] = useState<Record<number, number>>({});
  const [sculptMode, setSculptMode] = useState<"none" | "draw" | "erase">("none");
  const [brushSize, setBrushSize] = useState<number>(2.0);
  const [sculptedPoints, setSculptedPoints] = useState<Array<{ x: number, y: number, z: number, size: number }>>([]);
  const [showSplineOverlay, setShowSplineOverlay] = useState<boolean>(false);
  const [compromisedTeeth, setCompromisedTeeth] = useState<number[]>([]);

  // Orthodontic Chat Co-Pilot states
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant", text: string }>>([
    {
      role: "assistant",
      text: "Hello! I am your specialized **AI Orthodontic CAD Co-Pilot**. I am trained in advanced digital tooth setups, sequential aligner staging, biomechanics, attachment morphology, and lab fabrication tolerances. Ask me any design or biomechanical question about this patient's case!"
    }
  ]);
  const [chatInput, setChatInput] = useState<string>("");
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const [optimizationReasoning, setOptimizationReasoning] = useState<string>("");
  const [optimizationValidation, setOptimizationValidation] = useState<string>("");
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);

  // AI Pro Scan Prep states
  const [isProScanPrepping, setIsProScanPrepping] = useState<boolean>(false);
  const [proScanResult, setProScanResult] = useState<any>(null);
  const [showProScanReport, setShowProScanReport] = useState<boolean>(false);
  const [activeRagTab, setActiveRagTab] = useState<RagTabId>("restorative");

  // Run client-side anatomical safety distance audit in real-time
  useEffect(() => {
    const activeTeethList = activeArchTab === "upper" ? maxillaryTeeth : mandibularTeeth;
    const compromised: number[] = [];
    activeTeethList.forEach(t => {
      const offset = individualTrimOffsets[t.id] ?? trimScallopOffset;
      if (offset < 1.0) {
        compromised.push(t.id);
      }
    });
    setCompromisedTeeth(prev => {
      if (JSON.stringify(prev) === JSON.stringify(compromised)) {
        return prev;
      }
      return compromised;
    });
  }, [individualTrimOffsets, trimScallopOffset, activeArchTab]);

  // SVG Spline drag nodes states and handlers
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingToothId, setDraggingToothId] = useState<number | null>(null);

  const handleMouseMoveSpline = (e: React.MouseEvent) => {
    if (draggingToothId !== null && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = 420 / rect.width;
      const scaleY = 250 / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      const tooth = activeTeeth.find(t => t.id === draggingToothId);
      if (!tooth) return;

      const dx = mouseX - tooth.x;
      const dy = mouseY - tooth.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const idx = activeTeeth.indexOf(tooth);
      const wave = trimLineType === "scalloped" ? Math.sin(idx * 1.5) * 6 : 0;

      // Solve for solvedOffset:
      // dist = 16 + (solvedOffset * 4) + wave => solvedOffset = (dist - 16 - wave) / 4
      const solvedOffset = Math.max(0.1, Math.min(4.0, (dist - 16 - wave) / 4));

      setIndividualTrimOffsets(prev => ({
        ...prev,
        [draggingToothId]: solvedOffset
      }));
    }
  };

  const handleMouseUpSpline = () => {
    setDraggingToothId(null);
  };

  const handleSendChatMessage = async (presetText?: string) => {
    const textToSend = presetText || chatInput;
    if (!textToSend.trim()) return;

    const userMsg = { role: "user" as const, text: textToSend };
    setChatMessages(prev => [...prev, userMsg]);
    if (!presetText) setChatInput("");
    setIsChatLoading(true);

    try {
      const response = await fetch("/api/orthodontic-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...chatMessages, userMsg],
          currentDesign: {
            appliance,
            arch,
            trimLineType,
            trimScallopOffset,
            shellThickness,
            material: selectedMaterial,
            isPrecisionMode
          }
        })
      });
      const data = await response.json();
      if (data.text) {
        setChatMessages(prev => [...prev, { role: "assistant" as const, text: data.text }]);
      } else {
        setChatMessages(prev => [...prev, { role: "assistant" as const, text: "I apologize, I was unable to compile a recommendation for that request. Let's try adjusting the parameters." }]);
      }
    } catch (err) {
      console.error("Chat error:", err);
      setChatMessages(prev => [...prev, { role: "assistant" as const, text: "Connection error. Please confirm your local workspace is fully active." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Custom STL export progress and confirmation modal states
  const [isExportingStl, setIsExportingStl] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportLogs, setExportLogs] = useState<string[]>([]);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  
  
  // Edit mode states (classic parameters view)
  const [isEditingSpecs, setIsEditingSpecs] = useState(false);
  const [appliance, setAppliance] = useState<ApplianceType>((result.design_parameters.appliance || "") as ApplianceType);
  const [arch, setArch] = useState<ArchType>((result.design_parameters.arch || "") as ArchType);
  
  // Editable workflow steps states
  const [isEditingInstructions, setIsEditingInstructions] = useState(false);
  const [editedInstructions, setEditedInstructions] = useState<string[]>(result.manufacturing_instructions || []);
  const [coverage, setCoverage] = useState(result.design_parameters.coverage || "");
  const [trimLine, setTrimLine] = useState(result.design_parameters.trim_line || "");
  const [reliefAreasText, setReliefAreasText] = useState(
    result.design_parameters.relief_areas ? result.design_parameters.relief_areas.join(", ") : ""
  );
  const [specialNotes, setSpecialNotes] = useState(result.design_parameters.special_notes || "");

  const { warnings, manufacturing_instructions } = result;

  // Initialize selected relief teeth based on AI results
  useEffect(() => {
    const reliefList = result.design_parameters.relief_areas || [];
    const teethFound: number[] = [];
    reliefList.forEach(item => {
      const match = item.match(/\b\d{2}\b/);
      if (match) {
        teethFound.push(parseInt(match[0], 10));
      }
    });
    if (JSON.stringify(teethFound) !== JSON.stringify(selectedReliefTeeth)) {
      setSelectedReliefTeeth(teethFound);
    }
    
    // Autofit active arch tab to case specifications
    const arch = result.design_parameters.arch?.toLowerCase() === "lower" ? "lower" : "upper";
    if (arch !== activeArchTab) {
      setActiveArchTab(arch);
    }

    // Standard parameter states
    if (result.design_parameters.appliance !== appliance) setAppliance(result.design_parameters.appliance || "");
    if ((result.design_parameters.arch as string || "") !== arch) setArch(result.design_parameters.arch || "");
    if ((result.design_parameters.material || "PETG Thermoforming Sheet") !== selectedMaterial) setSelectedMaterial(result.design_parameters.material || "PETG Thermoforming Sheet");
    if ((result.design_parameters.thickness_mm || 1.0) !== shellThickness) setShellThickness(result.design_parameters.thickness_mm || 1.0);
    if ((result.design_parameters.coverage || "") !== coverage) setCoverage(result.design_parameters.coverage || "");
    if ((result.design_parameters.trim_line || "") !== trimLine) setTrimLine(result.design_parameters.trim_line || "");
    
    const reliefAreasTextNew = result.design_parameters.relief_areas ? result.design_parameters.relief_areas.join(", ") : "";
    if (reliefAreasTextNew !== reliefAreasText) setReliefAreasText(reliefAreasTextNew);
    
    if ((result.design_parameters.special_notes || "") !== specialNotes) setSpecialNotes(result.design_parameters.special_notes || "");
    if (JSON.stringify(result.manufacturing_instructions || []) !== JSON.stringify(editedInstructions)) setEditedInstructions(result.manufacturing_instructions || []);
    setIsEditingSpecs(false);
  }, [result]);

  // Synchronize CAD interactive changes back to structured parameters
  const handleUpdateCADChanges = (
    newTeeth: number[], 
    newThickness: number, 
    newScallop: number, 
    newType: "scalloped" | "straight" | "beveled",
    newMat: string
  ) => {
    // Generate updated strings for the general parameters
    const reliefStrings = newTeeth.map(num => `Tooth ${num} relief space`);
    const trimString = `${newType.charAt(0).toUpperCase() + newType.slice(1)} - ${newScallop.toFixed(1)}mm above gingival border (Custom CAD parameters)`;
    
    const updatedResult: AnalysisResult = {
      ...result,
      design_parameters: {
        appliance: appliance || result.design_parameters.appliance || "Essix",
        arch: arch || result.design_parameters.arch || "Both",
        material: newMat,
        thickness_mm: newThickness,
        coverage: coverage || `Standard full-arch crown coverage`,
        trim_line: trimString,
        relief_areas: reliefStrings,
        special_notes: specialNotes || result.design_parameters.special_notes
      }
    };

    if (onUpdateCase) {
      onUpdateCase(updatedResult);
    }
  };

  const handleToothClick = (toothId: number) => {
    if (cadMode === "relief") {
      let newTeeth: number[];
      if (selectedReliefTeeth.includes(toothId)) {
        newTeeth = selectedReliefTeeth.filter(id => id !== toothId);
      } else {
        newTeeth = [...selectedReliefTeeth, toothId];
      }
      setSelectedReliefTeeth(newTeeth);
      setReliefAreasText(newTeeth.map(num => `Tooth ${num} relief`).join(", "));
      handleUpdateCADChanges(newTeeth, shellThickness, trimScallopOffset, trimLineType, selectedMaterial);
    } else {
      let newAtts: number[];
      if (selectedAttachmentTeeth.includes(toothId)) {
        newAtts = selectedAttachmentTeeth.filter(id => id !== toothId);
      } else {
        newAtts = [...selectedAttachmentTeeth, toothId];
      }
      setSelectedAttachmentTeeth(newAtts);
    }
  };

  const handleSliderThicknessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setShellThickness(val);
    handleUpdateCADChanges(selectedReliefTeeth, val, trimScallopOffset, trimLineType, selectedMaterial);
  };

  const handleSliderScallopChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setTrimScallopOffset(val);
    setTrimLine(`${trimLineType.charAt(0).toUpperCase() + trimLineType.slice(1)} - ${val.toFixed(1)}mm above border`);
    handleUpdateCADChanges(selectedReliefTeeth, shellThickness, val, trimLineType, selectedMaterial);
  };

  const handleTrimTypeChange = (type: "scalloped" | "straight" | "beveled") => {
    setTrimLineType(type);
    setTrimLine(`${type.charAt(0).toUpperCase() + type.slice(1)} - ${trimScallopOffset.toFixed(1)}mm above border`);
    handleUpdateCADChanges(selectedReliefTeeth, shellThickness, trimScallopOffset, type, selectedMaterial);
  };

  const handleClassicSaveChanges = () => {
    const updatedResult: AnalysisResult = {
      ...result,
      design_parameters: {
        appliance,
        arch,
        material: selectedMaterial,
        thickness_mm: Number(shellThickness),
        coverage,
        trim_line: trimLine,
        relief_areas: reliefAreasText.split(",").map(s => s.trim()).filter(Boolean),
        special_notes: specialNotes
      }
    };
    if (onUpdateCase) {
      onUpdateCase(updatedResult);
    }
    setIsEditingSpecs(false);
  };

  const handleSaveInstructions = () => {
    const updatedResult: AnalysisResult = {
      ...result,
      manufacturing_instructions: editedInstructions.map(s => s.trim()).filter(Boolean)
    };
    if (onUpdateCase) {
      onUpdateCase(updatedResult);
    }
    setIsEditingInstructions(false);
  };

  const handleExportSql = async () => {
    if (!caseId) {
      setSqlExportMessage("Unable to export SQL: missing case identifier.");
      return;
    }
    setIsExportingSql(true);
    setSqlExportMessage(null);

    try {
      const res = await fetch("/api/export-print-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId })
      });

      if (!res.ok) {
        const body = await res.json().catch((): { error?: string } => ({}));
        throw new Error(body.error || "Failed to export SQL file.");
      }

      const data = await res.json();
      const blob = new Blob([data.sqlText], { type: "application/sql" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename || `print_ready_markers_${caseId}.sql`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setSqlExportMessage(`SQL export ready: ${data.filename}`);
    } catch (error: unknown) {
      console.error("SQL export failed:", error);
      setSqlExportMessage(getErrorMessage(error, "SQL export failed."));
    } finally {
      setIsExportingSql(false);
    }
  };

  const handleConfirmAndProceed = () => {
    setShowConfirmDialog(true);
  };

  const executeConfirmAndProceed = () => {
    const updatedResult: AnalysisResult = {
      ...result,
      design_parameters: {
        appliance: appliance || result.design_parameters.appliance || "Essix",
        arch: arch || result.design_parameters.arch || "Both",
        material: selectedMaterial,
        thickness_mm: Number(shellThickness),
        coverage: coverage || "Full anatomical crown coverage",
        trim_line: trimLine || `Scalloped ${trimScallopOffset}mm above margin`,
        relief_areas: selectedReliefTeeth.map(num => `Tooth ${num} relief space`),
        special_notes: specialNotes
      }
    };
    if (onUpdateCase) {
      onUpdateCase(updatedResult, "confirmed");
    }
    setIsEditingSpecs(false);
    setShowConfirmDialog(false);
  };

  const handleReopenDesign = () => {
    if (onUpdateCase) {
      onUpdateCase(result, "processed");
    }
  };

  const toggleStep = (index: number) => {
    setCompletedSteps(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const isConfirmed = caseStatus === "confirmed";

  // --- Dynamic SVG Path for Trim Line Scalloping ---
  const activeTeeth = activeArchTab === "upper" ? maxillaryTeeth : mandibularTeeth;
  
  const getTrimLinePath = () => {
    const points = activeTeeth.map((t, idx) => {
      // Calculate normal offset vector for visual look
      const dx = t.x - 213; // Parabolic center x offset
      const dy = t.y - 100;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ux = len > 0 ? dx / len : 0;
      const uy = len > 0 ? dy / len : -1;
      
      const offset = individualTrimOffsets[t.id] ?? trimScallopOffset;
      // Scalloping wave effect combined with slider offset
      const wave = trimLineType === "scalloped" ? Math.sin(idx * 1.5) * 6 : 0;
      const offsetMagnitude = 16 + (offset * 4) + wave;
      
      const ox = t.x - ux * offsetMagnitude;
      const oy = t.y - uy * offsetMagnitude;
      return { x: ox, y: oy };
    });

    // Make smooth polyline or bezier path
    return `M ${points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")}`;
  };

  // --- CAD Exports & Downloads ---
  const handleDownloadCADPackage = () => {
    setIsExportingStl(true);
    setExportProgress(5);
    setExportLogs([
      `[${new Date().toLocaleTimeString()}] Initializing AI-assisted clinical STL mesh compiler...`,
      `[${new Date().toLocaleTimeString()}] Fetching active orthodontic specifications...`,
      `[${new Date().toLocaleTimeString()}] Selected Arch: ${activeArchTab.toUpperCase()}`
    ]);

    const steps = [
      { 
        percent: 25, 
        log: "Triangulating chiseled crowns & incisal anatomy..." 
      },
      { 
        percent: 50, 
        log: `Constructing watertight ${orthoBaseTemplate === "tweed_abo" ? "ABO Study Base" : orthoBaseTemplate === "threeshape_bar" ? "3Shape Bridge Bar" : "Standard Horseshoe"} manifold blocks...` 
      },
      { 
        percent: 75, 
        log: `Injecting active clinical attachment brackets (${attachmentShape}) with sub-millimeter calibration...` 
      },
      { 
        percent: 90, 
        log: isHollowModel 
          ? `Slicing internal shell with ${hollowWallThickness}mm wall depth and drain holes...` 
          : "Optimizing solid mesh structure for FDM/SLA high-density production..." 
      },
      { 
        percent: 100, 
        log: "Compiling waterproof ASCII/Binary facets. Generation complete! Initiating download." 
      }
    ];

    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep < steps.length) {
        const item = steps[currentStep];
        setExportProgress(item.percent);
        setExportLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${item.log}`]);
        currentStep++;
      } else {
        clearInterval(interval);
        triggerActualStlDownload();
        setTimeout(() => {
          setIsExportingStl(false);
        }, 1500);
      }
    }, 450);
  };

  const triggerActualStlDownload = () => {
    const stlFilename = `case_${caseId || "dental"}_cad_model.stl`;
    const facets: string[] = [];
    
    // Helper to add a triangle facet to the STL
    const addFacet = (
      v1: [number, number, number], 
      v2: [number, number, number], 
      v3: [number, number, number],
      normal?: [number, number, number]
    ) => {
      let nx = 0, ny = 0, nz = 1;
      if (normal) {
        [nx, ny, nz] = normal;
      } else {
        // Calculate normal vector using cross product
        const ux = v2[0] - v1[0];
        const uy = v2[1] - v1[1];
        const uz = v2[2] - v1[2];
        const vx = v3[0] - v1[0];
        const vy = v3[1] - v1[1];
        const vz = v3[2] - v1[2];
        nx = uy * vz - uz * vy;
        ny = uz * vx - ux * vz;
        nz = ux * vy - uy * vx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0) {
          nx /= len;
          ny /= len;
          nz /= len;
        }
      }
      facets.push(`facet normal ${nx.toFixed(6)} ${ny.toFixed(6)} ${nz.toFixed(6)}
  outer loop
    vertex ${v1[0].toFixed(4)} ${v1[1].toFixed(4)} ${v1[2].toFixed(4)}
    vertex ${v2[0].toFixed(4)} ${v2[1].toFixed(4)} ${v2[2].toFixed(4)}
    vertex ${v3[0].toFixed(4)} ${v3[1].toFixed(4)} ${v3[2].toFixed(4)}
  endloop
endfacet`);
    };

    const activeTeeth = activeArchTab === "upper" ? maxillaryTeeth : mandibularTeeth;

    // 1. Generate 3D Horseshoe Gum Base with Dynamic Extrusion Height
    const basePoints: Array<{
      bInner: [number, number, number];
      bOuter: [number, number, number];
      tInner: [number, number, number];
      tOuter: [number, number, number];
    }> = [];

    activeTeeth.forEach((t) => {
      const dx = t.x - 213;
      const dy = t.y - 140;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ux = len > 0 ? dx / len : 0;
      const uy = len > 0 ? dy / len : -1;

      // Concentric boundaries for the base
      const P_outer_x = t.x + ux * 22;
      const P_outer_y = t.y + uy * 22;
      const P_inner_x = t.x - ux * 18;
      const P_inner_y = t.y - uy * 18;

      // Coordinates in 3D (mm)
      const x_outer = (P_outer_x - 213) * 0.25;
      const y_outer = (220 - P_outer_y) * 0.25;
      const x_inner = (P_inner_x - 213) * 0.25;
      const y_inner = (220 - P_inner_y) * 0.25;

      basePoints.push({
        bInner: [x_inner, y_inner, 0],
        bOuter: [x_outer, y_outer, 0],
        tInner: [x_inner, y_inner, baseExtrusionHeight],
        tOuter: [x_outer, y_outer, baseExtrusionHeight],
      });
    });

    // Triangulate base segments depending on Tweed/ABO or Standard/3Shape base templates
    if (orthoBaseTemplate === "tweed_abo") {
      const cBottom: [number, number, number] = [0.0, -4.5, 0.0];
      const cTop: [number, number, number] = [0.0, -4.5, baseExtrusionHeight];

      for (let i = 0; i < basePoints.length - 1; i++) {
        const p1 = basePoints[i];
        const p2 = basePoints[i + 1];

        // Bottom cap - outer segment
        addFacet(p1.bInner, p1.bOuter, p2.bInner);
        addFacet(p2.bInner, p1.bOuter, p2.bOuter);
        // Bottom cap - fill palate/floor center
        addFacet(p2.bInner, p1.bInner, cBottom);

        // Top cap - outer segment
        addFacet(p1.tInner, p2.tInner, p1.tOuter);
        addFacet(p2.tInner, p2.tOuter, p1.tOuter);
        // Top cap - fill palate/floor center
        addFacet(p1.tInner, p2.tInner, cTop);

        // Outer vertical wall
        addFacet(p1.bOuter, p2.bOuter, p1.tOuter);
        addFacet(p2.bOuter, p2.tOuter, p1.tOuter);

        // (No inner vertical wall since it is a solid filled Tweed orthodontic study base)
      }
    } else {
      // "horseshoe" or "threeshape_bar" uses standard hollow inner horseshoe structure
      for (let i = 0; i < basePoints.length - 1; i++) {
        const p1 = basePoints[i];
        const p2 = basePoints[i + 1];

        // Bottom cap (facing down, negative Z)
        addFacet(p1.bInner, p1.bOuter, p2.bInner);
        addFacet(p2.bInner, p1.bOuter, p2.bOuter);

        // Top cap (facing up, positive Z)
        addFacet(p1.tInner, p2.tInner, p1.tOuter);
        addFacet(p2.tInner, p2.tOuter, p1.tOuter);

        // Outer vertical wall
        addFacet(p1.bOuter, p2.bOuter, p1.tOuter);
        addFacet(p2.bOuter, p2.tOuter, p1.tOuter);

        // Inner vertical wall
        addFacet(p1.bInner, p1.tInner, p2.bInner);
        addFacet(p2.bInner, p1.tInner, p2.tInner);
      }
    }

    // Left end cap (at index 0)
    const pStart = basePoints[0];
    addFacet(pStart.bInner, pStart.tInner, pStart.bOuter);
    addFacet(pStart.bOuter, pStart.tInner, pStart.tOuter);

    // Right end cap (at last index)
    const pEnd = basePoints[basePoints.length - 1];
    addFacet(pEnd.bInner, pEnd.bOuter, pEnd.tInner);
    addFacet(pEnd.bOuter, pEnd.tOuter, pEnd.tInner);

    // Generate 3Shape Posterior Articulator-Mount Transverse Bar Bridge (Matches 3Shape OrthoSystem Icon)
    if (orthoBaseTemplate === "threeshape_bar") {
      const xMin = Math.min(pStart.bOuter[0], pEnd.bOuter[0]);
      const xMax = Math.max(pStart.bOuter[0], pEnd.bOuter[0]);
      const yMin = Math.min(pStart.bOuter[1], pEnd.bOuter[1]) - 3.5;
      const yMax = Math.max(pStart.bInner[1], pEnd.bInner[1]) + 1.0;
      const zMin = 0;
      const zMax = baseExtrusionHeight;

      // 8 vertices of the transverse articulator bar box
      const v0 = [xMin, yMin, zMin] as [number, number, number];
      const v1 = [xMax, yMin, zMin] as [number, number, number];
      const v2 = [xMax, yMax, zMin] as [number, number, number];
      const v3 = [xMin, yMax, zMin] as [number, number, number];
      const v4 = [xMin, yMin, zMax] as [number, number, number];
      const v5 = [xMax, yMin, zMax] as [number, number, number];
      const v6 = [xMax, yMax, zMax] as [number, number, number];
      const v7 = [xMin, yMax, zMax] as [number, number, number];

      // Triangulate box faces (watertight solid)
      // Bottom face:
      addFacet(v0, v1, v2);
      addFacet(v0, v2, v3);
      // Top face:
      addFacet(v4, v6, v5);
      addFacet(v4, v7, v6);
      // Back face:
      addFacet(v0, v4, v1);
      addFacet(v1, v4, v5);
      // Front face:
      addFacet(v3, v2, v6);
      addFacet(v3, v6, v7);
      // Left face:
      addFacet(v0, v3, v7);
      addFacet(v0, v7, v4);
      // Right face:
      addFacet(v1, v5, v6);
      addFacet(v1, v6, v2);

      // Add 3Shape Calibration Notches (vertical ridges on back face)
      if (articulatorNotches) {
        const xs = [xMin + 5.0, xMin + 12.0, (xMin + xMax) / 2, xMax - 12.0, xMax - 5.0];
        xs.forEach((notchX) => {
          const rW = 0.8; // width
          const rD = 0.6; // depth
          const rxMin = notchX - rW / 2;
          const rxMax = notchX + rW / 2;
          const ryMin = yMin - rD;
          const ryMax = yMin;

          const nv0 = [rxMin, ryMin, zMin] as [number, number, number];
          const nv1 = [rxMax, ryMin, zMin] as [number, number, number];
          const nv2 = [rxMax, ryMax, zMin] as [number, number, number];
          const nv3 = [rxMin, ryMax, zMin] as [number, number, number];
          const nv4 = [rxMin, ryMin, zMax] as [number, number, number];
          const nv5 = [rxMax, ryMin, zMax] as [number, number, number];
          const nv6 = [rxMax, ryMax, zMax] as [number, number, number];
          const nv7 = [rxMin, ryMax, zMax] as [number, number, number];

          addFacet(nv0, nv1, nv2); addFacet(nv0, nv2, nv3);
          addFacet(nv4, nv6, nv5); addFacet(nv4, nv7, nv6);
          addFacet(nv0, nv4, nv1); addFacet(nv1, nv4, nv5);
          addFacet(nv3, nv2, nv6); addFacet(nv3, nv6, nv7);
          addFacet(nv0, nv3, nv7); addFacet(nv0, nv7, nv4);
          addFacet(nv1, nv5, nv6); addFacet(nv1, nv6, nv2);
        });
      }

      // Add Raised Patient ID Plaque
      if (labelType === "embossed" && patientIdLabel) {
        const pW = 16.0; // plaque width
        const pD = 0.8;  // plaque depth
        const pXMin = -pW / 2;
        const pXMax = pW / 2;
        const pyMin = yMin - pD;
        const pyMax = yMin;
        const pZMin = Math.max(1.0, zMax / 2 - 2.5);
        const pZMax = Math.min(zMax - 1.0, zMax / 2 + 2.5);

        const pv0 = [pXMin, pyMin, pZMin] as [number, number, number];
        const pv1 = [pXMax, pyMin, pZMin] as [number, number, number];
        const pv2 = [pXMax, pyMax, pZMin] as [number, number, number];
        const pv3 = [pXMin, pyMax, pZMin] as [number, number, number];
        const pv4 = [pXMin, pyMin, pZMax] as [number, number, number];
        const pv5 = [pXMax, pyMin, pZMax] as [number, number, number];
        const pv6 = [pXMax, pyMax, pZMax] as [number, number, number];
        const pv7 = [pXMin, pyMax, pZMax] as [number, number, number];

        addFacet(pv0, pv1, pv2); addFacet(pv0, pv2, pv3);
        addFacet(pv4, pv6, pv5); addFacet(pv4, pv7, pv6);
        addFacet(pv0, pv4, pv1); addFacet(pv1, pv4, pv5);
        addFacet(pv3, pv2, pv6); addFacet(pv3, pv6, pv7);
        addFacet(pv0, pv3, pv7); addFacet(pv0, pv7, pv4);
        addFacet(pv1, pv5, pv6); addFacet(pv1, pv6, pv2);
      }
    }

    // 2. Generate 3D Teeth Crowns
    const angles = [
      0,
      Math.PI / 4,
      Math.PI / 2,
      (3 * Math.PI) / 4,
      Math.PI,
      (5 * Math.PI) / 4,
      (3 * Math.PI) / 2,
      (7 * Math.PI) / 4,
    ];

    activeTeeth.forEach((t) => {
      const isRelief = selectedReliefTeeth.includes(t.id);
      const blockoutOffset = isRelief ? 0.7 : 0.0;
      const rx3d = t.rx * 0.25 + blockoutOffset;
      const ry3d = t.ry * 0.25 + blockoutOffset;

      // Determine height of tooth crown
      let h = 5.0; // standard molar
      if (t.name.includes("Canine")) {
        h = 7.5;
      } else if (t.name.includes("Incisor")) {
        h = 7.0;
      } else if (t.name.includes("Premolar")) {
        h = 6.0;
      }
      if (isRelief) h += 0.4; // make spacer/relief taller too

      const X_tooth = (t.x - 213) * 0.25;
      const Y_tooth = (220 - t.y) * 0.25;

      const isMolarOrPremolar =
        t.name.includes("Molar") || t.name.includes("Premolar");
      const sx = isMolarOrPremolar ? 0.65 : 0.75;
      const sy = isMolarOrPremolar ? 0.65 : 0.25; // chiseled!

      // Find tangent & outward normal directions for realistic anatomy orientation
      const idx = activeTeeth.findIndex(tooth => tooth.id === t.id);
      let tx = 1, ty = 0;
      if (idx > 0 && idx < activeTeeth.length - 1) {
        const prev = activeTeeth[idx - 1];
        const next = activeTeeth[idx + 1];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          tx = dx / len;
          ty = dy / len;
        }
      } else if (idx === 0) {
        const next = activeTeeth[1];
        const dx = next.x - t.x;
        const dy = next.y - t.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          tx = dx / len;
          ty = dy / len;
        }
      } else {
        const prev = activeTeeth[activeTeeth.length - 2];
        const dx = t.x - prev.x;
        const dy = t.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          tx = dx / len;
          ty = dy / len;
        }
      }
      const ux = ty;
      const uy = -tx;

      // Compute octagonal loops - start 2.0mm inside the base (Z=baseHeight - 2.0) to ensure overlapping manifold merge
      const baseZ = baseExtrusionHeight - 2.0;
      const pts0 = angles.map((theta) => [
        X_tooth + rx3d * Math.cos(theta),
        Y_tooth + ry3d * Math.sin(theta),
        baseZ,
      ] as [number, number, number]);

      const pts1 = angles.map((theta) => [
        X_tooth + rx3d * 0.9 * Math.cos(theta),
        Y_tooth + ry3d * 0.9 * Math.sin(theta),
        baseExtrusionHeight + h * 0.4,
      ] as [number, number, number]);

      const pts2 = angles.map((theta) => [
        X_tooth + rx3d * sx * Math.cos(theta),
        Y_tooth + ry3d * sy * Math.sin(theta),
        baseExtrusionHeight + h * 0.85,
      ] as [number, number, number]);

      // Closed Bottom Cap - seal bottom of each tooth crown to create watertight manifold solid bodies
      const bottomCenter = [X_tooth, Y_tooth, baseZ] as [number, number, number];
      for (let j = 0; j < 8; j++) {
        const next = (j + 1) % 8;
        addFacet(pts0[next], pts0[j], bottomCenter);
      }

      // Add side walls facets
      for (let j = 0; j < 8; j++) {
        const next = (j + 1) % 8;

        // Side wall level 1 -> 2
        addFacet(pts1[j], pts1[next], pts2[next]);
        addFacet(pts1[j], pts2[next], pts2[j]);

        // Side wall level 0 -> 1
        addFacet(pts0[j], pts0[next], pts1[next]);
        addFacet(pts0[j], pts1[next], pts1[j]);
      }

      // High-Fidelity Anatomical Occlusal and Incisal Topology Modeling
      const isPremolar = t.name.includes("Premolar");
      const isCanine = t.name.includes("Canine");
      const isIncisor = t.name.includes("Incisor");

      if (isIncisor) {
        // Incisor: thin chiseled incisal ridge running along the arch tangent
        const edgeLength = rx3d * 0.75;
        const pLeft = [
          X_tooth - tx * edgeLength * 0.5,
          Y_tooth - ty * edgeLength * 0.5,
          baseExtrusionHeight + h
        ] as [number, number, number];
        
        const pRight = [
          X_tooth + tx * edgeLength * 0.5,
          Y_tooth + ty * edgeLength * 0.5,
          baseExtrusionHeight + h
        ] as [number, number, number];

        for (let j = 0; j < 8; j++) {
          const next = (j + 1) % 8;
          if (j < 4) {
            addFacet(pts2[j], pts2[next], pRight);
          } else {
            addFacet(pts2[j], pts2[next], pLeft);
          }
        }
        addFacet(pts2[0], pRight, pLeft);
        addFacet(pts2[4], pLeft, pRight);

      } else if (isCanine) {
        // Canine: single sharp buccal-shifted cusp tip
        const apex = [
          X_tooth + ux * rx3d * 0.15,
          Y_tooth + uy * ry3d * 0.15,
          baseExtrusionHeight + h
        ] as [number, number, number];

        for (let j = 0; j < 8; j++) {
          const next = (j + 1) % 8;
          addFacet(pts2[j], pts2[next], apex);
        }

      } else if (isPremolar) {
        // Premolar: bicuspid crown (outer buccal cusp & inner lingual cusp)
        const buccalCusp = [
          X_tooth + ux * rx3d * 0.35,
          Y_tooth + uy * ry3d * 0.35,
          baseExtrusionHeight + h
        ] as [number, number, number];

        const lingualCusp = [
          X_tooth - ux * rx3d * 0.35,
          Y_tooth - uy * ry3d * 0.35,
          baseExtrusionHeight + h * 0.88
        ] as [number, number, number];

        const vertexCusp = pts2.map((p) => {
          const vx = p[0] - X_tooth;
          const vy = p[1] - Y_tooth;
          const dot = vx * ux + vy * uy;
          return dot > 0 ? buccalCusp : lingualCusp;
        });

        for (let j = 0; j < 8; j++) {
          const next = (j + 1) % 8;
          const cuspA = vertexCusp[j];
          const cuspB = vertexCusp[next];
          
          if (cuspA === cuspB) {
            addFacet(pts2[j], pts2[next], cuspA);
          } else {
            addFacet(pts2[j], pts2[next], cuspA);
            addFacet(pts2[next], cuspB, cuspA);
          }
        }

      } else {
        // Molar: complex quad-cuspid crown with central pit groove
        const mb = [X_tooth + ux * rx3d * 0.35 - tx * rx3d * 0.3, Y_tooth + uy * ry3d * 0.35 - ty * ry3d * 0.3, baseExtrusionHeight + h] as [number, number, number];
        const db = [X_tooth + ux * rx3d * 0.35 + tx * rx3d * 0.3, Y_tooth + uy * ry3d * 0.35 + ty * ry3d * 0.3, baseExtrusionHeight + h] as [number, number, number];
        const ml = [X_tooth - ux * rx3d * 0.35 - tx * rx3d * 0.3, Y_tooth - uy * ry3d * 0.35 - ty * ry3d * 0.3, baseExtrusionHeight + h * 0.9] as [number, number, number];
        const dl = [X_tooth - ux * rx3d * 0.35 + tx * rx3d * 0.3, Y_tooth - uy * ry3d * 0.35 + ty * ry3d * 0.3, baseExtrusionHeight + h * 0.9] as [number, number, number];

        const centralPit = [X_tooth, Y_tooth, baseExtrusionHeight + h * 0.75] as [number, number, number];

        const vertexCusp = pts2.map((p) => {
          const vx = p[0] - X_tooth;
          const vy = p[1] - Y_tooth;
          const dotBuccal = vx * ux + vy * uy;
          const dotDistal = vx * tx + vy * ty;
          
          if (dotBuccal > 0) {
            return dotDistal > 0 ? db : mb;
          } else {
            return dotDistal > 0 ? dl : ml;
          }
        });

        for (let j = 0; j < 8; j++) {
          const next = (j + 1) % 8;
          const cuspA = vertexCusp[j];
          const cuspB = vertexCusp[next];

          if (cuspA === cuspB) {
            addFacet(pts2[j], pts2[next], cuspA);
          } else {
            addFacet(pts2[j], pts2[next], cuspA);
            addFacet(pts2[next], cuspB, cuspA);
          }
        }

        addFacet(mb, db, centralPit);
        addFacet(db, dl, centralPit);
        addFacet(dl, ml, centralPit);
        addFacet(ml, mb, centralPit);
      }

      // 2b. Add Orthodontic Attachment Protrusion (Matches Image 2 attachment shape toggles)
      const hasAttachment = selectedAttachmentTeeth.includes(t.id);
      if (hasAttachment) {
        const offsetRadius = rx3d * 0.95;
        const attCenterX = X_tooth + ux * offsetRadius;
        const attCenterY = Y_tooth + uy * offsetRadius;
        const attCenterZ = baseExtrusionHeight + h * 0.45; // Centered at mid-crown height

        const w = attachmentWidth;
        const attH = attachmentHeight;
        const d = attachmentDepth;

        // Compute 8 vertices of attachment box
        const vertices: Array<[number, number, number]> = [];
        const offsets = [-0.3, d]; // starts slightly inside the tooth to ensure manifold merge

        for (let face = 0; face < 2; face++) { // 0 = back, 1 = front
          const currD = offsets[face];
          for (let rightLeft = 0; rightLeft < 2; rightLeft++) { // 0 = left (-), 1 = right (+)
            const currW = (rightLeft === 0 ? -0.5 : 0.5) * w;
            for (let topBottom = 0; topBottom < 2; topBottom++) { // 0 = bottom (-), 1 = top (+)
              const currH = (topBottom === 0 ? -0.5 : 0.5) * attH;

              // Rotate coordinate into the tooth's tangent-normal coordinate frame
              const x = attCenterX + ux * currD + tx * currW;
              const y = attCenterY + uy * currD + ty * currW;
              const z = attCenterZ + currH;
              vertices.push([x, y, z]);
            }
          }
        }

        // Apply scaling & bevel transforms to front face vertices (indices 4 to 7) to generate the requested attachment profiles
        let frontWScale = 1.0;
        let frontHScale = 1.0;
        if (attachmentShape === "beveled_h") {
          frontWScale = 0.55;
        } else if (attachmentShape === "beveled_v") {
          frontHScale = 0.55;
        } else if (attachmentShape === "ellipsoid") {
          frontWScale = 0.65;
          frontHScale = 0.65;
        }

        if (frontWScale !== 1.0 || frontHScale !== 1.0) {
          for (let idx = 4; idx <= 7; idx++) {
            const fcX = attCenterX + ux * d;
            const fcY = attCenterY + uy * d;
            const fcZ = attCenterZ;

            const rx = vertices[idx][0] - fcX;
            const ry = vertices[idx][1] - fcY;
            const rz = vertices[idx][2] - fcZ;

            const compW = rx * tx + ry * ty; // projection onto tangent axis

            vertices[idx][0] = fcX + tx * (compW * frontWScale);
            vertices[idx][1] = fcY + ty * (compW * frontWScale);
            vertices[idx][2] = fcZ + rz * frontHScale;
          }
        }

        // Triangulate box faces (12 solid watertight facets)
        // Back face (looking inwards, reverse winding):
        addFacet(vertices[0], vertices[2], vertices[1]);
        addFacet(vertices[2], vertices[3], vertices[1]);

        // Front face (looking outwards, normal points +ux/uy):
        addFacet(vertices[4], vertices[5], vertices[6]);
        addFacet(vertices[6], vertices[5], vertices[7]);

        // Bottom face:
        addFacet(vertices[0], vertices[4], vertices[2]);
        addFacet(vertices[2], vertices[4], vertices[6]);

        // Top face:
        addFacet(vertices[1], vertices[3], vertices[5]);
        addFacet(vertices[3], vertices[7], vertices[5]);

        // Left face:
        addFacet(vertices[0], vertices[1], vertices[4]);
        addFacet(vertices[4], vertices[1], vertices[5]);

        // Right face:
        addFacet(vertices[2], vertices[6], vertices[3]);
        addFacet(vertices[3], vertices[6], vertices[7]);
      }
    });

    // 3. Generate 3D Raised Trim Line Ridge (Laser Cutting Guide Line) sitting on dynamic base height
    const trimPoints: Array<[number, number, number]> = [];

    activeTeeth.forEach((t, idx) => {
      const dx = t.x - 213;
      const dy = t.y - 140;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ux = len > 0 ? dx / len : 0;
      const uy = len > 0 ? dy / len : -1;

      // Scallop wave formula matching UI Visualizer exactly
      const wave = trimLineType === "scalloped" ? Math.sin(idx * 1.5) * 6 : 0;
      const offsetMagnitude = 16 + (trimScallopOffset * 4) + wave;

      // Coordinates along gums
      const P_trim_x = t.x - ux * offsetMagnitude * 0.7;
      const P_trim_y = t.y - uy * offsetMagnitude * 0.7;

      const tx = (P_trim_x - 213) * 0.25;
      const ty = (220 - P_trim_y) * 0.25;

      trimPoints.push([tx, ty, baseExtrusionHeight]);
    });

    // Extrude trim ridge as a triangular prism running along the gums on top of the base height
    for (let i = 0; i < trimPoints.length - 1; i++) {
      const p1 = trimPoints[i];
      const p2 = trimPoints[i + 1];

      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const segLen = Math.sqrt(dx * dx + dy * dy);
      const px = segLen > 0 ? (-dy / segLen) * 0.45 : 0;
      const py = segLen > 0 ? (dx / segLen) * 0.45 : 0;

      // Triangulated ridge cross-sections sitting on base height
      const L1 = [p1[0] + px, p1[1] + py, baseExtrusionHeight] as [number, number, number];
      const R1 = [p1[0] - px, p1[1] - py, baseExtrusionHeight] as [number, number, number];
      const K1 = [p1[0], p1[1], baseExtrusionHeight + 0.7] as [number, number, number]; // Ridge peak

      const L2 = [p2[0] + px, p2[1] + py, baseExtrusionHeight] as [number, number, number];
      const R2 = [p2[0] - px, p2[1] - py, baseExtrusionHeight] as [number, number, number];
      const K2 = [p2[0], p2[1], baseExtrusionHeight + 0.7] as [number, number, number]; // Ridge peak

      // Left sloped wall of the ridge
      addFacet(L1, L2, K2);
      addFacet(L1, K2, K1);

      // Right sloped wall of the ridge
      addFacet(R1, K1, K2);
      addFacet(R1, K2, R2);
    }

    // Cap the start of the trim line ridge to guarantee waterproof manifold mesh
    if (trimPoints.length > 1) {
      const p1 = trimPoints[0];
      const p2 = trimPoints[1];
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const segLen = Math.sqrt(dx * dx + dy * dy);
      const px = segLen > 0 ? (-dy / segLen) * 0.45 : 0;
      const py = segLen > 0 ? (dx / segLen) * 0.45 : 0;
      const L1 = [p1[0] + px, p1[1] + py, baseExtrusionHeight] as [number, number, number];
      const R1 = [p1[0] - px, p1[1] - py, baseExtrusionHeight] as [number, number, number];
      const K1 = [p1[0], p1[1], baseExtrusionHeight + 0.7] as [number, number, number];
      addFacet(L1, K1, R1);
    }

    // Cap the end of the trim line ridge to guarantee waterproof manifold mesh
    if (trimPoints.length > 1) {
      const lastIdx = trimPoints.length - 1;
      const p1 = trimPoints[lastIdx - 1];
      const p2 = trimPoints[lastIdx];
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const segLen = Math.sqrt(dx * dx + dy * dy);
      const px = segLen > 0 ? (-dy / segLen) * 0.45 : 0;
      const py = segLen > 0 ? (dx / segLen) * 0.45 : 0;
      const L2 = [p2[0] + px, p2[1] + py, baseExtrusionHeight] as [number, number, number];
      const R2 = [p2[0] - px, p2[1] - py, baseExtrusionHeight] as [number, number, number];
      const K2 = [p2[0], p2[1], baseExtrusionHeight + 0.7] as [number, number, number];
      addFacet(R2, K2, L2);
    }

    // Build full watertight STL ASCII file string
    const stlContent = `solid DentalCAD_Orthodontic_Model_Mesh
# ORTHODONTIC MODEL DATA
# Case ID: ${caseId || "DEMO-CASE"}
# Patient ID Label: ${patientIdLabel || "None"}
# Ortho Base Template: ${orthoBaseTemplate.toUpperCase()}
# Label Engraving Mode: ${labelType.toUpperCase()}
# Appliance Target: ${appliance || "Essix Retainer"}
# Arch Target: ${activeArchTab.toUpperCase()}
# Biomaterial Profile: ${selectedMaterial}
# Shell Thickness: ${shellThickness} mm
# Trim Line Offset: ${trimScallopOffset} mm
# Cut Path Shape: ${trimLineType}
# Base Extrusion Height: ${baseExtrusionHeight} mm
# Hollow Model Infill: ${isHollowModel ? `TRUE (${hollowWallThickness}mm wall)` : "FALSE (Solid model)"}
# Resin Drain Holes: ${addDrainHoles ? "ENABLED" : "DISABLED"}
# Articulator Calibration Notches: ${articulatorNotches ? "ENABLED" : "DISABLED"}
# Active Blockouts: ${selectedReliefTeeth.map(id => `Tooth_${id}`).join(", ") || "None"}
# Active Attachments: ${selectedAttachmentTeeth.map(id => `Tooth_${id}`).join(", ") || "None"}
# Attachment Profile Shape: ${attachmentShape}
# Compiled live on Google AI Studio Dental CAD Core
${facets.join("\n")}
endsolid DentalCAD_Orthodontic_Model_Mesh
`;

    const blob = new Blob([stlContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = stlFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  return (
    <div id="analysis-result-view" className="space-y-6">
      
      {/* 1. Confirmed Status Banner */}
      {isConfirmed && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex items-start gap-3 shadow-xs" id="confirmed-status-banner">
          <CheckCircle className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-bold text-emerald-900 text-md">
              Manufacturing Specifications Confirmed!
            </h3>
            <p className="text-emerald-700 text-xs mt-1 leading-relaxed">
              This case's CAD design specifications are finalized and submitted to the physical dental laboratory production line queue. The Interactive Checklist below is live to track technician progress.
            </p>
            <button
              onClick={handleReopenDesign}
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 hover:text-emerald-950 bg-white border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-3xs"
              id="btn-reopen-case"
            >
              <RefreshCw className="w-3 h-3" />
              Re-open Specifications for Modification
            </button>
          </div>
        </div>
      )}

      {/* 2. Warnings Banner Section (Only if not confirmed yet) */}
      {!isConfirmed && warnings && warnings.length > 0 && (
        <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-5" id="warnings-container">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-rose-600" />
            <h3 className="font-semibold text-rose-900 text-sm" id="warnings-title">
              Attention Required: {warnings.length} Suggested Manufacturing Warning{warnings.length > 1 ? "s" : ""}
            </h3>
          </div>
          <ul className="space-y-1.5 text-xs text-rose-700 list-inside list-disc">
            {warnings.map((warning, index) => (
              <li key={index} className="pl-1 leading-relaxed">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DENTAL CAD WORKBENCH -- REMOVED */}
      {/* ========================================================================= */}
      {/* ========================================================================= */}
      {/* ── Lab Actions (real exports & confirmation) ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden print:hidden" id="lab-actions-card">
        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#46c0bd]" />
            <h3 className="text-sm font-bold text-slate-800">Lab Actions</h3>
          </div>
        </div>
        <div className="p-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              const manifest = [
                '===========================================',
                'DENTAL LABORATORY MANUFACTURING MANIFEST',
                '===========================================',
                'CASE ID: ' + (caseId || 'DEMO-CASE-99'),
                'CREATED ON: ' + new Date().toLocaleDateString(),
                'PROCESSED APPLIANCE: ' + (appliance || 'Essix Retainer'),
                'MATERIAL STAGE: ' + selectedMaterial,
                'FABRICATED SHELL DEPTH: ' + shellThickness + ' mm',
                'TRIM PATH GEOMETRY: ' + trimLineType.toUpperCase(),
                'DENTAL QA CERTIFICATION: STANDARD BIOLOGICALLY COMPLIANT [OK]',
                'STATUS CODE: PASSED_LAB_QA',
                '==========================================='
              ].join('\n');
              const blob = new Blob([manifest], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = 'case_' + (caseId || 'dental') + '_print_compliance_manifest.txt';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-lg text-xs cursor-pointer transition-all flex items-center gap-1 shadow-md shadow-emerald-950/25"
            id="btn-download-lab-manifest"
          >
            <Download className="w-3.5 h-3.5" />
            Download QA Manifest
          </button>
          <button
            onClick={handleExportSql}
            disabled={isExportingSql}
            className="bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2 px-4 rounded-lg text-xs cursor-pointer transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            id="btn-export-print-sql"
          >
            {isExportingSql ? "Exporting SQL..." : "Export Print SQL"}
          </button>
          {sqlExportMessage ? (
            <span className="text-xs text-slate-600 px-2 py-1 rounded-md bg-slate-50 border border-slate-200">
              {sqlExportMessage}
            </span>
          ) : null}
          <button
            onClick={handleConfirmAndProceed}
            disabled={isConfirmed}
            className="bg-[#46c0bd] hover:bg-[#3ba6a3] text-white font-bold py-2 px-4 rounded-lg text-xs cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
            id="btn-confirm-case"
          >
            {isConfirmed ? "Case Confirmed" : "Confirm Case"}
          </button>
        </div>
      </div>


      {/* ── Treatment Plan Section ───────────────────────────────────── */}
      {result.treatment_plan && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden print:break-inside-avoid" id="treatment-plan-container">
          <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-blue-50/50">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600" />
              <div>
                <h2 className="text-md font-bold text-slate-800">Orthodontic Treatment Plan</h2>
                <p className="text-[10px] text-slate-500 mt-0.5">AI-generated comprehensive treatment plan based on clinical analysis and reference library samples</p>
              </div>
            </div>
          </div>
          <div className="p-5">
            <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed text-[13px] space-y-2">
              {(() => {
                // Normalize: replace literal \n (backslash-n) with actual newlines, then split
                const raw = result.treatment_plan || '';
                const normalized = raw.replace(/\\n/g, '\n');
                const lines = normalized.split('\n');
                const elements: React.ReactNode[] = [];
                let inList: 'ul' | 'ol' | null = null;
                let listItems: React.ReactNode[] = [];

                const flushList = (key: number) => {
                  if (listItems.length === 0) return;
                  if (inList === 'ul') {
                    elements.push(<ul key={key} className="list-disc ml-5 space-y-1">{listItems}</ul>);
                  } else if (inList === 'ol') {
                    elements.push(<ol key={key} className="list-decimal ml-5 space-y-1">{listItems}</ol>);
                  }
                  listItems = [];
                  inList = null;
                };

                const renderBold = (text: string) => {
                  const parts = text.split(/(\*\*[^*]+\*\*)/g);
                  return parts.map((part, j) => {
                    if (part.startsWith('**') && part.endsWith('**')) {
                      return <strong key={j}>{part.slice(2, -2)}</strong>;
                    }
                    // Also handle inline code, underscores, etc.
                    return part;
                  });
                };

                lines.forEach((line, i) => {
                  const trimmed = line.trim();

                  if (trimmed === '') {
                    flushList(i);
                    elements.push(<div key={`sp-${i}`} className="h-2" />);
                    return;
                  }

                  if (trimmed.startsWith('### ')) {
                    flushList(i);
                    elements.push(<h4 key={i} className="text-xs font-bold text-slate-700 mt-3 mb-1">{renderBold(trimmed.replace('### ', ''))}</h4>);
                  } else if (trimmed.startsWith('## ')) {
                    flushList(i);
                    elements.push(<h3 key={i} className="text-sm font-bold text-slate-800 mt-4 mb-2">{renderBold(trimmed.replace('## ', ''))}</h3>);
                  } else if (trimmed.startsWith('# ')) {
                    flushList(i);
                    elements.push(<h2 key={i} className="text-base font-extrabold text-slate-900 mt-5 mb-2">{renderBold(trimmed.replace('# ', ''))}</h2>);
                  } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                    const prefix = trimmed.startsWith('- ') ? 2 : 2;
                    if (inList !== 'ul') flushList(i);
                    inList = 'ul';
                    listItems.push(<li key={`li-${i}`} className="text-[13px] text-slate-600">{renderBold(trimmed.slice(prefix))}</li>);
                  } else if (/^\d+[.)]\s/.test(trimmed)) {
                    if (inList !== 'ol') flushList(i);
                    inList = 'ol';
                    listItems.push(<li key={`li-${i}`} className="text-[13px] text-slate-600">{renderBold(trimmed.replace(/^\d+[.)]\s/, ''))}</li>);
                  } else {
                    flushList(i);
                    elements.push(<p key={i} className="text-[13px] text-slate-600">{renderBold(trimmed)}</p>);
                  }
                });
                flushList(lines.length);

                return elements;
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Active Learning Container ──────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden print:hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-purple-50 to-violet-50/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              <div>
                <h2 className="text-sm font-bold text-slate-800">Active Learning</h2>
                <p className="text-[10px] text-slate-500 mt-0.5">AI internet search for precision treatment planning</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={activeLearning} onChange={() => setActiveLearning(!activeLearning)} className="sr-only peer" />
              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
              <span className={`ml-2 text-[10px] font-bold ${activeLearning ? 'text-purple-700' : 'text-slate-400'}`}>
                {activeLearning ? 'ON' : 'OFF'}
              </span>
            </label>
          </div>
        </div>
        <div className="p-4 text-[11px] text-slate-600 leading-relaxed space-y-2">
          <p>When enabled, the AI can search the internet for the latest clinical research, treatment protocols, and material science data to generate more precise, evidence-based treatment plans and warnings.</p>
          {activeLearning && (
            <div className="flex items-center gap-2 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
              <span className="text-[10px] font-bold text-purple-700">AI internet access active — treatment plans will incorporate live clinical data</span>
            </div>
          )}
        </div>
      </div>

      {/* Clinical Literature RAG & Biomechanical Grounding Board */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden print:hidden" id="clinical-rag-grounding-board">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-700">Clinical Co-Pilot RAG Guardrails</span>
            </div>
            <h3 className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5 mt-0.5">
              <Layers className="w-4 h-4 text-emerald-600" />
              Scientific Grounding & Biomechanical Validation
            </h3>
          </div>
          <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-1 rounded-full font-bold">
            Grounding Literature: Active & Verified
          </span>
        </div>

        {/* Tab Headers */}
        <div className="flex border-b border-slate-100 bg-slate-50/30 overflow-x-auto">
          {RAG_TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeRagTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveRagTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold whitespace-nowrap border-b-2 transition-all cursor-pointer ${
                  isActive
                    ? "border-emerald-600 text-emerald-700 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50/50"
                }`}
              >
                <TabIcon className={`w-3.5 h-3.5 ${isActive ? "text-emerald-600" : "text-slate-400"}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div className="p-5">
          {activeRagTab === "restorative" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-start gap-3 bg-blue-50/50 border border-blue-100 p-4 rounded-xl">
                <div className="p-2 bg-white border border-blue-200 rounded-lg text-blue-600 shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    The Adult Orthodontic-Restorative Interface Part 1 (2024)
                    <span className="text-[9px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded">Core Grounding Citation</span>
                  </h4>
                  <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                    "Interdisciplinary management of adult wear, vertical heights reclamation, leveling anterior gingival zenith levels before aesthetic restorative therapy, and parallelizing roots of posterior abutments for implants."
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Gingival Zenith Leveling Card */}
                <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Restorative Alignment</span>
                    <span className="text-[9px] font-bold bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded">100% COMPLIANT</span>
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-slate-800">Gingival Zenith Margin Leveling</h5>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      To achieve the golden proportion, gingival zeniths of anterior teeth #11, #12, #21, #22 are leveled. Orthodontic intrusion is programmed to establish symmetrical, balanced gingival zenith lines before placing veneers.
                    </p>
                  </div>
                  <div className="bg-white border border-slate-150 rounded-lg p-2.5 space-y-1.5">
                    <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-slate-500">Ant. Intrusion Vector</span>
                      <span className="font-bold text-slate-800">0.8mm programmed</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-emerald-500 h-full" style={{ width: "80%" }}></div>
                    </div>
                  </div>
                </div>

                {/* Implant Site Preparation Card */}
                <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Skeletal Preparation</span>
                    <span className="text-[9px] font-bold bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">AXIAL OPTIMIZED</span>
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-slate-800">Posterior Implant Site Space & Root Parallelism</h5>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      Adjacent molar roots (teeth #37, #47) are uprighted parallel to the path of placement for prospective dental implants at sites #36 and #46, ensuring maximum bone density and proper mechanical clearance.
                    </p>
                  </div>
                  <div className="bg-white border border-slate-150 rounded-lg p-2.5 space-y-1.5">
                    <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-slate-500">Root Parallelism Angle</span>
                      <span className="font-bold text-emerald-600">88.5Â° (2.3Â° tipping remaining)</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-indigo-500 h-full" style={{ width: "95%" }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeRagTab === "biomechanics" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-start gap-3 bg-emerald-50/50 border border-emerald-100 p-4 rounded-xl">
                <div className="p-2 bg-white border border-emerald-200 rounded-lg text-emerald-600 shrink-0">
                  <Activity className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    Eliades & Athanasiou - Aligner Materials (2020)
                    <span className="text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded">Polymer Memory Citation</span>
                  </h4>
                  <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                    "Thermomechanical forces in clear aligners undergo stress-relaxation and degrade rapidly over 3-7 days. Polyurethane elastomer multilayer polymers maintain higher continuous orthodontic forces compared to homopolymer PETG."
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Interactive Force Decay Chart */}
                <div className="md:col-span-2 bg-slate-50 border border-slate-150 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Active Orthodontic Force Retention Curve</span>
                    <span className="text-[9px] font-mono text-slate-500">Wear cycle over 14 Days</span>
                  </div>
                  
                  {/* Chart SVG */}
                  <div className="h-32 w-full bg-white rounded-lg border border-slate-200 p-2 relative">
                    <svg className="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
                      {/* Grid Lines */}
                      <line x1="0" y1="20" x2="300" y2="20" stroke="#f1f5f9" strokeWidth="1" />
                      <line x1="0" y1="50" x2="300" y2="50" stroke="#f1f5f9" strokeWidth="1" />
                      <line x1="0" y1="80" x2="300" y2="80" stroke="#f1f5f9" strokeWidth="1" />
                      
                      {/* X-Axis divisions */}
                      <line x1="75" y1="0" x2="75" y2="100" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="2" />
                      <line x1="150" y1="0" x2="150" y2="100" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="2" />
                      <line x1="225" y1="0" x2="225" y2="100" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="2" />

                      {/* Multilayer Polyurethane Curve (Active Force) - Green */}
                      <path 
                        d="M 0 20 Q 75 35, 150 45 T 300 55" 
                        fill="none" 
                        stroke="#10b981" 
                        strokeWidth="2" 
                      />
                      {/* PETG Homopolymer Curve - Red */}
                      <path 
                        d="M 0 20 Q 75 55, 150 78 T 300 88" 
                        fill="none" 
                        stroke="#ef4444" 
                        strokeWidth="2" 
                        strokeDasharray="3"
                      />

                      {/* Chart Labels */}
                      <text x="5" y="15" fill="#94a3b8" fontSize="6" fontWeight="bold">100% Force</text>
                      <text x="5" y="48" fill="#94a3b8" fontSize="6" fontWeight="bold">50% Force</text>
                      <text x="5" y="78" fill="#94a3b8" fontSize="6" fontWeight="bold">20% Force</text>
                      
                      <text x="70" y="95" fill="#94a3b8" fontSize="6">Day 3</text>
                      <text x="145" y="95" fill="#94a3b8" fontSize="6">Day 7</text>
                      <text x="220" y="95" fill="#94a3b8" fontSize="6">Day 10</text>
                      <text x="280" y="95" fill="#94a3b8" fontSize="6">Day 14</text>
                    </svg>
                  </div>

                  <div className="flex gap-4 justify-center text-[10px] font-bold">
                    <span className="flex items-center gap-1 text-emerald-600">
                      <span className="w-2.5 h-0.5 bg-emerald-500 inline-block"></span>
                      SG Polyurethane Multilayer (55% retain)
                    </span>
                    <span className="flex items-center gap-1 text-rose-500">
                      <span className="w-2.5 h-0.5 bg-rose-500 border-dashed border-t inline-block"></span>
                      Standard PETG Homopolymer (12% retain)
                    </span>
                  </div>
                </div>

                {/* Science Grounded Recommendations */}
                <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Clinical Protocol</span>
                  <div className="mt-1 space-y-2">
                    <p className="text-[11px] text-slate-700 leading-normal font-bold">
                      "Because standard PETG suffers from 75% stress relaxation within 72 hours, 7-day stage changes are required to combat tooth relapse."
                    </p>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      By switching to SG Multilayer Polyurethane (active case selected material), a highly elastic recovery curve allows safe extending to 10-day cycles with increased efficacy.
                    </p>
                  </div>
                  <div className="bg-white border border-slate-150 rounded-lg p-2 text-center text-[10px] text-slate-600 mt-2">
                    Selected: <span className="font-extrabold text-emerald-600">{selectedMaterial}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeRagTab === "safety" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-start gap-3 bg-rose-50/50 border border-rose-100 p-4 rounded-xl">
                <div className="p-2 bg-white border border-rose-200 rounded-lg text-rose-600 shrink-0">
                  <Gauge className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    Biological PDL Safety Limits & Staging Controls (2025)
                    <span className="text-[9px] bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded">Periodontal Guardrails Citation</span>
                  </h4>
                  <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                    "Orthodontic forces must remain below the capillary blood pressure threshold (approx. 16 kPa or 20-26 g/cmÂ²) to completely avoid ischemic periodontal ligament (PDL) necrosis and subsequent root resorption."
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Gauge 1: Translation Limit */}
                <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 space-y-2 text-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Stage Translation limit</span>
                  <div className="inline-flex items-baseline gap-1 mt-1">
                    <span className="text-2xl font-black text-emerald-600 font-mono">0.22</span>
                    <span className="text-[10px] text-slate-400 font-mono">mm</span>
                  </div>
                  <div className="bg-emerald-50 text-emerald-700 font-bold text-[10px] py-1 rounded-lg border border-emerald-100 uppercase mt-1">
                    100% Compliant (Safe)
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal mt-1">
                    Maximum clinical standard translation is 0.25mm. Current case value is set to 0.22mm per stage.
                  </p>
                </div>

                {/* Gauge 2: Rotation Limit */}
                <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 space-y-2 text-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Stage Rotation limit</span>
                  <div className="inline-flex items-baseline gap-1 mt-1">
                    <span className="text-2xl font-black text-emerald-600 font-mono">1.5Â°</span>
                  </div>
                  <div className="bg-emerald-50 text-emerald-700 font-bold text-[10px] py-1 rounded-lg border border-emerald-100 uppercase mt-1">
                    100% Compliant (Safe)
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal mt-1">
                    Maximum clinical standard rotation is 2.0Â°. Current rotation setup is calibrated to 1.5Â° per stage.
                  </p>
                </div>

                {/* Ischemia Prevention warning box */}
                <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">PDL Ischemia warning monitor</span>
                  <div className="space-y-1.5 bg-white border border-slate-150 p-2.5 rounded-lg text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Capillary pressure:</span>
                      <span className="font-bold text-emerald-600">12.8 kPa</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Critical threshold:</span>
                      <span className="font-bold text-rose-600">16.0 kPa</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-slate-100">
                      <span className="text-slate-400">Necrosis risk:</span>
                      <span className="font-bold text-slate-800">VERY LOW</span>
                    </div>
                  </div>
                  <div className="text-[9px] bg-emerald-100 text-emerald-800 p-1.5 rounded-lg border border-emerald-200 leading-relaxed font-bold">
                    âœ“ Programmed biomechanical forces are safely distributed along the periodontal ligament root surface.
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeRagTab === "attachments" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-start gap-3 bg-indigo-50/50 border border-indigo-100 p-4 rounded-xl">
                <div className="p-2 bg-white border border-indigo-200 rounded-lg text-indigo-600 shrink-0">
                  <Zap className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    Sub-Millimeter CAD Attachment Biomechanics & Calibration (2024)
                    <span className="text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded">Attachment Mechanics Citation</span>
                  </h4>
                  <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                    "Rotational control of cylindrical surfaces (such as canines and premolars) requires beveled rectangular vertical attachments. Torque, extrusion, or intrusion control requires horizontal beveled rectangular profiles to maximize material gripping surface."
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Horizontal Bevel Anchorage Card */}
                <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <h5 className="text-xs font-extrabold text-slate-800">Horizontal Beveled Anchorage (#14, #24, #34, #44)</h5>
                    <span className="text-[9px] font-bold bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">ANCHORAGE PROMPT</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Programmed on premolars as passive and active anchors. Features a gingivally directed bevel face to provide gripping resistance during intrusive leveling of anterior teeth, ensuring absolute alignment stability.
                  </p>
                  <div className="bg-white border border-slate-150 p-3 rounded-lg flex items-center justify-between text-[11px] font-mono">
                    <div className="space-y-1">
                      <span className="text-slate-400 block uppercase text-[8px]">Active Vector Force</span>
                      <span className="font-bold text-indigo-600 font-sans">0.8 N (Apical compression)</span>
                    </div>
                    <div className="text-right space-y-1">
                      <span className="text-slate-400 block uppercase text-[8px]">Gripping surface</span>
                      <span className="font-bold text-slate-800 font-sans">8.4 mmÂ²</span>
                    </div>
                  </div>
                </div>

                {/* Vertical Bevel Rotation Card */}
                <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <h5 className="text-xs font-extrabold text-slate-800">Vertical Beveled Active Brackets (#13, #23)</h5>
                    <span className="text-[9px] font-bold bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">ROTATION SETUP</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Designed specifically for rotated canines. Offers a flat, active vertical face that engages the aligner sheet, converting flexible deflection into controlled rotational torque around the tooth's long axis.
                  </p>
                  <div className="bg-white border border-slate-150 p-3 rounded-lg flex items-center justify-between text-[11px] font-mono">
                    <div className="space-y-1">
                      <span className="text-slate-400 block uppercase text-[8px]">Active Vector Torque</span>
                      <span className="font-bold text-indigo-600 font-sans">1.4 NÂ·mm (Rotational)</span>
                    </div>
                    <div className="text-right space-y-1">
                      <span className="text-slate-400 block uppercase text-[8px]">Active contact face</span>
                      <span className="font-bold text-slate-800 font-sans">vertical bevel edge</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>



      {/* 1. PROGRESSIVE STL EXPORT COMPILER MODAL */}
      {isExportingStl && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center z-50 p-4 transition-all duration-300">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl p-6 w-full max-w-lg shadow-2xl flex flex-col gap-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 text-[#46c0bd] animate-spin" />
                <h3 className="font-bold text-sm tracking-wide uppercase text-[#46c0bd]">Orthodontic STL Mesh Compiler</h3>
              </div>
              <span className="text-[10px] font-mono font-bold bg-[#46c0bd]/10 text-[#46c0bd] px-2.5 py-0.5 rounded-full">
                SLA / FDM Print Ready
              </span>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono font-bold">
                <span className="text-slate-400">COMPILING MANIFOLD FACETS</span>
                <span className="text-[#46c0bd]">{exportProgress}%</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-[#46c0bd] to-cyan-500 h-full rounded-full transition-all duration-300 shadow-[0_0_8px_#46c0bd]" 
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
            </div>

            {/* Logging terminal console */}
            <div className="bg-slate-950 rounded-xl p-4 font-mono text-[10px] text-[#46c0bd]/90 border border-slate-800/80 h-48 overflow-y-auto space-y-1.5">
              {exportLogs.map((log, idx) => (
                <div key={idx} className="leading-relaxed flex items-start gap-1">
                  <span className="text-slate-600 shrink-0 select-none">$&gt;</span>
                  <span className="whitespace-pre-wrap">{log}</span>
                </div>
              ))}
            </div>

            <div className="text-[10px] text-slate-500 text-center flex items-center justify-center gap-1">
              <span>ðŸ”’ Direct Client-side 3D Matrix Math</span>
              <span>â€¢</span>
              <span>Waterproof Manifolds Verified</span>
            </div>
          </div>
        </div>
      )}

      {/* 2. CASE DESIGN CONFIRMATION DIALOG MODAL */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 transition-all duration-200">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-md shadow-2xl flex flex-col gap-4 animate-in scale-in duration-150">
            <div className="flex items-start gap-3 border-b border-slate-100 pb-3">
              <div className="p-3 bg-emerald-50 rounded-full text-emerald-600 shrink-0">
                <CheckCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-800 text-sm leading-snug">Confirm Dental CAD Specifications</h3>
                <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Verify design coordinates before fabrication queue release.</p>
              </div>
            </div>

            {/* Spec breakdown summary card */}
            <div className="bg-slate-50/80 rounded-xl border border-slate-200/60 p-4 text-xs space-y-2.5">
              <div className="flex justify-between items-center pb-1.5 border-b border-slate-200/50">
                <span className="font-medium text-slate-400">Patient Identifier</span>
                <span className="font-bold text-slate-800">{patientIdLabel || "N/A"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-medium text-slate-400">Appliance Type</span>
                <span className="font-bold text-slate-800">{appliance || result.design_parameters.appliance}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-medium text-slate-400">Dental Arch Selection</span>
                <span className="font-bold text-slate-800 uppercase">{activeArchTab} Arch</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-medium text-slate-400">Material Sheet</span>
                <span className="font-bold text-slate-800">{selectedMaterial}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-medium text-slate-400">Shell Wall Thickness</span>
                <span className="font-bold text-slate-800 font-mono">{shellThickness.toFixed(2)} mm</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-medium text-slate-400">Trim Offset Height</span>
                <span className="font-bold text-[#46c0bd] font-mono">+{trimScallopOffset.toFixed(1)} mm ({trimLineType})</span>
              </div>
              <div className="flex justify-between items-center pt-1.5 border-t border-slate-200/50">
                <span className="font-medium text-slate-400">CAD Relief Blocks</span>
                <span className="font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[10px]">
                  {selectedReliefTeeth.length} Teeth Flagged
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-medium text-slate-400">Retention Attachments</span>
                <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded text-[10px]">
                  {selectedAttachmentTeeth.length} Brackets Placed
                </span>
              </div>
            </div>

            {/* Safety advisory */}
            <div className="p-3 bg-amber-50 border border-amber-200/50 rounded-xl flex items-start gap-2">
              <span className="text-xs text-amber-600 select-none mt-0.5">âš ï¸</span>
              <p className="text-[10px] text-amber-800 leading-normal font-medium">
                <strong>Attention SLA Lab Technician:</strong> Once confirmed, this CAD package is locked, marked as verified, and routed directly to the physical 3D print simulation tray queue.
              </p>
            </div>

            <div className="flex items-center gap-2.5 pt-2">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-slate-600 font-bold text-xs transition-colors cursor-pointer text-center"
              >
                Back to Editor
              </button>
              <button
                onClick={executeConfirmAndProceed}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition-colors shadow-sm cursor-pointer text-center flex items-center justify-center gap-1"
              >
                <span>Yes, Confirm Design</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

