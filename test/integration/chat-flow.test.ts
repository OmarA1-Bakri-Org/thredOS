import { describe, test, expect } from 'bun:test'
import { buildSystemPrompt } from '@/lib/chat/system-prompt'
import { ActionValidator } from '@/lib/chat/validator'
import type { Sequence } from '@/lib/sequence/schema'

/**
 * Integration test: chat flow from prompt → validate → dry-run
 */
describe('chat flow integration', () => {
  const sequence: Sequence = {
    version: '1.0',
    name: 'integration-test',
    steps: [
      {
        id: 'init',
        name: 'Init',
        type: 'base',
        model: 'claude-code',
        prompt_file: 'prompts/init.md',
        depends_on: [],
        status: 'DONE',
      },
    ],
    gates: [],
  }

  test('system prompt includes sequence context for chat', () => {
    const prompt = buildSystemPrompt(sequence)
    expect(prompt).toContain('integration-test')
    expect(prompt).toContain('init')
    expect(prompt).toContain('DONE')
    expect(prompt).toContain('ProposedAction')
    expect(prompt).toContain('until chat delegation exists')
  })

  test('validate + dryRun pipeline works end-to-end', async () => {
    // Create temp dir with sequence
    const { mkdir, rm } = await import('fs/promises')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const { writeSequence } = await import('@/lib/sequence/parser')

    const dir = join(tmpdir(), `chat-flow-${Date.now()}`)
    await mkdir(join(dir, '.threados'), { recursive: true })
    await writeSequence(dir, structuredClone(sequence))

    const validator = new ActionValidator(dir)

    // Validate
    const actions = [
      { command: 'step add', args: { id: 'build', name: 'Build', type: 'base', model: 'claude-code', prompt_file: 'prompts/build.md' } },
    ]
    const validation = await validator.validate(actions)
    expect(validation.valid).toBe(true)

    // Dry run
    const dryRun = await validator.dryRun(actions)
    expect(dryRun.valid).toBe(true)
    expect(dryRun.diff).toContain('build')

    // Apply
    const applied = await validator.apply(actions)
    expect(applied.success).toBe(true)

    await rm(dir, { recursive: true, force: true })
  })

  test('chat API route structure exists', async () => {
    // Verify the module exports correctly
    const mod = await import('@/app/api/chat/route')
    expect(mod.POST).toBeDefined()
    expect(typeof mod.POST).toBe('function')
  })

  test('runtime controls are rejected across validate and dryRun', async () => {
    const { mkdir, rm } = await import('fs/promises')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const { writeSequence } = await import('@/lib/sequence/parser')

    const dir = join(tmpdir(), `chat-flow-runtime-${Date.now()}`)
    await mkdir(join(dir, '.threados'), { recursive: true })
    await writeSequence(dir, structuredClone(sequence))

    const validator = new ActionValidator(dir)
    const actions = [{ command: 'run', args: {} }]

    const validation = await validator.validate(actions)
    expect(validation).toEqual({
      valid: false,
      errors: [
        'Command "run" is not available in chat/apply. Use ThreadOSRuntimeService through the canonical workbench or CLI until chat delegation exists.',
      ],
    })

    const dryRun = await validator.dryRun(actions)
    expect(dryRun.valid).toBe(false)
    expect(dryRun.diff).toBe('')
    expect(dryRun.errors).toEqual(validation.errors)

    await rm(dir, { recursive: true, force: true })
  })
})
