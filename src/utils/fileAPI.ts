/**
 * Unified file API — uses Electron IPC when available, falls back to HTTP proxy.
 * This allows the browser dev view (localhost:5173) to access the same data
 * as the Electron desktop window.
 */

type FileAction = 'getNovelsDir' | 'ensureDirectory' | 'readFile' | 'writeFile'
  | 'deleteFile' | 'listFiles' | 'deleteDirectory' | 'pathExists' | 'pathJoin'
  | 'startDeepSeekProxy' | 'stopDeepSeekProxy' | 'getDeepSeekProxyStatus'
  | 'saveDeepSeekConfig' | 'loadDeepSeekConfig'

async function callHTTP(action: FileAction, args: any[]): Promise<any> {
  const res = await fetch('http://localhost:3456/api/fs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args })
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.result
}

const hasElectron = typeof window !== 'undefined' && !!(window as any).electronAPI
const api = hasElectron ? (window as any).electronAPI : null

export const fileAPI = {
  getNovelsDir: (): Promise<string> =>
    api ? api.getNovelsDir() : callHTTP('getNovelsDir', []),

  ensureDirectory: (dirPath: string): Promise<void> =>
    api ? api.ensureDirectory(dirPath) : callHTTP('ensureDirectory', [dirPath]),

  readFile: (filePath: string): Promise<string> =>
    api ? api.readFile(filePath) : callHTTP('readFile', [filePath]),

  writeFile: (filePath: string, content: string): Promise<void> =>
    api ? api.writeFile(filePath, content) : callHTTP('writeFile', [filePath, content]),

  deleteFile: (filePath: string): Promise<void> =>
    api ? api.deleteFile(filePath) : callHTTP('deleteFile', [filePath]),

  listFiles: (dirPath: string): Promise<{ name: string; isDirectory: boolean }[]> =>
    api ? api.listFiles(dirPath) : callHTTP('listFiles', [dirPath]),

  deleteDirectory: (dirPath: string): Promise<void> =>
    api ? api.deleteDirectory(dirPath) : callHTTP('deleteDirectory', [dirPath]),

  pathExists: (filePath: string): Promise<boolean> =>
    api ? api.pathExists(filePath) : callHTTP('pathExists', [filePath]),

  pathJoin: (...segments: string[]): Promise<string> =>
    api ? api.pathJoin(...segments) : callHTTP('pathJoin', segments),
}

export const deepseekProxy = {
  start: (token: string): Promise<{ success: boolean; error?: string; pid?: number }> =>
    api ? api.startDeepSeekProxy(token) : callHTTP('startDeepSeekProxy', [token]),

  stop: (): Promise<{ success: boolean; error?: string }> =>
    api ? api.stopDeepSeekProxy() : callHTTP('stopDeepSeekProxy', []),

  status: (): Promise<{ running: boolean; pid: number | null }> =>
    api ? api.getDeepSeekProxyStatus() : callHTTP('getDeepSeekProxyStatus', []),

  onLog: (callback: (log: string) => void) => {
    if (api) api.onDeepSeekProxyLog(callback)
  },

  saveConfig: (config: { token: string; model: string }): Promise<void> =>
    api ? api.saveDeepSeekConfig(config) : callHTTP('saveDeepSeekConfig', [config]),

  loadConfig: (): Promise<{ token: string; model: string }> =>
    api ? api.loadDeepSeekConfig() : callHTTP('loadDeepSeekConfig', []),
}
