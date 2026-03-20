const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron')
const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')

const HOST = process.env.THREDOS_DESKTOP_HOST || '127.0.0.1'
const PORT = process.env.THREDOS_DESKTOP_PORT || '3010'
const SHOULD_SPAWN_SERVER = process.env.THREDOS_DESKTOP_SPAWN_SERVER !== 'false'
const START_PATH = '/app'

let serverProcess = null
let pendingActivationUrl = null
let mainWindow = null

function resolveBasePath() {
  if (process.env.THREDOS_BASE_PATH) return process.env.THREDOS_BASE_PATH
  if (process.env.THREADOS_BASE_PATH) return process.env.THREADOS_BASE_PATH

  const documentsPath = app.getPath('documents')
  return path.join(documentsPath, 'thredOS')
}

function ensureBasePath(basePath) {
  fs.mkdirSync(basePath, { recursive: true })
  return basePath
}

function getStartUrl() {
  return process.env.THREDOS_DESKTOP_URL || `http://${HOST}:${PORT}${START_PATH}`
}

function waitForServer(url, timeoutMs = 60000) {
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume()
        resolve()
      })

      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for thredOS Desktop server at ${url}`))
          return
        }
        setTimeout(attempt, 1000)
      })
    }

    attempt()
  })
}

function spawnWebServer() {
  const isDev = !app.isPackaged
  const basePath = ensureBasePath(resolveBasePath())
  const appRoot = path.resolve(__dirname, '..')
  const nextBin = path.join(appRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
  const sharedEnv = {
    ...process.env,
    THREDOS_BASE_PATH: basePath,
    THREADOS_BASE_PATH: basePath,
    THREDOS_DESKTOP: 'true',
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
  }

  const command = isDev ? 'bun' : process.execPath
  const commandArgs = isDev
    ? ['run', 'dev', '--', '--hostname', HOST, '--port', PORT]
    : [nextBin, 'start', '--hostname', HOST, '--port', PORT]

  serverProcess = spawn(command, commandArgs, {
    cwd: appRoot,
    stdio: 'inherit',
    env: isDev ? sharedEnv : { ...sharedEnv, ELECTRON_RUN_AS_NODE: '1' },
  })
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1200,
    minHeight: 800,
    title: 'thredOS Desktop',
    backgroundColor: '#060a12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('did-finish-load', () => {
    if (pendingActivationUrl) {
      window.webContents.send('thredos:activation-url', pendingActivationUrl)
    }
  })

  window.loadURL(getStartUrl())
  return window
}

function dispatchActivationUrl(url) {
  pendingActivationUrl = url
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('thredos:activation-url', url)
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  }
}

function showStartupError(error) {
  dialog.showErrorBox(
    'thredOS Desktop failed to start',
    error instanceof Error ? error.message : String(error),
  )
}

ipcMain.handle('thredos:get-pending-activation-url', () => pendingActivationUrl)
ipcMain.handle('thredos:consume-pending-activation-url', () => {
  const url = pendingActivationUrl
  pendingActivationUrl = null
  return url
})

const singleInstanceLock = app.requestSingleInstanceLock()
if (!singleInstanceLock) {
  app.quit()
}

app.on('second-instance', (_event, argv) => {
  const deepLink = argv.find(value => value.startsWith('thredos://'))
  if (deepLink) {
    dispatchActivationUrl(deepLink)
  }
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  dispatchActivationUrl(url)
})

app.whenReady().then(async () => {
  app.setAsDefaultProtocolClient('thredos')

  if (SHOULD_SPAWN_SERVER) {
    spawnWebServer()
    await waitForServer(getStartUrl())
  }

  mainWindow = createMainWindow()
}).catch((error) => {
  showStartupError(error)
  app.quit()
})

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill()
  }
})

process.on('SIGINT', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill()
  }
  process.exit(0)
})

module.exports = {
  getPendingActivationUrl: () => pendingActivationUrl,
}
