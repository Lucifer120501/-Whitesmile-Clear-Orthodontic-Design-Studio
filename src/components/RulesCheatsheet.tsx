import { useState } from "react";
import { ESSIX_RULES, HAWLEY_RULES } from "../dental_rules";
import { 
  FileText, 
  ShieldAlert, 
  BookOpen, 
  Cpu, 
  Sparkles, 
  Layers, 
  Bookmark, 
  Workflow, 
  GraduationCap, 
  CheckCircle,
  Code,
  Info,
  Scale,
  Wrench,
  AlertTriangle
} from "lucide-react";

export default function RulesCheatsheet() {
  const [activeTab, setActiveTab] = useState<"specs" | "library" | "tools" | "restorative">("restorative");

  // --- Orthodontic-Restorative Diagnostic Planner States ---
  const [missingToothType, setMissingToothType] = useState<"molar" | "incisor" | "premolar">("molar");
  const [mesiodistalWidth, setMesiodistalWidth] = useState<number>(7.5);
  const [apexSpacing, setApexSpacing] = useState<number>(6.0);
  const [tippingAngle, setTippingAngle] = useState<number>(12);

  const [incisalWear, setIncisalWear] = useState<number>(1.5);
  const [gingivalStep, setGingivalStep] = useState<number>(1.0);
  const [smileLine, setSmileLine] = useState<"high" | "average" | "low">("average");

  const [extrusionHeight, setExtrusionHeight] = useState<number>(1.8);
  const [boneHeight, setBoneHeight] = useState<number>(85);

  // --- Calculations for Orthodontic-Restorative Space Analysis ---
  const getSpaceAnalysis = () => {
    let idealWidth = 7.5; // Molar
    let minApex = 7.0;
    let toothName = "Lower First Molar";

    if (missingToothType === "incisor") {
      idealWidth = 6.0;
      minApex = 5.5;
      toothName = "Upper Lateral Incisor";
    } else if (missingToothType === "premolar") {
      idealWidth = 6.8;
      minApex = 6.3;
      toothName = "Upper/Lower Premolar";
    }

    const widthDiff = mesiodistalWidth - idealWidth;
    let mdStatus: "critical" | "acceptable" | "excessive";
    let mdMessage = "";
    
    if (widthDiff < -1.0) {
      mdStatus = "critical";
      mdMessage = `Critical space deficit of ${Math.abs(widthDiff).toFixed(1)}mm. Immediate orthodontic space opening indicated before implant placement.`;
    } else if (widthDiff > 1.5) {
      mdStatus = "excessive";
      mdMessage = `Excessive gap width (+${widthDiff.toFixed(1)}mm). Prioritize orthodontic space consolidation or redistribution to avoid poor aesthetic papillae emergence.`;
    } else {
      mdStatus = "acceptable";
      mdMessage = "Ideal restorative space width achieved. Retain existing position during active aligner design.";
    }

    const apexDiff = apexSpacing - minApex;
    let apexStatus: "critical" | "acceptable";
    let apexMessage = "";

    if (apexDiff < 0) {
      apexStatus = "critical";
      apexMessage = `Root collision risk! Root distance at apex (${apexSpacing}mm) is less than required safety zone (${minApex}mm) for a standard implant fixture. Parallelization or divergence of neighboring roots is mandatory.`;
    } else {
      apexStatus = "acceptable";
      apexMessage = `Roots are sufficiently parallel/divergent (${apexSpacing}mm space at apex). Safe for implant placement.`;
    }

    let tippingStatus: "none" | "mild" | "severe";
    let tippingMessage = "";

    if (tippingAngle > 15) {
      tippingStatus = "severe";
      tippingMessage = `Severe mesial tipping (${tippingAngle}°). Uprighting is critical! Placing restorative fixtures in tilted sockets will cause vertical bone defects, food impaction, and path-of-insertion binding.`;
    } else if (tippingAngle > 8) {
      tippingStatus = "mild";
      tippingMessage = `Mild tipping (${tippingAngle}°). Moderate path-of-insertion correction needed. Propose 5°–8° of tipping correction in aligner setup.`;
    } else {
      tippingStatus = "none";
      tippingMessage = "Incisors/molars are parallel. Path of insertion is clear.";
    }

    return {
      idealWidth,
      minApex,
      toothName,
      mdStatus,
      mdMessage,
      apexStatus,
      apexMessage,
      tippingStatus,
      tippingMessage
    };
  };

  const spaceResult = getSpaceAnalysis();

  // --- Calculations for Gingival Leveling & Wear ---
  const getGingivalAnalysis = () => {
    let diagnosis = "";
    let recommendation = "";
    let biologicalRisk = "Low";
    let actionColor = "";

    if (gingivalStep < 0) {
      diagnosis = "Gingival recession on damaged/worn tooth, lengthening the clinical crown.";
      recommendation = "Orthodontic intrusion is contraindicated as it may worsen biological periodontal detachment. Recommend mucogingival grafting first, followed by conservative composite margins.";
      biologicalRisk = "High (Periodontal hazard)";
      actionColor = "text-red-700 bg-red-50 border-red-200";
    } else if (incisalWear > 1.0 && gingivalStep > 0.5) {
      diagnosis = "Compromised incisal edge due to severe wear, paired with coronal gingival margin shift.";
      if (smileLine === "high") {
        recommendation = "Excellent indication for Orthodontic Intrusion + Restorative lengthening. Intrude the worn tooth to align the gingival zeniths with neighboring teeth, then reconstruct the incisal edges with laminate veneers. Bypasses invasive crown-lengthening surgery!";
        actionColor = "text-teal-700 bg-teal-50 border-teal-200";
      } else {
        recommendation = "Moderate indication for orthodontic intrusion. If smile line is average, a combined approach of light intrusion (0.5-1.0mm) and minimal gingival remodeling is ideal.";
        actionColor = "text-sky-700 bg-sky-50 border-sky-200";
      }
    } else if (incisalWear > 1.0 && gingivalStep <= 0.5) {
      diagnosis = "Isolated incisal attrition with stable gingival position.";
      recommendation = "Orthodontic extrusion or intrusion is not indicated. Perform simple restorative bonding/veneers directly. Retain identical gingival margins on aligner paths.";
      actionColor = "text-slate-700 bg-slate-50 border-slate-200";
    } else {
      diagnosis = "Minor dental wear and healthy gingival level alignment.";
      recommendation = "No intervention needed. Maintain existing CAD positioning.";
      actionColor = "text-slate-700 bg-slate-50 border-slate-200";
    }

    return { diagnosis, recommendation, biologicalRisk, actionColor };
  };

  const gingivalResult = getGingivalAnalysis();

  // --- Calculations for Opposing Extrusion ---
  const getExtrusionAnalysis = () => {
    let intrusionLimit = 0.15; // standard clear-aligner limit mm per step
    let forceRecommendation = "Light continuous force (15g to 20g)";
    let systemChoice = "Standard clear aligners with auxiliary buccal/lingual composite buttons";
    let warning = null;

    if (boneHeight < 55) {
      intrusionLimit = 0.05;
      forceRecommendation = "Ultra-light continuous force (5g to 8g) via superelastic shape-memory polymers";
      systemChoice = "Rigid multi-segmental archwire with TAD stabilization. Aligners are contraindicated due to extreme risk of reciprocal tipping.";
      warning = "CRITICAL: Severe periodontal bone loss. Intrusion of this tooth moves the center of resistance (CR) closer to the apex. Standard forces will cause rapid root resorption or periodontal failure.";
    } else if (extrusionHeight > 2.2) {
      intrusionLimit = 0.10;
      forceRecommendation = "Moderate continuous force (20g to 25g) utilizing dual-micro-screws (TADs)";
      systemChoice = "Clear aligners combined with buccal & palatal Temporary Anchorage Devices (TADs). Placing TADs ensures pure vertical intrusion without losing posterior anchorage or unseating the aligner.";
      warning = "High Overeruption: Pure aligner setups are prone to unseating. Dual buccal-palatal TAD anchors are strongly recommended for clinical success.";
    }

    return { intrusionLimit, forceRecommendation, systemChoice, warning };
  };

  const extrusionResult = getExtrusionAnalysis();

  return (
    <div id="rules-cheatsheet" className="bg-slate-50 p-6 rounded-xl border border-slate-200 space-y-6">
      
      {/* Upper Tab Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-[#46c0bd]" />
            Clinical CAD Knowledge Hub
          </h2>
          <p className="text-xs text-slate-500 font-medium">
            Bridging peer-reviewed orthodontic science, multidisciplinary adult treatment planning, and AI CAD engines
          </p>
        </div>

        <div className="flex flex-wrap bg-slate-200/80 p-1 rounded-lg gap-1">
          <button
            onClick={() => setActiveTab("restorative")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "restorative" 
                ? "bg-slate-900 text-white shadow-xs" 
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            Ortho-Restorative
          </button>

          <button
            onClick={() => setActiveTab("specs")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "specs" 
                ? "bg-white text-slate-900 shadow-xs" 
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Lab Specs
          </button>
          
          <button
            onClick={() => setActiveTab("library")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "library" 
                ? "bg-white text-slate-900 shadow-xs" 
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Literature DB
          </button>

          <button
            onClick={() => setActiveTab("tools")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "tools" 
                ? "bg-white text-slate-900 shadow-xs" 
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            AI CAD Tech
          </button>
        </div>
      </div>

      {/* TAB PANEL: ORTHODONTIC-RESTORATIVE MULTIDISCIPLINARY INTERFACE */}
      {activeTab === "restorative" && (
        <div className="space-y-6 animate-fade-in">
          
          {/* Scientific Context banner */}
          <div className="bg-slate-900 text-white p-5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 border border-[#46c0bd]/40">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-black tracking-widest text-[#46c0bd] px-2 py-0.5 bg-[#46c0bd]/15 rounded-md border border-[#46c0bd]/20">
                Peer-Reviewed Clinical Core
              </span>
              <h3 className="text-base font-bold tracking-tight text-white">
                The Adult Orthodontic-Restorative Interface Diagnostic Planner
              </h3>
              <p className="text-xs text-slate-400">
                Engineered based on the foundational protocols of <strong>"The Adult Orthodontic-Restorative Interface Part 1: Concepts of Treatment and Presenting Challenges"</strong>.
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[11px] font-mono text-slate-300 italic block">
                "Aligning biology, biomechanics, & prosthetics"
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            
            {/* COLUMN 1: IMPLANT SITE AND ROOT PARALLELISM PLANNER */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100 mb-3">
                  <div className="p-1.5 bg-blue-50 text-blue-600 rounded-md">
                    <Wrench className="w-4 h-4" />
                  </div>
                  <h4 className="font-bold text-sm text-slate-900 uppercase tracking-wide">
                    1. Implant Site & Apex Spacer
                  </h4>
                </div>
                
                <p className="text-xs text-slate-500 mb-4">
                  Computes geometric clearance margins and root collision risks relative to biological thresholds.
                </p>

                {/* Controls */}
                <div className="space-y-4">
                  <div>
                    <label htmlFor="missing-tooth-select" className="text-xs font-bold text-slate-600 block mb-1">Missing Tooth Position</label>
                    <select 
                      id="missing-tooth-select"
                      value={missingToothType} 
                      onChange={(e) => setMissingToothType(e.target.value as any)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-slate-50 font-bold focus:border-[#46c0bd] focus:outline-none cursor-pointer"
                    >
                      <option value="molar">Lower First Molar (#19 / 36)</option>
                      <option value="incisor">Upper Lateral Incisor (#7 / 12)</option>
                      <option value="premolar">Upper Premolar (#4 / 14)</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span className="font-bold">Available MD Gap Width</span>
                      <span className="font-mono text-[#46c0bd] font-extrabold">{mesiodistalWidth.toFixed(1)} mm</span>
                    </div>
                    <input 
                      type="range" 
                      min="3.0" 
                      max="14.0" 
                      step="0.1" 
                      value={mesiodistalWidth}
                      onChange={(e) => setMesiodistalWidth(Number.parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#46c0bd]"
                    />
                    <span className="text-[10px] text-slate-400 block mt-0.5">Ideal width for this site: {spaceResult.idealWidth} mm</span>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span className="font-bold">Root Apex Spacing</span>
                      <span className="font-mono text-[#46c0bd] font-extrabold">{apexSpacing.toFixed(1)} mm</span>
                    </div>
                    <input 
                      type="range" 
                      min="2.0" 
                      max="12.0" 
                      step="0.1" 
                      value={apexSpacing}
                      onChange={(e) => setApexSpacing(Number.parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#46c0bd]"
                    />
                    <span className="text-[10px] text-slate-400 block mt-0.5">Min safety spacing at apex: {spaceResult.minApex} mm</span>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span className="font-bold">Adjacent Molar Tipping</span>
                      <span className="font-mono text-amber-600 font-extrabold">{tippingAngle}° mesial</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="40" 
                      step="1" 
                      value={tippingAngle}
                      onChange={(e) => setTippingAngle(Number.parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#46c0bd]"
                    />
                  </div>
                </div>
              </div>

              {/* Dynamic Analysis Card */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2 mt-4 text-xs">
                <span className="font-extrabold uppercase text-[9px] text-slate-400 tracking-wider block">Clinical Safety Report</span>
                
                {/* MD gap status */}
                <div className="flex gap-1.5 items-start">
                  <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${
                    (() => {
                      if (spaceResult.mdStatus === "critical") {
                        return "bg-red-500 animate-pulse";
                      }
                      if (spaceResult.mdStatus === "excessive") {
                        return "bg-amber-500";
                      }
                      return "bg-emerald-500";
                    })()
                  }`} />
                  <p className="text-slate-600 leading-relaxed font-medium">
                    <strong>MD Space:</strong> {spaceResult.mdMessage}
                  </p>
                </div>

                {/* Apex spacing status */}
                <div className="flex gap-1.5 items-start">
                  <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${
                    spaceResult.apexStatus === "critical" ? "bg-red-500 animate-pulse" : "bg-emerald-500"
                  }`} />
                  <p className="text-slate-600 leading-relaxed font-medium">
                    <strong>Apex Clearance:</strong> {spaceResult.apexMessage}
                  </p>
                </div>

                {/* Tipping status */}
                {tippingAngle > 8 && (
                  <div className="flex gap-1.5 items-start">
                    <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${
                      spaceResult.tippingStatus === "severe" ? "bg-red-500" : "bg-amber-500"
                    }`} />
                    <p className="text-slate-600 leading-relaxed font-medium">
                      <strong>Tipping/Angle:</strong> {spaceResult.tippingMessage}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* COLUMN 2: GINGIVAL ZENITH AND WEAR PLANNER */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100 mb-3">
                  <div className="p-1.5 bg-teal-50 text-[#2c8381] rounded-md">
                    <Scale className="w-4 h-4" />
                  </div>
                  <h4 className="font-bold text-sm text-slate-900 uppercase tracking-wide">
                    2. Gingival Zenith & Wear Advisor
                  </h4>
                </div>
                
                <p className="text-xs text-slate-500 mb-4">
                  Optimizes relative clinical crown height leveling to establish perfect gingival zeniths before veneering.
                </p>

                {/* Controls */}
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span className="font-bold">Incisal Edge Attrition / Wear</span>
                      <span className="font-mono text-[#2c8381] font-extrabold">{incisalWear.toFixed(1)} mm</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.0" 
                      max="4.0" 
                      step="0.5" 
                      value={incisalWear}
                      onChange={(e) => setIncisalWear(Number.parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#2c8381]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span className="font-bold">Gingival Zenith Discrepancy</span>
                      <span className="font-mono text-[#2c8381] font-extrabold">{gingivalStep > 0 ? `+${gingivalStep.toFixed(1)}` : gingivalStep.toFixed(1)} mm</span>
                    </div>
                    <input 
                      type="range" 
                      min="-3.0" 
                      max="3.0" 
                      step="0.5" 
                      value={gingivalStep}
                      onChange={(e) => setGingivalStep(Number.parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#2c8381]"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>Recessed Margin (Longer)</span>
                      <span>Coronal Margin (Shorter)</span>
                    </div>
                  </div>

                  <div>
                    <fieldset className="space-y-2">
                      <legend className="text-xs font-bold text-slate-600 block">Smile Line Display Height</legend>
                      <div className="grid grid-cols-3 gap-2">
                      {(["high", "average", "low"] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => setSmileLine(s)}
                          className={`text-xs py-1.5 rounded-lg border font-bold capitalize cursor-pointer transition-all ${
                            smileLine === s 
                              ? "bg-slate-900 border-slate-900 text-white" 
                              : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                      </div>
                    </fieldset>
                  </div>
                </div>
              </div>

              {/* Dynamic Analysis Card */}
              <div className={`p-4 rounded-lg border ${gingivalResult.actionColor} space-y-2 mt-4 text-xs`}>
                <div>
                  <span className="font-black uppercase tracking-wider text-[9px] block mb-0.5">Biomechanical Assessment</span>
                  <p className="font-medium leading-relaxed">
                    <strong>Diagnosis:</strong> {gingivalResult.diagnosis}
                  </p>
                </div>
                
                <div className="pt-2 border-t border-current/25">
                  <span className="font-black uppercase tracking-wider text-[9px] block mb-0.5">CAD Action Plan</span>
                  <p className="leading-relaxed">
                    {gingivalResult.recommendation}
                  </p>
                </div>

                <div className="flex items-center justify-between text-[10px] font-bold pt-1.5 border-t border-current/15">
                  <span>Periodontal Clearance Risk:</span>
                  <span className="uppercase">{gingivalResult.biologicalRisk}</span>
                </div>
              </div>
            </div>

            {/* COLUMN 3: OPPOSING TOOTH INTRUSION PLANNER */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100 mb-3">
                  <div className="p-1.5 bg-amber-50 text-amber-600 rounded-md">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <h4 className="font-bold text-sm text-slate-900 uppercase tracking-wide">
                    3. Occlusal Space Reclamation
                  </h4>
                </div>
                
                <p className="text-xs text-slate-500 mb-4">
                  Calculates intrusion parameters and limits for antagonists that overerupted due to tooth loss.
                </p>

                {/* Controls */}
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span className="font-bold">Overeruption Depth</span>
                      <span className="font-mono text-amber-600 font-extrabold">{extrusionHeight.toFixed(1)} mm</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.0" 
                      max="5.0" 
                      step="0.1" 
                      value={extrusionHeight}
                      onChange={(e) => setExtrusionHeight(Number.parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
                    />
                    <span className="text-[10px] text-slate-400 block mt-0.5">Vertical displacement to push back into bone</span>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span className="font-bold">Alveolar Bone Support</span>
                      <span className={`font-mono font-extrabold ${boneHeight < 55 ? "text-red-600 animate-pulse" : "text-emerald-600"}`}>{boneHeight}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="30" 
                      max="100" 
                      step="5" 
                      value={boneHeight}
                      onChange={(e) => setBoneHeight(Number.parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
                    />
                  </div>
                </div>
              </div>

              {/* Dynamic Analysis Card */}
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-3 mt-4 text-xs">
                
                {extrusionResult.warning && (
                  <div className="bg-red-50 text-red-800 border border-red-100 p-2.5 rounded-md flex gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <p className="font-bold leading-normal text-[10px]">
                      {extrusionResult.warning}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Orthodontic Velocity Limit</span>
                    <span className="font-bold text-slate-800 text-xs">Max {extrusionResult.intrusionLimit} mm per active stage</span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Clinical Force Loading</span>
                    <span className="font-bold text-[#46c0bd]">{extrusionResult.forceRecommendation}</span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Anchorage Control Strategy</span>
                    <span className="text-slate-700 font-medium leading-relaxed block text-[11px] mt-0.5">
                      {extrusionResult.systemChoice}
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Quick-Reference Core Rules from Literature */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-4">
            <h4 className="font-extrabold text-sm text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Info className="w-4 h-4 text-[#46c0bd]" />
              Multidisciplinary CAD Design Directives
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs leading-relaxed text-slate-600">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <span className="font-bold text-slate-800 block mb-1">Biological Width Preservation</span>
                <span className="block text-slate-600">Keep aligner or prosthetic margins strictly 1.5–2.0mm coronal to the bone level. Encroaching on biological width causes chronic inflammation, bone loss, and margin instability.</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <span className="font-bold text-slate-800 block mb-1">Molar Uprighting Moment</span>
                <span className="block text-slate-600">Distal crown tipping creates a relative extrusive vector. When designing molar uprighting on aligners, always include reciprocal relative intrusions to keep the occlusal plane flat.</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <span className="font-bold text-slate-800 block mb-1">Pontic Configuration in CAD</span>
                <span className="block text-slate-600">For missing anterior spaces, design egg-shaped or modified ridge-lap pontics inside active clear aligners to support the papilla and prevent collapsed embrasures during tooth movement.</span>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* TAB PANEL 1: SPECIFICATIONS */}
      {activeTab === "specs" && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Essix rules */}
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs" id="essix-rules-card">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100">
                <span className="bg-[#46c0bd]/10 text-[#2c8381] text-xs font-bold px-2.5 py-1 rounded-sm uppercase tracking-wider">
                  Type 1
                </span>
                <h3 className="font-bold text-slate-800">{ESSIX_RULES.title}</h3>
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-xs font-semibold uppercase text-slate-400 block">Material</span>
                  <span className="text-slate-700 font-medium">{ESSIX_RULES.material}</span>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase text-slate-400 block">Available Thicknesses</span>
                  <div className="flex gap-2 mt-1">
                    {ESSIX_RULES.thickness.map((t) => (
                      <span key={t} className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-medium border border-slate-200">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase text-slate-400 block">Coverage</span>
                  <span className="text-slate-700">{ESSIX_RULES.coverage}</span>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase text-slate-400 block">Trim Line Spec</span>
                  <span className="text-slate-700">{ESSIX_RULES.trimLine}</span>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase text-slate-400 block mb-1">Undercuts & Reliefs</span>
                  <ul className="list-disc pl-4 space-y-1 text-xs text-slate-500">
                    {ESSIX_RULES.additionalRules.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Hawley rules */}
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs" id="hawley-rules-card">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100">
                <span className="bg-slate-100 text-slate-700 text-xs font-bold px-2.5 py-1 rounded-sm uppercase tracking-wider">
                  Type 2
                </span>
                <h3 className="font-bold text-slate-800">{HAWLEY_RULES.title}</h3>
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-xs font-semibold uppercase text-slate-400 block">Materials</span>
                  <span className="text-slate-700 font-medium">{HAWLEY_RULES.material}</span>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase text-slate-400 block">Thickness Specification</span>
                  <div className="space-y-1 mt-1">
                    {HAWLEY_RULES.thickness.map((t) => (
                      <div key={t} className="text-xs text-slate-600 bg-slate-50 p-1.5 rounded border border-slate-100">
                        {t}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase text-slate-400 block">Coverage</span>
                  <span className="text-slate-700">{HAWLEY_RULES.coverage}</span>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase text-slate-400 block">Trim Line Spec</span>
                  <span className="text-slate-700">{HAWLEY_RULES.trimLine}</span>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase text-slate-400 block mb-1">Wire & Polishing</span>
                  <ul className="list-disc pl-4 space-y-1 text-xs text-slate-500">
                    {HAWLEY_RULES.additionalRules.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Warnings checks info */}
          <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 text-xs flex gap-3 animate-fade-in" id="warning-checklist-bar">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-amber-900 block mb-1 uppercase tracking-wider text-[10px]">
                Automated Risk & Compliance Audit
              </span>
              <p className="text-amber-700 leading-relaxed font-medium">
                The clinical checker actively scans designs for: <strong className="text-amber-800">Gingival collision zones</strong>, <strong className="text-amber-800">Severe molar undercuts</strong>, <strong className="text-amber-800">Staging velocity limits (max 0.25mm/stage)</strong>, and <strong className="text-amber-800">Material fatigue boundaries</strong> to prevent bracket fractures or root resorption during active tooth movement.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB PANEL 2: LITERATURE DATABASE */}
      {activeTab === "library" && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-emerald-50/40 border border-emerald-100 p-4 rounded-lg text-xs leading-relaxed font-medium text-emerald-800 flex gap-2">
            <Bookmark className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <span className="font-black uppercase tracking-wider block text-[10px] text-emerald-900 mb-0.5">Clinical Fact Sheet</span>
              <p className="text-emerald-800">These peer-reviewed references define the clinical thresholds, material thickness decay curves, and anatomical boundaries programmed into our AI CAD engine's decision-making system.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Book 6 - The Orthodontic-Restorative Interface (Added from prompt) */}
            <div className="bg-[#46c0bd]/5 p-4 rounded-lg border border-[#46c0bd]/20 shadow-xs flex flex-col justify-between md:col-span-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] bg-[#2c8381] text-white font-bold px-1.5 py-0.5 rounded uppercase tracking-wider block w-fit mb-2">
                    Primary Reference • Adult Multidisciplinary
                  </span>
                  <h4 className="font-black text-slate-950 text-sm leading-tight mb-1">
                    The Adult Orthodontic-Restorative Interface Part 1: Concepts of Treatment and Presenting Challenges
                  </h4>
                  <p className="text-slate-400 text-xs font-semibold mb-3">
                    ResearchGate Publication 384756315 (2024)
                  </p>
                  <p className="text-slate-600 text-xs">
                    <strong>Biomechanics Core:</strong> Critical guidelines on treatment sequencing for adults with complex wear, missing teeth, and periodontal compromise. Emphasizes tooth parallelization for stable prosthetic seating and crown-height management before cosmetic laminates.
                  </p>
                </div>
                <div className="flex flex-col justify-between">
                  <p className="text-slate-500 text-xs italic bg-slate-50 p-2.5 rounded border border-slate-100 h-full flex items-center">
                    "Orthodontic tooth alignment serves to optimize the mechanical path of insertion for future restorative components, ensuring long-term periodontal health and alveolar bone conservation."
                  </p>
                  <div className="mt-2 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold uppercase text-[#2c8381]">
                    <span>Applied to: Multidisciplinary CAD setups</span>
                    <CheckCircle className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            </div>

            {/* Book 1 */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded uppercase tracking-wider block w-fit mb-2">
                  Materials Science
                </span>
                <h4 className="font-bold text-slate-950 text-sm leading-tight mb-1">
                  Orthodontic Aligner Treatment: A Review of Materials, Clinical Management, and Evidence
                </h4>
                <p className="text-slate-400 text-xs font-semibold mb-3">
                  Eliades, T., Athanasiou, A. E. (2020) • Germany: Thieme
                </p>
                <div className="space-y-2 text-xs">
                  <p className="text-slate-600">
                    <strong>Biomechanics Core:</strong> Focuses on in vivo degradation of polymers, elastic modulus decay, and thermal changes in oral environments.
                  </p>
                  <p className="text-slate-500 italic bg-slate-50 p-2 rounded border border-slate-100">
                    "Thermoformed PETG and polyurethane elements experience up to 50% force decay within 24 hours of clinical wear, requiring strategic thickness offsets."
                  </p>
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold uppercase text-[#46c0bd]">
                <span>Applied to: Shell Thickness limits</span>
                <CheckCircle className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Book 2 */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] bg-sky-50 text-sky-700 font-bold px-1.5 py-0.5 rounded uppercase tracking-wider block w-fit mb-2">
                  3D Imaging & Segmentation
                </span>
                <h4 className="font-bold text-slate-950 text-sm leading-tight mb-1">
                  Applications of Three-dimensional Imaging for Craniofacial Region
                </h4>
                <p className="text-slate-400 text-xs font-semibold mb-3">
                  Springer Nature Singapore (2024)
                </p>
                <div className="space-y-2 text-xs">
                  <p className="text-slate-600">
                    <strong>Biomechanics Core:</strong> Covers CBCT and intraoral scan registration, segmenting individual root coordinates, and detecting cortical plate limits.
                  </p>
                  <p className="text-slate-500 italic bg-slate-50 p-2 rounded border border-slate-100">
                    "Volumetric evaluation allows modeling of center of resistance, mitigating the risk of root resorption during dual-axis intrusive steps."
                  </p>
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold uppercase text-[#46c0bd]">
                <span>Applied to: Anatomical Safety Audits</span>
                <CheckCircle className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Book 3 */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] bg-purple-50 text-purple-700 font-bold px-1.5 py-0.5 rounded uppercase tracking-wider block w-fit mb-2">
                  Advanced Biomaterials
                </span>
                <h4 className="font-bold text-slate-950 text-sm leading-tight mb-1">
                  Advanced Use of Materials in Orthodontics
                </h4>
                <p className="text-slate-400 text-xs font-semibold mb-3">
                  Frontiers Media SA (2023)
                </p>
                <div className="space-y-2 text-xs">
                  <p className="text-slate-600">
                    <strong>Biomechanics Core:</strong> Reviews shape memory polymers, active thermoresponsive sheeting, and multilayer co-extrusion technology.
                  </p>
                  <p className="text-slate-500 italic bg-slate-50 p-2 rounded border border-slate-100">
                    "Co-extruded multilayer materials provide continuous constant orthodontic forces, drastically increasing orthodontic staging efficiency."
                  </p>
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold uppercase text-[#46c0bd]">
                <span>Applied to: Material Recommendations</span>
                <CheckCircle className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Book 4 */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded uppercase tracking-wider block w-fit mb-2">
                  Digital Workflows
                </span>
                <h4 className="font-bold text-slate-950 text-sm leading-tight mb-1">
                  Digital Orthodontics: Providing a Contemporary Treatment Solution
                </h4>
                <p className="text-slate-400 text-xs font-semibold mb-3">
                  Abela, S. (2025) • Germany: Springer International
                </p>
                <div className="space-y-2 text-xs">
                  <p className="text-slate-600">
                    <strong>Biomechanics Core:</strong> Detail-oriented protocols for model preparation, dental STL post-processing, and indirect bonding transfer trays.
                  </p>
                  <p className="text-slate-500 italic bg-slate-50 p-2 rounded border border-slate-100">
                    "Sub-millimeter accuracy of direct 3D printing of aligners bypasses model expansion errors, guaranteeing an optimal fit at the gingival line."
                  </p>
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold uppercase text-[#46c0bd]">
                <span>Applied to: Printer Post-Processing Specs</span>
                <CheckCircle className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Book 5 */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs flex flex-col justify-between md:col-span-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] bg-amber-50 text-amber-700 font-bold px-1.5 py-0.5 rounded uppercase tracking-wider block w-fit mb-2">
                    Contemporary Orthodontics
                  </span>
                  <h4 className="font-bold text-slate-950 text-sm leading-tight mb-1">
                    Issues in Contemporary Orthodontics
                  </h4>
                  <p className="text-slate-400 text-xs font-semibold mb-3">
                    IntechOpen (2015)
                  </p>
                  <p className="text-slate-600 text-xs">
                    <strong>Biomechanics Core:</strong> Explores anchorage mechanics, dental tipping controls, bone density variances, and root torque limits. This is a foundational reference for preventing periodontal damage.
                  </p>
                </div>
                <div className="flex flex-col justify-between">
                  <p className="text-slate-500 text-xs italic bg-slate-50 p-2.5 rounded border border-slate-100 h-full flex items-center">
                    "Staging translational root movement requires high-integrity anchorage control. Passive molar blocks must be utilized as anchorages while anterior teeth are sequentially tipped."
                  </p>
                  <div className="mt-2 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold uppercase text-[#46c0bd]">
                    <span>Applied to: Active/Passive Arch Tab Staging</span>
                    <CheckCircle className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* TAB PANEL 3: AI CAD SYSTEMS */}
      {activeTab === "tools" && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-slate-800 text-white p-4 rounded-lg text-xs leading-relaxed flex gap-3 shadow-md">
            <Workflow className="w-5 h-5 text-[#46c0bd] shrink-0 mt-0.5" />
            <div>
              <span className="font-extrabold text-[#46c0bd] uppercase tracking-wider block text-[10px] mb-1">
                Generative AI Integration Core
              </span>
              <p className="text-slate-300">Modern clinical laboratories combine parametric text-to-3D model engines with deep learning assistants to accelerate digital orthodontics. Below is a taxonomy of leading AI CAD platforms emulated and referenced within our clinical copilot.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            
            {/* Tool 1 */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 hover:border-[#46c0bd]/40 transition-colors flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="p-1 rounded-md bg-slate-100 text-slate-700">
                    <Code className="w-3.5 h-3.5" />
                  </div>
                  <h4 className="font-extrabold text-slate-900 text-xs uppercase tracking-wide">AdamCAD</h4>
                </div>
                <p className="text-slate-600 text-xs leading-relaxed">
                  Translates natural text descriptions and manufacturing specs into fully-formed parametric 3D models and multi-part assemblies ready for direct manufacturing.
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-50 text-[10px] text-slate-400 font-bold uppercase">
                Focus: Text-to-B-Rep Assemblies
              </div>
            </div>

            {/* Tool 2 */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 hover:border-[#46c0bd]/40 transition-colors flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="p-1 rounded-md bg-slate-100 text-slate-700">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <h4 className="font-extrabold text-slate-900 text-xs uppercase tracking-wide">Zoo (Text-to-CAD)</h4>
                </div>
                <p className="text-slate-600 text-xs leading-relaxed">
                  An open-source, code-driven text-to-CAD engine that lets technicians prototype solid geometry quickly using direct natural language prompts.
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-50 text-[10px] text-slate-400 font-bold uppercase">
                Focus: Code-Generated solids
              </div>
            </div>

            {/* Tool 3 */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 hover:border-[#46c0bd]/40 transition-colors flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="p-1 rounded-md bg-slate-100 text-slate-700">
                    <Layers className="w-3.5 h-3.5" />
                  </div>
                  <h4 className="font-extrabold text-slate-900 text-xs uppercase tracking-wide">OpenArt AI CAD</h4>
                </div>
                <p className="text-slate-600 text-xs leading-relaxed">
                  Converts plain text descriptions, scanned dental photos, or manual sketches into clean CAD layouts, floor plans, and technical isometric diagrams.
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-50 text-[10px] text-slate-400 font-bold uppercase">
                Focus: Image-to-Vector Drafting
              </div>
            </div>

            {/* Tool 4 */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 hover:border-[#46c0bd]/40 transition-colors flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="p-1 rounded-md bg-slate-100 text-slate-700">
                    <Cpu className="w-3.5 h-3.5" />
                  </div>
                  <h4 className="font-extrabold text-slate-900 text-xs uppercase tracking-wide">Autodesk Fusion</h4>
                </div>
                <p className="text-slate-600 text-xs leading-relaxed">
                  Utilizes embedded AI systems for automated generative design, topology refinement, predictive fatigue mapping, and rapid error detection.
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-50 text-[10px] text-slate-400 font-bold uppercase">
                Focus: Topology Optimization
              </div>
            </div>

            {/* Tool 5 */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 hover:border-[#46c0bd]/40 transition-colors flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="p-1 rounded-md bg-slate-100 text-slate-700">
                    <Workflow className="w-3.5 h-3.5" />
                  </div>
                  <h4 className="font-extrabold text-slate-900 text-xs uppercase tracking-wide">SolidWorks AI</h4>
                </div>
                <p className="text-slate-600 text-xs leading-relaxed">
                  Integrates contextual command predictors, automated constraint mating, and assembly generators to minimize repetitive lab clicks.
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-50 text-[10px] text-slate-400 font-bold uppercase">
                Focus: Predictive assembly mating
              </div>
            </div>

            {/* Tool 6 */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 hover:border-[#46c0bd]/40 transition-colors flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="p-1 rounded-md bg-slate-100 text-slate-700">
                    <GraduationCap className="w-3.5 h-3.5" />
                  </div>
                  <h4 className="font-extrabold text-slate-900 text-xs uppercase tracking-wide">Siemens NX</h4>
                </div>
                <p className="text-slate-600 text-xs leading-relaxed">
                  Employs advanced AI-guided telemetry analysis to dynamically recommend macro functions, pathing setups, and model orientation shortcuts.
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-50 text-[10px] text-slate-400 font-bold uppercase">
                Focus: Contextual user-assist
              </div>
            </div>

            {/* Tool 7 - Spans remaining columns */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100 p-4 rounded-lg hover:shadow-lg transition-all flex flex-col justify-between md:col-span-2 lg:col-span-3 border border-[#46c0bd]/30">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-1">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="w-4 h-4 text-[#46c0bd]" />
                    <h4 className="font-extrabold text-white text-xs uppercase tracking-wide">CADGPT</h4>
                  </div>
                  <p className="text-slate-300 text-xs leading-relaxed">
                    A specialized AI assistant that automates scripts, answers orthodontic biomechanics questions, and formats custom dental laboratory command macros.
                  </p>
                </div>
                <div className="md:col-span-2 bg-white/5 p-3 rounded border border-white/10 text-[11px] leading-relaxed text-slate-200 space-y-2">
                  <span className="font-bold text-[#46c0bd] uppercase tracking-wider block text-[9px]">How our platform integrates CADGPT concepts</span>
                  <p>
                    Our integrated <strong>AI Ortho CAD Co-Pilot</strong> behaves like a dedicated CADGPT. It is continuously loaded with your patient's exact active arch specifications, trim line offsets, and appliance materials. When asked about rotational control, it dynamically calculates root movement tolerances and proposes direct CAD configurations.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
