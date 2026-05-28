import { contextBridge, ipcRenderer } from 'electron'

export interface ElectronAPI {
  getNovelsDir(): Promise<string>
  ensureDirectory(path: string): Promise<void>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  deleteFile(path: string): Promise<void>
  listFiles(dirPath: string): Promise<{ name: string; isDirectory: boolean }[]>
  deleteDirectory(path: string): Promise<void>
  pathExists(path: string): Promise<boolean>
  pathJoin(...segments: string[]): Promise<string>
  selectDirectory(): Promise<string | null>
  saveFileDialog(options: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>
  startDeepSeekProxy(token: string): Promise<{ success: boolean; error?: string; pid?: number }>
  stopDeepSeekProxy(): Promise<{ success: boolean; error?: string }>
  getDeepSeekProxyStatus(): Promise<{ running: boolean; pid: number | null }>
  onDeepSeekProxyLog(callback: (log: string) => void): void
  saveDeepSeekConfig(config: { token: string; model: string }): Promise<void>
  loadDeepSeekConfig(): Promise<{ token: string; model: string }>
}

const electronAPI: ElectronAPI = {
  getNovelsDir: () => ipcRenderer.invoke('getNovelsDir'),
  ensureDirectory: (path) => ipcRenderer.invoke('ensureDirectory', path),
  readFile: (path) => ipcRenderer.invoke('readFile', path),
  writeFile: (path, content) => ipcRenderer.invoke('writeFile', path, content),
  deleteFile: (path) => ipcRenderer.invoke('deleteFile', path),
  listFiles: (dirPath) => ipcRenderer.invoke('listFiles', dirPath),
  deleteDirectory: (path) => ipcRenderer.invoke('deleteDirectory', path),
  pathExists: (path) => ipcRenderer.invoke('pathExists', path),
  pathJoin: (...segments) => ipcRenderer.invoke('pathJoin', ...segments),
  selectDirectory: () => ipcRenderer.invoke('selectDirectory'),
  saveFileDialog: (options) => ipcRenderer.invoke('saveFileDialog', options),
  startDeepSeekProxy: (token) => ipcRenderer.invoke('startDeepSeekProxy', token),
  stopDeepSeekProxy: () => ipcRenderer.invoke('stopDeepSeekProxy'),
  getDeepSeekProxyStatus: () => ipcRenderer.invoke('getDeepSeekProxyStatus'),
  onDeepSeekProxyLog: (callback) => {
    ipcRenderer.removeAllListeners('deepseek-proxy-log')
    ipcRenderer.on('deepseek-proxy-log', (_event, log) => callback(log))
  },
  saveDeepSeekConfig: (config) => ipcRenderer.invoke('saveDeepSeekConfig', config),
  loadDeepSeekConfig: () => ipcRenderer.invoke('loadDeepSeekConfig')
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
