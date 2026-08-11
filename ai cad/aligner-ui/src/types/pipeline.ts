export interface PipelineConfig {
  stlDir: string
  outputDir: string
  stages: number
  expansion: number
  shell: number
  undercut: number
  blenderPath: string
  pythonPath: string
  pipelineScript: string
}

// Centralized pipeline setup owned by the WhiteSmile main system.
// Satellites (Agliner, Ortho) read this read-only — no local overrides.
export interface SharedPipelineConfig {
  storageFolder: string
  stages: number
  expansion: number
  shellMm: number
  undercutDeg: number
}

export interface PipelineLog {
  text: string
  type: 'stdout' | 'stderr' | 'error' | 'system' | 'info' | 'cmd' | 'success'
  timestamp: number
}

export interface PipelinePhase {
  id: number
  label: string
  description: string
  status: 'idle' | 'processing' | 'success' | 'error'
  progress: number  // 0-100 percentage
}

export interface PipelineState {
  isRunning: boolean
  phases: PipelinePhase[]
  logs: PipelineLog[]
  currentStage: number
  totalStages: number
  stlDir: string
  outputDir: string
  patientDir: string
  storageDir: string
  mainServerUrl: string
}

export interface AutoPipelineConfig {
  pythonPath: string
  patientDir: string
  stages: number
  shell: number
  undercut: number
  blenderPath: string
}

export interface FastPipelineConfig {
  pythonPath: string
  inputPath: string
  outputPath: string
  archType: 'upper' | 'lower' | 'auto'
  cutRatio: number
  mainServerUrl: string
  prescription: string
  storagePath: string
}

export interface StlFileInfo {
  name: string
  path: string
}

export interface StlData {
  bytes: ArrayBuffer | number[]
  byteLength: number
  path: string
  error?: string
}

export interface ElectronAPI {
  selectDirectory: () => Promise<string | null>
  selectFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
  saveDialog: (options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
  readJson: (filePath: string) => Promise<any>
  readStlBuffer: (filePath: string) => Promise<StlData>
  saveFile: (filePath: string, bytes: number[]) => Promise<{ success?: boolean; error?: string }>
  listStlFiles: (dirPath: string) => Promise<StlFileInfo[]>
  pathExists: (filePath: string) => Promise<boolean>
  runPipeline: (config: PipelineConfig) => Promise<{ code: number; output: string }>
  runAutoPipeline: (config: AutoPipelineConfig) => Promise<{ code: number; output: string }>
  runFastPipeline: (config: FastPipelineConfig) => Promise<{ code: number; output: string }>
  // WhiteSmile main system AI bridge (single AI brain)
  callMainAi: (params: MainAiParams) => Promise<{ success?: boolean; data?: any; error?: string }>
  checkMainAi: (mainServerUrl: string) => Promise<{ available: boolean; aiAvailable?: boolean; storageFolder?: string; mainServerUrl?: string; error?: string }>
  onPipelineLog: (callback: (log: PipelineLog) => void) => () => void
  onPipelineComplete: (callback: (result: { code: number; output: string; complete?: boolean }) => void) => () => void
  onPipelineExportPath: (callback: (path: string) => void) => () => void
}

export interface MainAiParams {
  prescription: string
  stlDir: string
  mainServerUrl: string
  numStages: number
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
