import { NextResponse } from 'next/server'
import { z } from 'zod'
import { join } from 'path'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { getBasePath } from '@/lib/config'
import { handleError, auditLog } from '@/lib/api-helpers'
import { writeFileAtomic } from '@/lib/fs/atomic'
import {
  generateBase,
  generateParallel,
  generateChained,
  generateFusion,
  generateOrchestrated,
  generateLongAutonomy,
} from '@/lib/templates'
import type { Sequence, Step, Gate } from '@/lib/sequence/schema'
import { updateThreadSurfaceState, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { materializeBulkStepSurfaces, clearAllSurfaces } from '@/lib/thread-surfaces/materializer'

const ResetSchema = z.object({ action: z.literal('reset'), name: z.string().optional() })
const RenameSchema = z.object({ action: z.literal('rename'), name: z.string().min(1).max(100) })
const SetTypeSchema = z.object({ action: z.literal('set-type'), thread_type: z.enum(['base', 'p', 'c', 'f', 'b', 'l']) })
const ApplyTemplateSchema = z.object({
  action: z.literal('apply-template'),
  type: z.enum(['base', 'p', 'c', 'f', 'b', 'l']),
  name: z.string().min(1).max(100),
})
const BodySchema = z.union([ResetSchema, RenameSchema, SetTypeSchema, ApplyTemplateSchema])

export async function GET() {
  try {
    const sequence = await readSequence(getBasePath())
    return NextResponse.json(sequence)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json())
    const bp = getBasePath()

    if (body.action === 'reset') {
      const newSeq: Sequence = {
        version: '1.0',
        name: body.name || 'New Sequence',
        steps: [],
        gates: [],
      }
      await writeSequence(bp, newSeq)
      await writeThreadSurfaceState(bp, clearAllSurfaces())
      await auditLog('sequence.reset', body.name || 'New Sequence')
      return NextResponse.json({ success: true, action: 'reset', name: newSeq.name })
    }

    if (body.action === 'rename') {
      const seq = await readSequence(bp)
      seq.name = body.name
      await writeSequence(bp, seq)
      await auditLog('sequence.rename', body.name)
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'set-type') {
      const seq = await readSequence(bp)
      seq.thread_type = body.thread_type
      await writeSequence(bp, seq)
      await auditLog('sequence.set-type', body.thread_type)
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'apply-template') {
      // Map UI thread type codes to template generators
      const templateMap: Record<string, () => { steps: Step[]; gates: Gate[] }> = {
        base: () => ({ steps: generateBase(), gates: [] }),
        p: () => ({ steps: generateParallel(), gates: [] }),
        c: () => {
          const result = generateChained()
          return { steps: result.steps, gates: result.gates }
        },
        f: () => ({ steps: generateFusion(), gates: [] }),
        b: () => ({ steps: generateOrchestrated(), gates: [] }),
        l: () => ({ steps: generateLongAutonomy(), gates: [] }),
      }

      const generator = templateMap[body.type]
      if (!generator) {
        return NextResponse.json({ error: `Unknown template type: ${body.type}` }, { status: 400 })
      }

      const { steps: newSteps, gates: newGates } = generator()

      const newSeq: Sequence = {
        version: '1.0',
        name: body.name,
        thread_type: body.type,
        steps: newSteps,
        gates: newGates,
      }

      await writeSequence(bp, newSeq)

      // Create placeholder prompt files for each step that references one
      const promptWrites = newSteps
        .filter(s => s.prompt_file)
        .map(s => {
          const promptPath = join(bp, s.prompt_file)
          const content = `# ${s.name}\n\nDescribe the task for this phase.\n`
          return writeFileAtomic(promptPath, content)
        })
      await Promise.all(promptWrites)

      await updateThreadSurfaceState(bp, s =>
        materializeBulkStepSurfaces(s, newSteps.map(st => ({ id: st.id, name: st.name })), body.name, new Date().toISOString())
      )

      await auditLog('sequence.apply-template', `${body.type} → ${body.name}`)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return handleError(err)
  }
}
