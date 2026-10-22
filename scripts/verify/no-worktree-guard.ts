import { readdir, readFile } from 'fs/promises'
import { extname, join, relative, sep } from 'path'

const PRODUCTION_ROOTS = ['app', 'lib', 'desktop', 'scripts'] as const
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const EXECUTOR_PATTERN = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|execa|execaCommand)\s*\(|\bBun\.spawn(?:Sync)?\s*\(|\bnew\s+Deno\.Command\s*\(/g
const STRING_LITERAL_PATTERN = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g

export interface NoWorktreeViolation {
  file: string
  line: number
  pattern: 'git-worktree' | 'worktree-add-remove'
}

export interface NoWorktreeReport {
  schema_version: 1
  passed: boolean
  roots: readonly string[]
  files_scanned: string[]
  violations: NoWorktreeViolation[]
}

function isProductionSource(path: string): boolean {
  const portable = path.split(sep).join('/')
  if (!SOURCE_EXTENSIONS.has(extname(path))) return false
  if (/(^|\/)(?:node_modules|\.next|test-results|dist-desktop)(\/|$)/.test(portable)) return false
  // Verification fixtures may exercise Git itself; they are not runtime paths.
  if (/(^|\/)scripts\/verify\//.test(portable)) return false
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(portable)) return false
  return true
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) {
        await visit(child)
      } else if (entry.isFile() && isProductionSource(child)) {
        files.push(child)
      }
    }
  }
  await visit(root)
  return files.sort((left, right) => left.localeCompare(right))
}

function stripComments(source: string): string {
  let result = ''
  let index = 0
  let quote: '"' | "'" | '`' | null = null
  while (index < source.length) {
    const current = source.charAt(index)
    const next = source.charAt(index + 1)
    if (quote) {
      result += current
      if (current === '\\') {
        result += next
        index += 2
        continue
      }
      if (current === quote) quote = null
      index += 1
      continue
    }
    if (current === '"' || current === "'" || current === '`') {
      quote = current
      result += current
      index += 1
      continue
    }
    if (current === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        result += ' '
        index += 1
      }
      continue
    }
    if (current === '/' && next === '*') {
      result += '  '
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        result += source[index] === '\n' ? '\n' : ' '
        index += 1
      }
      if (index < source.length) {
        result += '  '
        index += 2
      }
      continue
    }
    result += current
    index += 1
  }
  return result
}

function callEnd(source: string, openParen: number): number {
  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  for (let index = openParen; index < source.length; index += 1) {
    const current = source.charAt(index)
    if (quote) {
      if (current === '\\') {
        index += 1
        continue
      }
      if (current === quote) quote = null
      continue
    }
    if (current === '"' || current === "'" || current === '`') {
      quote = current
      continue
    }
    if (current === '(') depth += 1
    if (current === ')') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return Math.min(source.length, openParen + 2_000)
}

function stringLiterals(source: string): string[] {
  return [...source.matchAll(STRING_LITERAL_PATTERN)].map(match => (match[2] ?? '')
    .replace(/\\(['"`\\])/g, '$1')
    .toLocaleLowerCase('en-US'))
}

function forbiddenPattern(values: readonly string[]): NoWorktreeViolation['pattern'] | null {
  const joined = values.join(' ')
  const tokens = new Set(values.flatMap(value => value.split(/[^a-z0-9_.-]+/).filter(Boolean)))
  const hasGit = tokens.has('git') || tokens.has('git.exe') || /\bgit(?:\.exe)?\s+worktree\b/.test(joined)
  const hasWorktree = tokens.has('worktree') || /\bworktree\b/.test(joined)
  if (hasGit && hasWorktree) return 'git-worktree'
  if (hasWorktree && (tokens.has('add') || tokens.has('remove') || /\bworktree\s+(?:add|remove)\b/.test(joined))) {
    return 'worktree-add-remove'
  }
  return null
}

function scanSource(file: string, source: string): NoWorktreeViolation[] {
  const uncommented = stripComments(source)
  const fileValues = stringLiterals(uncommented)
  const violations: NoWorktreeViolation[] = []
  for (const match of uncommented.matchAll(EXECUTOR_PATTERN)) {
    const start = match.index ?? 0
    const openParen = uncommented.indexOf('(', start)
    if (openParen < 0) continue
    const expression = uncommented.slice(start, callEnd(uncommented, openParen))
    const directPattern = forbiddenPattern(stringLiterals(expression))
    const indirectPattern = directPattern ?? forbiddenPattern(fileValues)
    if (!indirectPattern) continue
    violations.push({
      file,
      line: uncommented.slice(0, start).split('\n').length,
      pattern: indirectPattern,
    })
  }
  return violations
}

export async function scanNoGitWorktreeRuntime(repositoryRoot: string): Promise<NoWorktreeReport> {
  const absoluteFiles = (await Promise.all(PRODUCTION_ROOTS.map(root => collectSourceFiles(join(repositoryRoot, root)))))
    .flat()
  const files = absoluteFiles.map(file => relative(repositoryRoot, file).split(sep).join('/'))
  const violations = (await Promise.all(absoluteFiles.map(async file =>
    scanSource(relative(repositoryRoot, file).split(sep).join('/'), await readFile(file, 'utf8')),
  ))).flat()
  return {
    schema_version: 1,
    passed: violations.length === 0,
    roots: PRODUCTION_ROOTS,
    files_scanned: files,
    violations,
  }
}
