import { readdir } from 'fs/promises'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { commandIdempotencyLockPath, commandRecordPath, ensureCommandsRoot } from './paths'
import { RuntimeRepositoryError } from './run-repository'
import { RuntimeCommandReceiptSchema, type RuntimeCommandReceipt } from './schema'
import { idempotencyDigest, rebuildRuntimeIndex } from './runtime-index'

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readReceipt(path: string): Promise<RuntimeCommandReceipt> {
  return RuntimeCommandReceiptSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
}

export class CommandRepository {
  constructor(private readonly basePath: string) {}

  private async listReceipts(): Promise<RuntimeCommandReceipt[]> {
    const root = await ensureCommandsRoot(this.basePath)
    const receipts: RuntimeCommandReceipt[] = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const path = await resolveExistingPathWithinRoot(root, entry.name)
      receipts.push(await readReceipt(path))
    }
    return receipts
  }

  async createOrReplay(value: RuntimeCommandReceipt): Promise<RuntimeCommandReceipt> {
    const receipt = RuntimeCommandReceiptSchema.parse(value)
    assertSafePathSegment(receipt.id, 'command id')
    const digest = idempotencyDigest(receipt.idempotency_key)
    const lockPath = await commandIdempotencyLockPath(this.basePath, digest)
    const result = await withExclusiveFileLock(lockPath, async () => {
      const replay = (await this.listReceipts()).find(item => item.idempotency_key === receipt.idempotency_key)
      if (replay) {
        if (replay.request_hash !== receipt.request_hash) {
          throw new RuntimeRepositoryError(
            'IDEMPOTENCY_CONFLICT',
            'idempotency key was already used for a different request payload',
          )
        }
        return replay
      }

      const path = await commandRecordPath(this.basePath, receipt.id)
      await withExclusiveFileLock(`${path}.lock`, async () => {
        try {
          await readTextFileNoFollow(path)
          throw new RuntimeRepositoryError('RUNTIME_RECORD_EXISTS', `command ${receipt.id} already exists`)
        } catch (error) {
          if (!isMissing(error)) throw error
        }
        await writeFileAtomic(path, `${JSON.stringify(receipt, null, 2)}\n`)
      })
      return receipt
    })
    await rebuildRuntimeIndex(this.basePath)
    return result
  }

  async get(commandId: string): Promise<RuntimeCommandReceipt | null> {
    assertSafePathSegment(commandId, 'command id')
    const path = await commandRecordPath(this.basePath, commandId)
    try {
      const receipt = await readReceipt(path)
      if (receipt.id !== commandId) throw new Error('command record identity does not match its path')
      return receipt
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async findByIdempotencyKey(key: string): Promise<RuntimeCommandReceipt | null> {
    return (await this.listReceipts()).find(receipt => receipt.idempotency_key === key) ?? null
  }
}
