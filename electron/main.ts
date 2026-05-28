import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import http from 'http'
import { spawn, type ChildProcess } from 'child_process'

let mainWindow: BrowserWindow | null = null

const isDev = !app.isPackaged

// DeepSeek proxy process management
function getDeepSeekProxyDir(): string {
  return path.join(app.getAppPath(), 'deepseek-proxy')
}
let deepseekProxyProcess: ChildProcess | null = null

function getNovelsDir(): string {
  return path.join(app.getPath('userData'), 'novels')
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (isDev) {
    // Try multiple ports in case Vite uses a different one
    const tryLoad = async (port: number): Promise<boolean> => {
      try {
        await mainWindow!.loadURL(`http://localhost:${port}`)
        return true
      } catch { return false }
    }
    const ports = [5173, 5174, 5175]
    for (const port of ports) {
      if (await tryLoad(port)) break
    }
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// IPC handlers for file operations
function registerIPC() {
  // Get novels directory
  ipcMain.handle('getNovelsDir', () => getNovelsDir())

  // Ensure directory exists
  ipcMain.handle('ensureDirectory', async (_event, dirPath: string) => {
    await fs.mkdir(dirPath, { recursive: true })
  })

  // Read file
  ipcMain.handle('readFile', async (_event, filePath: string) => {
    return await fs.readFile(filePath, 'utf-8')
  })

  // Write file
  ipcMain.handle('writeFile', async (_event, filePath: string, content: string) => {
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
  })

  // Delete file
  ipcMain.handle('deleteFile', async (_event, filePath: string) => {
    await fs.unlink(filePath)
  })

  // List files in directory
  ipcMain.handle('listFiles', async (_event, dirPath: string) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
    } catch {
      return []
    }
  })

  // Delete directory recursively
  ipcMain.handle('deleteDirectory', async (_event, dirPath: string) => {
    await fs.rm(dirPath, { recursive: true, force: true })
  })

  // Check if path exists
  ipcMain.handle('pathExists', async (_event, filePath: string) => {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // Path join
  ipcMain.handle('pathJoin', async (_event, ...segments: string[]) => {
    return path.join(...segments)
  })

  // Open directory dialog
  ipcMain.handle('selectDirectory', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Save file dialog
  ipcMain.handle('saveFileDialog', async (_event, options: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: options.defaultPath,
      filters: options.filters || [{ name: '文本文件', extensions: ['txt'] }]
    })
    return result.canceled ? null : result.filePath
  })

  // DeepSeek Proxy: start
  ipcMain.handle('startDeepSeekProxy', async (_event, token: string) => {
    if (deepseekProxyProcess) {
      return { success: false, error: '代理已在运行中' }
    }

    // Update config.py with the token
    const configPath = path.join(getDeepSeekProxyDir(), 'src', 'deepseek_proxy', 'config.py')
    try {
      let configContent = await fs.readFile(configPath, 'utf-8')
      configContent = configContent.replace(
        /user_token\s*=\s*"[^"]*"/,
        `user_token="${token}"`
      )
      await fs.writeFile(configPath, configContent, 'utf-8')
    } catch (e: any) {
      return { success: false, error: '写入配置失败: ' + e.message }
    }

    // Spawn the proxy process
    try {
      deepseekProxyProcess = spawn('uv', ['run', 'deepseek-proxy'], {
        cwd: getDeepSeekProxyDir(),
        stdio: ['pipe', 'pipe', 'pipe']
      })

      deepseekProxyProcess.stdout?.on('data', (data) => {
        mainWindow?.webContents.send('deepseek-proxy-log', data.toString())
      })
      deepseekProxyProcess.stderr?.on('data', (data) => {
        mainWindow?.webContents.send('deepseek-proxy-log', data.toString())
      })
      deepseekProxyProcess.on('close', (code) => {
        mainWindow?.webContents.send('deepseek-proxy-log', `\n进程已退出 (code: ${code})\n`)
        deepseekProxyProcess = null
      })

      return { success: true, pid: deepseekProxyProcess.pid }
    } catch (e: any) {
      deepseekProxyProcess = null
      return { success: false, error: '启动失败: ' + e.message }
    }
  })

  // DeepSeek Proxy: stop
  ipcMain.handle('stopDeepSeekProxy', async () => {
    if (!deepseekProxyProcess) {
      return { success: false, error: '代理未在运行' }
    }
    deepseekProxyProcess.kill('SIGTERM')
    deepseekProxyProcess = null
    return { success: true }
  })

  // DeepSeek Proxy: status
  ipcMain.handle('getDeepSeekProxyStatus', () => {
    return {
      running: !!deepseekProxyProcess,
      pid: deepseekProxyProcess?.pid || null
    }
  })

  // DeepSeek Proxy: save config (token + model)
  ipcMain.handle('saveDeepSeekConfig', async (_event, config: { token: string; model: string }) => {
    const configPath = path.join(app.getPath('userData'), 'deepseek_config.json')
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
  })

  // DeepSeek Proxy: load config
  ipcMain.handle('loadDeepSeekConfig', async () => {
    const configPath = path.join(app.getPath('userData'), 'deepseek_config.json')
    try {
      const content = await fs.readFile(configPath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return { token: '', model: 'deepseek-v4-flash' }
    }
  })
}

// HTTP API server for browser dev access (same data as Electron IPC)
function startFileAPIServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

    if (req.method === 'POST' && req.url === '/api/fs') {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', async () => {
        try {
          const { action, args } = JSON.parse(body)
          let result: any
          switch (action) {
            case 'getNovelsDir': result = getNovelsDir(); break
            case 'ensureDirectory': await fs.mkdir(args[0], { recursive: true }); result = undefined; break
            case 'readFile': result = await fs.readFile(args[0], 'utf-8'); break
            case 'writeFile': await fs.mkdir(path.dirname(args[0]), { recursive: true }); await fs.writeFile(args[0], args[1], 'utf-8'); result = undefined; break
            case 'deleteFile': await fs.unlink(args[0]); result = undefined; break
            case 'listFiles': {
              const entries = await fs.readdir(args[0], { withFileTypes: true }).catch(() => [])
              result = entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
              break
            }
            case 'deleteDirectory': await fs.rm(args[0], { recursive: true, force: true }); result = undefined; break
            case 'pathExists': try { await fs.access(args[0]); result = true } catch { result = false }; break
            case 'pathJoin': result = path.join(...args); break
            case 'startDeepSeekProxy': {
              const token = args[0]
              if (deepseekProxyProcess) { result = { success: false, error: '代理已在运行中' }; break }
              const configPath2 = path.join(getDeepSeekProxyDir(), 'src', 'deepseek_proxy', 'config.py')
              let cfg = await fs.readFile(configPath2, 'utf-8')
              cfg = cfg.replace(/user_token\s*=\s*"[^"]*"/, `user_token="${token}"`)
              await fs.writeFile(configPath2, cfg, 'utf-8')
              deepseekProxyProcess = spawn('uv', ['run', 'deepseek-proxy'], { cwd: getDeepSeekProxyDir(), stdio: ['pipe', 'pipe', 'pipe'] })
              deepseekProxyProcess.on('close', () => { deepseekProxyProcess = null })
              result = { success: true, pid: deepseekProxyProcess.pid }
              break
            }
            case 'stopDeepSeekProxy': {
              if (!deepseekProxyProcess) { result = { success: false, error: '代理未在运行' }; break }
              deepseekProxyProcess.kill('SIGTERM')
              deepseekProxyProcess = null
              result = { success: true }
              break
            }
            case 'getDeepSeekProxyStatus': {
              result = { running: !!deepseekProxyProcess, pid: deepseekProxyProcess?.pid || null }
              break
            }
            case 'saveDeepSeekConfig': {
              const configPath = path.join(app.getPath('userData'), 'deepseek_config.json')
              await fs.writeFile(configPath, JSON.stringify(args[0], null, 2), 'utf-8')
              result = undefined
              break
            }
            case 'loadDeepSeekConfig': {
              const configPath = path.join(app.getPath('userData'), 'deepseek_config.json')
              try {
                const content = await fs.readFile(configPath, 'utf-8')
                result = JSON.parse(content)
              } catch { result = { token: '', model: 'deepseek-v4-flash' } }
              break
            }
            default: res.writeHead(400); res.end(JSON.stringify({ error: 'Unknown action' })); return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ result }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  server.listen(3456, () => console.log('[FileAPI] HTTP server on http://localhost:3456'))
}

app.whenReady().then(() => {
  registerIPC()
  if (isDev) startFileAPIServer()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
