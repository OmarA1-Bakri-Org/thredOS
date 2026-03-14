import { parseArgs } from 'util'
import { readSequence, writeSequence } from '../../sequence/parser'
import { validateDAG } from '../../sequence/dag'
import { GateNotFoundError } from '../../errors'
import type { Gate } from '../../sequence/schema'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
}

export async function gateCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()

  let result: { success: boolean; action: string; message?: string; error?: string; gates?: Gate[] }

  switch (subcommand) {
    case 'insert': {
      const gateId = args[0]
      if (!gateId) {
        result = { success: false, action: 'insert', error: 'Usage: seqctl gate insert <gateId> --name <name> --depends-on <stepIds...>' }
        break
      }
      const { values } = parseArgs({
        args: args.slice(1),
        options: {
          name: { type: 'string', short: 'n' },
          'depends-on': { type: 'string', short: 'd' },
        },
        allowPositionals: true,
        strict: false,
      })

      const sequence = await readSequence(basePath)
      if (sequence.gates.some(g => g.id === gateId)) {
        result = { success: false, action: 'insert', error: `Gate '${gateId}' already exists` }
        break
      }

      const gate: Gate = {
        id: gateId,
        name: (values.name as string) || gateId,
        depends_on: values['depends-on'] ? (values['depends-on'] as string).split(',').map(s => s.trim()) : [],
        status: 'PENDING',
        cascade: false,
        childGateIds: [],
      }

      sequence.gates.push(gate)
      try {
        validateDAG(sequence)
      } catch (error) {
        result = { success: false, action: 'insert', error: error instanceof Error ? error.message : 'DAG validation failed' }
        break
      }
      await writeSequence(basePath, sequence)
      result = { success: true, action: 'insert', message: `Gate '${gateId}' inserted` }
      break
    }

    case 'approve': {
      const gateId = args[0]
      if (!gateId) { result = { success: false, action: 'approve', error: 'Gate ID required' }; break }
      const sequence = await readSequence(basePath)
      const gate = sequence.gates.find(g => g.id === gateId)
      if (!gate) { result = { success: false, action: 'approve', error: new GateNotFoundError(gateId).message }; break }
      gate.status = 'APPROVED'
      await writeSequence(basePath, sequence)
      result = { success: true, action: 'approve', message: `Gate '${gateId}' approved` }
      break
    }

    case 'block': {
      const gateId = args[0]
      if (!gateId) { result = { success: false, action: 'block', error: 'Gate ID required' }; break }
      const sequence = await readSequence(basePath)
      const gate = sequence.gates.find(g => g.id === gateId)
      if (!gate) { result = { success: false, action: 'block', error: new GateNotFoundError(gateId).message }; break }
      gate.status = 'BLOCKED'
      await writeSequence(basePath, sequence)
      result = { success: true, action: 'block', message: `Gate '${gateId}' blocked` }
      break
    }

    case 'list': {
      const sequence = await readSequence(basePath)
      if (options.json) {
        console.log(JSON.stringify({ success: true, action: 'list', gates: sequence.gates }))
        return
      }
      if (sequence.gates.length === 0) {
        console.log('No gates found')
      } else {
        for (const g of sequence.gates) {
          console.log(`${g.id} [${g.status}] "${g.name}" depends_on: [${g.depends_on.join(', ')}]`)
        }
      }
      return
    }

    default:
      result = { success: false, action: subcommand || 'unknown', error: 'Unknown subcommand. Usage: seqctl gate insert|approve|block|list' }
  }

  if (options.json) {
    console.log(JSON.stringify(result!))
  } else {
    if (result!.success) {
      console.log(result!.message)
    } else {
      console.error(`Error: ${result!.error}`)
      process.exit(1)
    }
  }
}
