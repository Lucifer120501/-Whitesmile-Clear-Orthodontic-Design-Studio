export interface DesignParameters {
  appliance: "Essix" | "Hawley" | "Other" | "";
  arch: "Upper" | "Lower" | "Both" | "";
  material: string;
  thickness_mm: number;
  coverage: string;
  trim_line: string;
  relief_areas: string[];
  special_notes: string;
}

export interface AnalysisResult {
  design_parameters: DesignParameters;
  manufacturing_instructions: string[];
  warnings: string[];
  treatment_plan?: string;
}

export interface UploadedFile {
  name: string;
  size: number;
  mimeType: string;
  url?: string;
  isAttachment?: boolean;
}

export interface DentalCase {
  id: string;
  createdAt: string;
  prescriptionText: string;
  files: UploadedFile[];
  status: "pending" | "processed" | "failed" | "confirmed";
  ownerUserId?: string;
  ownerUsername?: string;
  companyId?: string;
  companyName?: string;
  result?: AnalysisResult;
}
