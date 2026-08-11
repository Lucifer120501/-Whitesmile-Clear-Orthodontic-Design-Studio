export interface RetainerRuleSet {
  title: string;
  material: string;
  thickness: string[];
  coverage: string;
  trimLine: string;
  additionalRules: string[];
}

export const ESSIX_RULES: RetainerRuleSet = {
  title: "Essix Retainer Rules",
  material: "PETG (Thermoforming Plastic)",
  thickness: ["0.75mm", "1.0mm", "1.5mm"],
  coverage: "Full arch coverage up to the second molar",
  trimLine: "Scalloped 1-2mm above the gingival margin (gum line)",
  additionalRules: [
    "Avoid placing over deep undercuts to prevent appliance locking",
    "Add block-out/relief for frenum and highly sensitive gingival papillae",
    "Ensure adequate cooling time post-thermoforming to prevent shrinkage"
  ]
};

export const HAWLEY_RULES: RetainerRuleSet = {
  title: "Hawley Retainer Rules",
  material: "Self-curing or heat-cured Acrylic PMMA Baseplate",
  thickness: ["Baseplate thickness: approx 2.0mm - 2.5mm for structural strength", "0.7mm Stainless Steel Labial Bow"],
  coverage: "Palatal coverage (upper) / Lingual flange coverage (lower) with anterior bar wire",
  trimLine: "Extends to the cervical third of the teeth for maximum stabilization",
  additionalRules: [
    "Requires 0.7mm stainless steel labial bow across anterior teeth (canine to canine)",
    "Adams clasps or ball clasps optional for posterior retention (typically on first molars)",
    "Acrylic baseplate must be finished and polished to high gloss, free of porosity",
    "Used for long-term retention and minor tooth movement adjustment"
  ]
};

export const WARNING_TRIGGERS = [
  {
    condition: "Missing Arch",
    message: "If the prescription fails to specify Upper, Lower, or Both arches, flag a warning."
  },
  {
    condition: "Missing Material/Thickness",
    message: "If Essix is selected but thickness is missing, or Hawley is selected but bow thickness is missing, flag a warning."
  },
  {
    condition: "Potential Scan Defects",
    message: "If the text mentions scan anomalies (e.g., 'gaps', 'bubbles', 'incomplete second molar', 'distorted scan'), flag a warning."
  },
  {
    condition: "Conflicting Instructions",
    message: "For example, asking for 'Hawley with PETG' or 'Essix with acrylic baseplate' is a conflict and must be flagged as a warning."
  }
];
