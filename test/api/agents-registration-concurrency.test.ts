import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { AsyncLocalStorage } from 'async_hooks'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { POST } from '@/app/api/agents/route'
import { getAgentStatePath, readAgentState, updateAgentState } from '@/lib/agents/repository'
import { setAtomicBoundaryHookForTests, setAtomicBeforeRenameHookForTests, withExclusiveFileLock } from '@/lib/fs/atomic'
import { setSafeIoAfterOpenHookForTests } from '@/lib/security/safe-io'

function registrationBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-a',
    name: 'Agent A',
    builderId: 'builder-1',
    builderName: 'Builder',
    model: 'codex',
    role: 'reviewer',
    tools: ['files'],
    promptRef: { id: 'review', version: 1, path: '.threados/prompts/review.md' },
    ...overrides,
  }
}

function register(body: ReturnType<typeof registrationBody>) {
  return POST(new Request('http://localhost/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function withinDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for registration boundary')), 5_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe.serial('canonical agent registration transactions', () => {
  let basePath: string
  let previousBasePath: string | undefined

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-agent-transactions-'))
    previousBasePath = process.env.THREADOS_BASE_PATH
    process.env.THREADOS_BASE_PATH = basePath
  })

  afterEach(async () => {
    setAtomicBoundaryHookForTests(null)
    setAtomicBeforeRenameHookForTests(null)
    setSafeIoAfterOpenHookForTests(null)
    if (previousBasePath === undefined) delete process.env.THREADOS_BASE_PATH
    else process.env.THREADOS_BASE_PATH = previousBasePath
    await rm(basePath, { recursive: true, force: true })
  })

  for (const requestedId of ['agent-a', 'agent-a-v2']) {
    test(`concurrent material edits requesting ${requestedId} keep distinct identities and lineage`, async () => {
      expect((await register(registrationBody())).status).toBe(201)
      const lockPath = `${getAgentStatePath(basePath)}.lock`
      const held = deferred()
      const release = deferred()
      const bothWaiting = deferred()
      const requestContext = new AsyncLocalStorage<number>()
      const waitingRequests = new Set<number>()
      const holder = withExclusiveFileLock(lockPath, async () => {
        held.resolve()
        await release.promise
      }, { allowedRoot: basePath })
      await held.promise
      setAtomicBoundaryHookForTests(context => {
        const requestId = requestContext.getStore()
        if (context.stage === 'before-lock-open' && context.targetPath === lockPath && requestId !== undefined) {
          waitingRequests.add(requestId)
          if (waitingRequests.size === 2) bothWaiting.resolve()
        }
      })
      const edits = ['builder', 'researcher']
      const pending = edits.map((role, index) => requestContext.run(index, () => register(registrationBody({
        id: requestedId,
        supersedesAgentId: 'agent-a',
        role,
      }))))
      try {
        await withinDeadline(bothWaiting.promise)
      } finally {
        release.resolve()
        await holder
        await Promise.allSettled(pending)
      }
      const responses = await Promise.all(pending)
      expect(responses.map(response => response.status)).toEqual([201, 201])
      const payloads = await Promise.all(responses.map(response => response.json()))
      expect(payloads.map(payload => payload.agent.id).sort()).toEqual(['agent-a-v2', 'agent-a-v3'])
      for (const [index, payload] of payloads.entries()) {
        expect(payload).toMatchObject({
          materialChange: true,
          replacementOf: 'agent-a',
          agent: { role: edits[index], version: 2, supersedesAgentId: 'agent-a' },
        })
      }
      const persisted = await readAgentState(basePath)
      expect(persisted.agents).toHaveLength(3)
      expect(persisted.agents.find(agent => agent.id === 'agent-a')?.role).toBe('reviewer')
      for (const payload of payloads) {
        expect(persisted.agents.find(agent => agent.id === payload.agent.id)?.composition).toEqual(payload.agent.composition)
      }
    })
  }

  test('a new registration still requires a prompt', async () => {
    const response = await register(registrationBody({ promptRef: null }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect((await readAgentState(basePath)).agents).toEqual([])
  })

  test('real concurrent first registrations initialize one catalog and preserve both agents', async () => {
    const responses = await Promise.all(['agent-a', 'agent-b'].map(id => register(registrationBody({ id }))))
    expect(responses.map(response => response.status)).toEqual([201, 201])
    expect((await readAgentState(basePath)).agents.map(agent => agent.id).sort()).toEqual(['agent-a', 'agent-b'])
  })

  test('real concurrent asset synchronization completes without replacing an open catalog read', async () => {
    expect((await register(registrationBody())).status).toBe(201)
    const requestContext = new AsyncLocalStorage<string>()
    const catalogReadOpened = deferred()
    const releaseCatalogRead = deferred()
    const secondWaitingForAssets = deferred()
    let firstCommitted = false
    let catalogReadHeld = false
    setAtomicBeforeRenameHookForTests(targetPath => {
      if (requestContext.getStore() === 'first' && targetPath === getAgentStatePath(basePath)) {
        firstCommitted = true
      }
    })
    setSafeIoAfterOpenHookForTests(async ({ operation, filePath }) => {
      if (requestContext.getStore() === 'first' && firstCommitted && !catalogReadHeld
        && operation === 'read' && filePath === join(basePath, '.threados/library.yaml')) {
        catalogReadHeld = true
        catalogReadOpened.resolve()
        await releaseCatalogRead.promise
      }
    })
    setAtomicBoundaryHookForTests(context => {
      if (requestContext.getStore() === 'second' && context.stage === 'before-lock-open'
        && context.targetPath === join(basePath, '.threados/state/agent-assets.lock')) {
        secondWaitingForAssets.resolve()
      }
    })
    const first = requestContext.run('first', () => register(registrationBody({ role: 'builder' })))
    let second: ReturnType<typeof register> | undefined
    try {
      await withinDeadline(catalogReadOpened.promise)
      second = requestContext.run('second', () => register(registrationBody({ role: 'researcher' })))
      // A protected second synchronization waits at its asset lock. Without
      // protection it finishes and replaces the first request's open catalog.
      await withinDeadline(Promise.race([secondWaitingForAssets.promise, second.then(() => undefined)]))
    } finally {
      releaseCatalogRead.resolve()
      await Promise.allSettled(second ? [first, second] : [first])
    }
    if (!second) throw new Error('Second registration did not start')
    expect((await first).status).toBe(201)
    expect((await second).status).toBe(201)
    expect(catalogReadHeld).toBe(true)
    expect((await readAgentState(basePath)).agents.map(agent => agent.id).sort()).toEqual([
      'agent-a', 'agent-a-v2', 'agent-a-v3',
    ])
  })

  for (const sideEffect of ['cloud', 'asset']) {
    test(`${sideEffect} synchronization does not hold the canonical registry lock`, async () => {
      const sideEffectWriteReached = deferred()
      const releaseSideEffectWrite = deferred()
      const sideEffectPath = sideEffect === 'cloud'
        ? join(basePath, '.threados/state/cloud-agent-registry.json')
        : join(basePath, '.threados/agents/agent-a/AGENT.md')
      setAtomicBeforeRenameHookForTests(async targetPath => {
        if (targetPath === sideEffectPath) {
          sideEffectWriteReached.resolve()
          await releaseSideEffectWrite.promise
        }
      })
      const pending = register(registrationBody())
      try {
        await withinDeadline(sideEffectWriteReached.promise)
        await withinDeadline(updateAgentState(basePath, state => ({
          ...state,
          agents: state.agents.map(agent => ({ ...agent, description: 'Updated while side effect waits' })),
        })))
      } finally {
        releaseSideEffectWrite.resolve()
        await Promise.allSettled([pending])
      }
      expect((await pending).status).toBe(201)
      expect((await readAgentState(basePath)).agents[0].description).toBe('Updated while side effect waits')
    })
  }
})
