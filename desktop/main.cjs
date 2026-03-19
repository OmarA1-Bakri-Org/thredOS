const { app, BrowserWindow, shell } = require('electron')
const { spawn } = require('child_process')
const http = require('http')
const path = require('path')

const HOST = process.env.THREDOS_DESKTOP_HOST || '127.0.0.1'
const PORT = process.env.THREDOS_DESKTOP_PORT || '3010'
const BASE_PATH = process.env.THREDOS_BASE_PATH || process.cwd()
const START_URL = process.env.THREDOS_DESKTOP_URL || `http://${HOST}:${PORT}/app`
const SHOULD_SPAWN_SERVER = process.env.THREDOS_DESKTOP_SPAWN_SERVER !== 'false'

let serverProcess = null
let pendingActivationUrl = null

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
  const commandArgs = isDev
    ? ['run', 'dev', '--', '--hostname', HOST, '--port', PORT]
    : ['run', 'start', '--', '--hostname', HOST, '--port', PORT]

  serverProcess = spawn('bun', commandArgs, {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      THREDOS_BASE_PATH: BASE_PATH,
      THREADOS_BASE_PATH: BASE_PATH,
      THREDOS_DESKTOP: 'true',
      SystemRoot: process.env.SystemRoot || 'C:\\Windows',
    },
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

  window.loadURL(START_URL)
}

app.on('second-instance', (_event, argv) => {
  const deepLink = argv.find((value) => value.startsWith('thredos://'))
  if (deepLink) {
    pendingActivationUrl = deepLink
  }
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  pendingActivationUrl = url
})

app.whenReady().then(async () => {
  if (SHOULD_SPAWN_SERVER) {
    spawnWebServer()
    await waitForServer(START_URL)
  }

  createMainWindow()
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
