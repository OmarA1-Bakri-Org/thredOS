import { execFile } from 'child_process'
import { join } from 'path'
import YAML from 'yaml'
import { MprocsConnectionError } from '../errors'

export type MprocsCommand =
  | { c: 'quit' }
  | { c: 'start-proc' }
  | { c: 'term-proc' }
  | { c: 'kill-proc' }
  | { c: 'restart-proc' }
  | { c: 'select-proc'; index: number }
  | { c: 'send-key'; key: string }
  | { c: 'add-proc'; name: string; cmd: string[] }
  | { c: 'remove-proc'; id: string }
  | { c: 'batch'; ops: MprocsCommand[] }

export interface MprocsResult {
  success: boolean
  exitCode: number
  stderr?: string
}

function resolveMprocsPath(): string {
  return process.env.THREDOS_MPROCS_PATH
    || process.env.THREADOS_MPROCS_PATH
    || join(process.cwd(), 'vendor/mprocs/windows/mprocs.exe')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class MprocsClient {
  private serverAddress: string
  private mprocsPath: string

  constructor(
    serverAddress = '127.0.0.1:4050',
    mprocsPath = resolveMprocsPath(),
  ) {
    this.serverAddress = serverAddress
    this.mprocsPath = mprocsPath
  }

  protected async executeCommand(args: string[]): Promise<MprocsResult> {
    return await new Promise((resolve, reject) => {
      execFile(this.mprocsPath, args, {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      }, (error, _stdout, stderr) => {
        if (!error) {
          resolve({ success: true, exitCode: 0, stderr: stderr || undefined })
          return
        }

        const exitCode = typeof error.code === 'number' ? error.code : -1
        const message = stderr || error.message

        if (typeof error.code === 'string' && exitCode === -1) {
          resolve({ success: false, exitCode, stderr: message })
          return
        }

        if (exitCode >= 0) {
          resolve({ success: false, exitCode, stderr: message })
          return
        }

        reject(error)
      })
    })
  }

  async sendCommand(command: MprocsCommand): Promise<MprocsResult> {
    const payload =
      command.c === 'batch' && 'ops' in command
        ? { ...command, cmds: command.ops }
        : command

    const yaml = YAML.stringify(payload).trim()
    return await this.executeCommand(['--ctl', yaml, '--server', this.serverAddress])
  }

  async startProcess(index?: number): Promise<MprocsResult> {
    if (index !== undefined) {
      return this.sendCommand({
        c: 'batch',
        ops: [
          { c: 'select-proc', index },
          { c: 'start-proc' },
        ],
      })
    }
    return this.sendCommand({ c: 'start-proc' })
  }

  async stopProcess(index?: number): Promise<MprocsResult> {
    if (index !== undefined) {
      return this.sendCommand({
        c: 'batch',
        ops: [
          { c: 'select-proc', index },
          { c: 'term-proc' },
        ],
      })
    }
    return this.sendCommand({ c: 'term-proc' })
  }

  async restartProcess(index?: number): Promise<MprocsResult> {
    if (index !== undefined) {
      return this.sendCommand({
        c: 'batch',
        ops: [
          { c: 'select-proc', index },
          { c: 'restart-proc' },
        ],
      })
    }
    return this.sendCommand({ c: 'restart-proc' })
  }

  async addProcess(name: string, cmd: string[]): Promise<MprocsResult> {
    return this.sendCommand({ c: 'add-proc', name, cmd })
  }

  async batch(commands: MprocsCommand[]): Promise<MprocsResult> {
    return this.sendCommand({ c: 'batch', ops: commands })
  }

  async isServerRunning(): Promise<boolean> {
    try {
      const result = await this.sendCommand({ c: 'select-proc', index: 0 })
      return result.success
    } catch {
      return false
    }
  }

  async waitForServer(timeoutMs = 5000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.isServerRunning()) {
        return true
      }
      await sleep(100)
    }
    throw new MprocsConnectionError(this.serverAddress)
  }
}
