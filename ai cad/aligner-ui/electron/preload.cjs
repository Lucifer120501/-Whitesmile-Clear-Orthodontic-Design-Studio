const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Directory selection
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectFile: (filters) => ipcRenderer.invoke('select-file', filters),
  saveDialog: (options) => ipcRenderer.invoke('save-dialog', options),

  // File operations
  readJson: (filePath) => ipcRenderer.invoke('read-json', filePath),
  readStlBuffer: (filePath) => ipcRenderer.invoke('read-stl-buffer', filePath),
  saveFile: (filePath, bytes) => ipcRenderer.invoke('save-file', filePath, bytes),
  listStlFiles: (dirPath) => ipcRenderer.invoke('list-stl-files', dirPath),
  pathExists: (filePath) => ipcRenderer.invoke('path-exists', filePath),

  // Pipeline execution
  runPipeline: (config) => ipcRenderer.invoke('run-pipeline', config),
  runAutoPipeline: (config) => ipcRenderer.invoke('run-auto-pipeline', config),
  runFastPipeline: (config) => ipcRenderer.invoke('run-fast-pipeline', config),

  // WhiteSmile main system AI bridge (single AI brain)
  callMainAi: (params) => ipcRenderer.invoke('call-main-ai', params),
  checkMainAi: (mainServerUrl) => ipcRenderer.invoke('check-main-ai', mainServerUrl),

  // Pipeline events (main → renderer)
  onPipelineLog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('pipeline-log', handler);
    return () => ipcRenderer.removeListener('pipeline-log', handler);
  },
  onPipelineComplete: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('pipeline-complete', handler);
    return () => ipcRenderer.removeListener('pipeline-complete', handler);
  },
  onPipelineExportPath: (callback) => {
    const handler = (_event, path) => callback(path);
    ipcRenderer.on('pipeline-export-path', handler);
    return () => ipcRenderer.removeListener('pipeline-export-path', handler);
  },
});
