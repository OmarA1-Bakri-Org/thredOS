#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = join(root, 'output', 'graphify')
const toolRoot = join(output, 'tool')
const toolBin = join(toolRoot, process.platform === 'win32' ? 'Scripts' : 'bin')
const python = join(toolBin, process.platform === 'win32' ? 'python.exe' : 'python')
const graphify = join(toolBin, process.platform === 'win32' ? 'graphify.exe' : 'graphify')
const constraints = join(root, 'scripts', 'dev', 'graphify-constraints.txt')
const defaultGraph = join(output, 'graphify-out', 'graph.json')
const coveragePrefixes = ['lib/agents/', 'lib/runner/', 'lib/runtime/']

// Ignore uv index/config overrides so setup has exactly one declared source.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
  !/^UV_/i.test(key) && !['PYTHONPATH', 'PYTHONHOME'].includes(key.toUpperCase())
)))
env.UV_CACHE_DIR = join(output, 'uv-cache')
env.UV_PYTHON_DOWNLOADS = 'never'
env.GRAPHIFY_NO_AUTO_REFRESH = '1'

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.signal || result.status !== 0) {
    throw new Error(`${basename(command)} failed (${result.signal ?? result.status ?? 'unknown exit'})`)
  }
}

function takeOption(args, name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  args.splice(index, 2)
  return resolve(value)
}

function canonicalName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

function requirements() {
  const content = readFileSync(constraints, 'utf8')
  const pins = new Map()
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue
    const match = /^([A-Za-z0-9_.-]+)==([0-9][A-Za-z0-9_.-]*)$/.exec(line)
    if (!match || pins.has(canonicalName(match[1]))) throw new Error(`Invalid or duplicate pinned requirement: ${line}`)
    pins.set(canonicalName(match[1]), match[2])
  }
  if (pins.size !== 30 || pins.get('graphifyy') !== '0.9.93') throw new Error('Expected Graphify 0.9.93 and all 30 pinned requirements')
  return { content, pins }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function verifiedWheelRequirements(wheelhouse, pinned) {
  const expectedDigest = /^# official-provenance-sha256: ([a-f0-9]{64})$/m.exec(pinned.content)?.[1]
  const manifestBytes = readFileSync(join(wheelhouse, 'official-provenance.json'))
  if (!expectedDigest || sha256(manifestBytes) !== expectedDigest) throw new Error('Offline wheelhouse provenance manifest digest does not match the project pin')
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (manifest.source !== 'https://pypi.org' || manifest.allMatched !== true
    || !Array.isArray(manifest.files) || manifest.files.length !== pinned.pins.size) {
    throw new Error('Offline wheelhouse must contain the complete verified official PyPI manifest')
  }
  const seen = new Set()
  const filenames = new Set()
  const lines = manifest.files.map(file => {
    const name = canonicalName(file.name)
    if (seen.has(name) || pinned.pins.get(name) !== file.version || file.officialDigestMatches !== true
      || typeof file.filename !== 'string' || basename(file.filename) !== file.filename || !file.filename.endsWith('.whl')
      || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Offline wheelhouse entry does not match the pinned package set')
    const path = join(wheelhouse, file.filename)
    if (!lstatSync(path).isFile() || sha256(readFileSync(path)) !== file.sha256) {
      throw new Error(`Offline wheel checksum mismatch: ${file.filename}`)
    }
    seen.add(name)
    filenames.add(file.filename)
    return `${name}==${file.version} --hash=sha256:${file.sha256}`
  })
  if (readdirSync(wheelhouse).some(name => name.endsWith('.whl') && !filenames.has(name))) {
    throw new Error('Offline wheelhouse contains an unverified wheel')
  }
  return `${lines.join('\n')}\n`
}

function verifyInstallation(pinned) {
  if (!existsSync(python) || !existsSync(graphify)) throw new Error('Run node scripts/dev/graphify.mjs setup first')
  run(python, ['-I', '-c', [
    'import importlib.metadata, json, sys',
    'pins = json.loads(sys.argv[1])',
    'mismatches = [name for name, version in pins.items() if importlib.metadata.version(name) != version]',
    'if mismatches: raise SystemExit("Installed package versions differ from project pins: " + ", ".join(mismatches))',
  ].join('\n'), JSON.stringify(Object.fromEntries(pinned.pins))])
}

function setup(wheelhouse) {
  const pinned = requirements()
  // Verify all offline inputs before creating an environment or invoking uv.
  const verified = wheelhouse ? verifiedWheelRequirements(wheelhouse, pinned) : null
  mkdirSync(output, { recursive: true })
  if (!existsSync(join(toolRoot, 'pyvenv.cfg'))) {
    run('uv', ['--no-config', '--no-python-downloads', 'venv', '--python', '3.12', toolRoot])
  }
  let requirementPath = constraints
  const sourceArgs = wheelhouse
    ? ['--offline', '--no-index', '--find-links', wheelhouse, '--require-hashes']
    : ['--index-url', 'https://pypi.org/simple']
  if (verified) {
    requirementPath = join(output, 'verified-wheel-requirements.txt')
    writeFileSync(requirementPath, verified)
  }
  run('uv', ['--no-config', '--no-python-downloads', 'pip', 'sync', '--python', python, '--no-build', ...sourceArgs, requirementPath])
  verifyInstallation(pinned)
  run(graphify, ['--version'])
  console.log(`Graphify setup complete: ${wheelhouse ? '30 verified offline wheels' : '30 pinned requirements from official PyPI wheels'}`)
}

function verifyGraph(graphPath) {
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'))
  const nodes = graph?.nodes
  const edges = graph?.links ?? graph?.edges
  if (!Array.isArray(nodes) || !nodes.length || !Array.isArray(edges) || !edges.length) {
    throw new Error('Graphify graph must contain nonempty nodes and edges')
  }
  const coverage = Object.fromEntries(coveragePrefixes.map(prefix => [prefix, nodes.filter(node => (
    typeof node?.source_file === 'string' && node.source_file.replaceAll('\\', '/').replace(/^\.\//, '').startsWith(prefix)
  )).length]))
  for (const [prefix, count] of Object.entries(coverage)) {
    if (!count) throw new Error(`Graphify graph is missing source coverage for ${prefix}`)
  }
  console.log(JSON.stringify({ graph: graphPath, nodes: nodes.length, edges: edges.length, coverage }, null, 2))
}

function main() {
  const [command = 'help', ...args] = process.argv.slice(2)
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`Usage: node scripts/dev/graphify.mjs <command>
  setup [--wheelhouse PATH]    Install all pinned wheels in output/graphify/tool
  analyze                     Extract local code only, using two workers; verify output
  verify [--graph PATH]       Check nonempty graph and agents/runner/runtime coverage
  query QUESTION [OPTIONS]   Query the local graph (Graphify query options)
  explain NODE [--all]       Explain a node in the local graph
Graph: output/graphify/graphify-out/graph.json
Requires Node.js 22+, uv, and an available Python 3.12 for setup.`)
    return
  }
  if (command === 'setup') {
    const wheelhouse = takeOption(args, '--wheelhouse')
    if (args.length) throw new Error(`Unexpected setup argument: ${args[0]}`)
    setup(wheelhouse)
    return
  }
  const graphPath = takeOption(args, '--graph') ?? defaultGraph
  if (command === 'verify') {
    if (args.length) throw new Error(`Unexpected verify argument: ${args[0]}`)
    verifyGraph(graphPath)
    return
  }
  if (command !== 'analyze' && command !== 'query' && command !== 'explain') throw new Error(`Unknown command: ${command}`)
  verifyInstallation(requirements())
  if (command === 'analyze') {
    if (args.length || graphPath !== defaultGraph) throw new Error('analyze uses the fixed project output and takes no arguments')
    run(graphify, ['extract', '.', '--code-only', '--out', 'output/graphify', '--max-workers', '2', '--timing'])
    verifyGraph(defaultGraph)
    return
  }
  if (!args.length) throw new Error(`${command} requires a ${command === 'query' ? 'question' : 'node'}`)
  run(graphify, [command, ...args, '--graph', graphPath])
}

try {
  main()
} catch (error) {
  console.error(`[graphify] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
