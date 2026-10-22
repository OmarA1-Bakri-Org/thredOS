import type { Dirent } from 'fs'
import { readdir as nodeReaddir, readFile as nodeReadFile } from 'fs/promises'
import { extname, join } from 'path'
import ts from 'typescript'

export const RUNTIME_LIFECYCLE_INTERFACE_ROOTS = [
  'app/api',
  'lib/seqctl/commands',
  'lib/chat',
] as const

export type RuntimeLifecycleInterfaceKind =
  | 'api-delegate'
  | 'cli-delegate'
  | 'chat-runtime-controls-rejected'

export type RuntimeLifecycleInterfacePolicy =
  | 'delegate-to-runtime-service'
  | 'reject-runtime-controls'

export type RuntimeLifecycleSignal =
  | 'api-runtime-service'
  | 'api-runtime-service-reference'
  | 'cli-runtime-service'
  | 'cli-runtime-service-reference'
  | 'chat-action-validator'
  | 'chat-runtime-control-guard'
  | 'chat-runtime-control-definition'

export type RuntimeLifecycleViolationCategory =
  | 'forbidden-import'
  | 'forbidden-lifecycle-call'

export type RuntimeLifecycleViolationScope =
  | 'global'
  | 'delegate-only'

export interface RuntimeLifecycleTraversalError {
  path: string
  code: string
}

export interface RuntimeLifecycleInterfaceClassification {
  file: string
  kind: RuntimeLifecycleInterfaceKind
  policy: RuntimeLifecycleInterfacePolicy
  requiredSignals?: readonly RuntimeLifecycleSignal[]
}

export interface RuntimeLifecycleViolationMatch {
  category: RuntimeLifecycleViolationCategory
  pattern: string
  scope: RuntimeLifecycleViolationScope
}

export interface RuntimeLifecycleFileRecord {
  file: string
  source: string
  signals: RuntimeLifecycleSignal[]
  candidatePatterns: string[]
  globalViolations: RuntimeLifecycleViolationMatch[]
  delegateViolations: RuntimeLifecycleViolationMatch[]
}

export interface RuntimeLifecycleFileSystem {
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>
  readFile(path: string, encoding: 'utf8'): Promise<string>
}

interface RuntimeLifecycleRecordLoadResult {
  records: RuntimeLifecycleFileRecord[]
  traversalErrors: RuntimeLifecycleTraversalError[]
}

interface RuntimeLifecycleFileDiscoveryResult {
  files: string[]
  traversalErrors: RuntimeLifecycleTraversalError[]
}

type ImportMatcher = RegExp | ((moduleSpecifier: string) => boolean)

interface ModuleReference {
  kind: 'static-import' | 'import-equals' | 'require' | 'dynamic-import'
  moduleSpecifier: string
}

interface ModuleSpecifierMatch {
  moduleSpecifier: string
  exact: boolean
}

type BindingKind =
  | 'static-default'
  | 'static-named'
  | 'static-namespace'
  | 'import-equals'
  | 'require-named'
  | 'require-namespace'
  | 'dynamic-named'
  | 'dynamic-namespace'

interface ImportBinding {
  kind: BindingKind
  localName: string
  moduleSpecifier: string
  importedName?: string
  isStatic: boolean
  isModuleObject: boolean
}

interface ScopeDeclaration {
  kind: 'import' | 'local'
  binding?: ImportBinding
}

interface ScopeState {
  node: ts.Node
  parent?: ScopeState
  declarations: Map<string, ScopeDeclaration>
}

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:ts|tsx)$/
const GENERATED_PATH_PATTERN = /(?:^|\/)(?:__generated__|generated)(?:\/|$)|\.generated\.(?:ts|tsx)$/

const API_RUNTIME_REQUEST_MODULE: ImportMatcher = /(?:^|\/)runtime-request$/
const CLI_RUNTIME_MODULE: ImportMatcher = /^\.{1,2}\/runtime$|(?:^|\/)seqctl\/runtime$/
const CHAT_VALIDATOR_MODULE: ImportMatcher = /(?:^|\/)chat\/validator$/
const CHAT_COMMANDS_MODULE: ImportMatcher = /^\.{1,2}\/commands$|(?:^|\/)chat\/commands$/
const THREAD_SURFACE_REPOSITORY_MODULE: ImportMatcher = /(?:^|\/)thread-surfaces\/repository$/

const DIRECT_RUNTIME_FORBIDDEN_IMPORTS: ReadonlyArray<{ matcher: ImportMatcher; pattern: string }> = [
  {
    matcher: /(?:^|\/)runner\/(?:wrapper|dispatch|artifacts|prompt-compiler|process-handle)$/,
    pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runner\\/(?:wrapper|dispatch|artifacts|prompt-compiler|process-handle)',
  },
  {
    matcher: /(?:^|\/)runtime\/(?:attempt-executor|process-controller|lifecycle|scheduler|factory|run-repository|attempt-repository|process-repository)$/,
    pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runtime\\/(?:attempt-executor|process-controller|lifecycle|scheduler|factory|(?:run|attempt|process)-repository)',
  },
  {
    matcher: /(?:^|\/)reconciliation(?:\/.*)?$/,
    pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?reconciliation\\/',
  },
] as const

const DELEGATE_FORBIDDEN_IMPORTS: ReadonlyArray<{ matcher: ImportMatcher; pattern: string }> = [
  {
    matcher: /(?:^|\/)gates\/(?:engine|rules)$/,
    pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?gates\\/(?:engine|rules)',
  },
  {
    matcher: /(?:^|\/)approvals\/(?:binding|runtime|repository)$/,
    pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?approvals\\/(?:binding|runtime|repository)',
  },
  {
    matcher: /(?:^|\/)thread-surfaces\/(?:mutations|step-run-runtime|materializer)$/,
    pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?thread-surfaces\\/(?:mutations|step-run-runtime|materializer)',
  },
] as const

const DIRECT_RUNTIME_FORBIDDEN_CALLS = [
  {
    importedName: 'transitionRun',
    matcher: /(?:^|\/)runtime\/lifecycle$/,
    pattern: '\\b(?:transitionRun|transitionAttempt|transitionProcess)\\s*\\(',
  },
  {
    importedName: 'transitionAttempt',
    matcher: /(?:^|\/)runtime\/lifecycle$/,
    pattern: '\\b(?:transitionRun|transitionAttempt|transitionProcess)\\s*\\(',
  },
  {
    importedName: 'transitionProcess',
    matcher: /(?:^|\/)runtime\/lifecycle$/,
    pattern: '\\b(?:transitionRun|transitionAttempt|transitionProcess)\\s*\\(',
  },
  {
    importedName: 'startProcess',
    matcher: /(?:^|\/)runner\/wrapper$/,
    pattern: '\\b(?:startProcess|runStep|executeStep|executeSingleStep)\\s*\\(',
  },
  {
    importedName: 'runStep',
    matcher: /(?:^|\/)(?:runner\/wrapper|runtime\/attempt-executor)$/,
    pattern: '\\b(?:startProcess|runStep|executeStep|executeSingleStep)\\s*\\(',
  },
  {
    importedName: 'executeStep',
    matcher: /(?:^|\/)runtime\/attempt-executor$/,
    pattern: '\\b(?:startProcess|runStep|executeStep|executeSingleStep)\\s*\\(',
  },
  {
    importedName: 'executeSingleStep',
    matcher: /(?:^|\/)runtime\/attempt-executor$/,
    pattern: '\\b(?:startProcess|runStep|executeStep|executeSingleStep)\\s*\\(',
  },
] as const

const DIRECT_RUNTIME_FORBIDDEN_CTORS = [
  {
    importedName: 'RunRepository',
    matcher: /(?:^|\/)runtime\/run-repository$/,
    pattern: '\\bnew\\s+(?:RunRepository|AttemptRepository|ProcessRepository|SequentialScheduler)\\b',
  },
  {
    importedName: 'AttemptRepository',
    matcher: /(?:^|\/)runtime\/attempt-repository$/,
    pattern: '\\bnew\\s+(?:RunRepository|AttemptRepository|ProcessRepository|SequentialScheduler)\\b',
  },
  {
    importedName: 'ProcessRepository',
    matcher: /(?:^|\/)runtime\/process-repository$/,
    pattern: '\\bnew\\s+(?:RunRepository|AttemptRepository|ProcessRepository|SequentialScheduler)\\b',
  },
  {
    importedName: 'SequentialScheduler',
    matcher: /(?:^|\/)runtime\/scheduler$/,
    pattern: '\\bnew\\s+(?:RunRepository|AttemptRepository|ProcessRepository|SequentialScheduler)\\b',
  },
] as const

const THREAD_SURFACE_REPOSITORY_CALLS = [
  { importedName: 'writeThreadSurfaceState', pattern: 'writeThreadSurfaceState' },
  { importedName: 'updateThreadSurfaceState', pattern: 'updateThreadSurfaceState' },
] as const

const DEFAULT_FILESYSTEM: RuntimeLifecycleFileSystem = {
  readdir: nodeReaddir,
  readFile: nodeReadFile,
}

export const RUNTIME_LIFECYCLE_INTERFACE_CLASSIFICATIONS: readonly RuntimeLifecycleInterfaceClassification[] = [
  { file: 'app/api/run/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/stop/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/restart/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/status/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/runs/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/runs/[runId]/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/runs/[runId]/attempts/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/runs/[runId]/cancel/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/attempts/[attemptId]/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/attempts/[attemptId]/cancel/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/attempts/[attemptId]/retry/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/thread-runs/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/workspaces/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/workspaces/doctor/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/workspaces/[workspaceId]/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/workspaces/[workspaceId]/retain/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'app/api/workspaces/[workspaceId]/clean/route.ts', kind: 'api-delegate', policy: 'delegate-to-runtime-service' },
  {
    file: 'app/api/apply/route.ts',
    kind: 'chat-runtime-controls-rejected',
    policy: 'reject-runtime-controls',
    requiredSignals: ['chat-action-validator'],
  },
  {
    file: 'app/api/chat/route.ts',
    kind: 'chat-runtime-controls-rejected',
    policy: 'reject-runtime-controls',
    requiredSignals: ['chat-action-validator'],
  },
  { file: 'lib/seqctl/commands/run.ts', kind: 'cli-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'lib/seqctl/commands/control.ts', kind: 'cli-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'lib/seqctl/commands/status.ts', kind: 'cli-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'lib/seqctl/commands/attempt.ts', kind: 'cli-delegate', policy: 'delegate-to-runtime-service' },
  { file: 'lib/seqctl/commands/workspace.ts', kind: 'cli-delegate', policy: 'delegate-to-runtime-service' },
  {
    file: 'lib/chat/commands.ts',
    kind: 'chat-runtime-controls-rejected',
    policy: 'reject-runtime-controls',
    requiredSignals: ['chat-runtime-control-definition'],
  },
  {
    file: 'lib/chat/validator.ts',
    kind: 'chat-runtime-controls-rejected',
    policy: 'reject-runtime-controls',
    requiredSignals: ['chat-runtime-control-guard'],
  },
] as const

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/')
}

function normalizeErrorCode(error: unknown): string {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    && error.code.length > 0
  ) {
    return error.code
  }
  return 'UNKNOWN_ERROR'
}

function isProductionInterfaceFile(relativePath: string): boolean {
  const normalized = normalizePath(relativePath)
  const extension = extname(normalized)
  if (extension !== '.ts' && extension !== '.tsx') return false
  if (normalized.endsWith('.d.ts')) return false
  if (TEST_FILE_PATTERN.test(normalized)) return false
  if (GENERATED_PATH_PATTERN.test(normalized)) return false
  return true
}

function parseSourceFile(relativePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function visitNodes(node: ts.Node, visitor: (current: ts.Node) => void): void {
  visitor(node)
  node.forEachChild(child => visitNodes(child, visitor))
}

function moduleMatches(moduleSpecifier: string, matcher: ImportMatcher): boolean {
  if (matcher instanceof RegExp) return matcher.test(moduleSpecifier)
  return matcher(moduleSpecifier)
}

function extractStaticModuleSpecifier(
  argument: ts.Expression | undefined,
): ModuleSpecifierMatch | null {
  if (!argument) return null
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return {
      moduleSpecifier: normalizePath(argument.text),
      exact: true,
    }
  }
  if (ts.isTemplateExpression(argument)) {
    const moduleSpecifier = normalizePath(
      argument.head.text + argument.templateSpans.map(span => span.literal.text).join(''),
    )
    return moduleSpecifier.length > 0
      ? {
          moduleSpecifier,
          exact: false,
        }
      : null
  }
  return null
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (ts.isAwaitExpression(expression)) {
    return unwrapExpression(expression.expression)
  }
  if (ts.isParenthesizedExpression(expression)) {
    return unwrapExpression(expression.expression)
  }
  if (ts.isAsExpression(expression)) {
    return unwrapExpression(expression.expression)
  }
  if (ts.isSatisfiesExpression(expression)) {
    return unwrapExpression(expression.expression)
  }
  if (ts.isNonNullExpression(expression)) {
    return unwrapExpression(expression.expression)
  }
  if (ts.isTypeAssertionExpression(expression)) {
    return unwrapExpression(expression.expression)
  }
  return expression
}

function extractModuleLoad(
  expression: ts.Expression | undefined,
): { moduleSpecifier: string; kind: 'require' | 'dynamic-import' } | null {
  if (!expression) return null
  const candidate = unwrapExpression(expression)
  if (!ts.isCallExpression(candidate)) return null
  const moduleSpecifier = extractStaticModuleSpecifier(candidate.arguments[0])
  if (!moduleSpecifier?.exact) return null
  if (ts.isIdentifier(candidate.expression) && candidate.expression.text === 'require') {
    return { moduleSpecifier: moduleSpecifier.moduleSpecifier, kind: 'require' }
  }
  if (candidate.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return { moduleSpecifier: moduleSpecifier.moduleSpecifier, kind: 'dynamic-import' }
  }
  return null
}

function collectModuleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
  const moduleReferences = new Map<string, ModuleReference>()

  function remember(reference: ModuleReference): void {
    moduleReferences.set(`${reference.kind}:${reference.moduleSpecifier}`, reference)
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      remember({
        kind: 'static-import',
        moduleSpecifier: normalizePath(statement.moduleSpecifier.text),
      })
      continue
    }

    if (
      ts.isImportEqualsDeclaration(statement)
      && ts.isExternalModuleReference(statement.moduleReference)
      && ts.isStringLiteral(statement.moduleReference.expression)
    ) {
      remember({
        kind: 'import-equals',
        moduleSpecifier: normalizePath(statement.moduleReference.expression.text),
      })
    }
  }

  visitNodes(sourceFile, node => {
    if (!ts.isCallExpression(node)) return
    const argument = extractStaticModuleSpecifier(node.arguments[0])
    if (!argument) return
    const moduleSpecifier = argument.moduleSpecifier
    let kind: ModuleReference['kind'] | null = null
    if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      kind = 'require'
    } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      kind = 'dynamic-import'
    }
    if (!kind) return
    remember({
      kind,
      moduleSpecifier,
    })
  })

  return [...moduleReferences.values()]
}

function flattenBindingName(
  name: ts.BindingName,
): Array<{ localName: string; importedName?: string }> {
  if (ts.isIdentifier(name)) return [{ localName: name.text }]
  if (ts.isObjectBindingPattern(name)) {
    return name.elements.flatMap(element => {
      const importedName = element.propertyName
        ? ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)
          ? element.propertyName.text
          : undefined
        : ts.isIdentifier(element.name)
          ? element.name.text
          : undefined
      return flattenBindingName(element.name).map(binding => ({
        localName: binding.localName,
        importedName: binding.importedName ?? importedName,
      }))
    })
  }
  if (ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap(element =>
      ts.isBindingElement(element)
        ? flattenBindingName(element.name)
        : [])
  }
  return []
}

function collectImportBindings(sourceFile: ts.SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = []

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
      const moduleSpecifier = normalizePath(statement.moduleSpecifier.text)
      const clause = statement.importClause
      if (!clause) continue
      if (clause.name) {
        bindings.push({
          kind: 'static-default',
          localName: clause.name.text,
          importedName: 'default',
          moduleSpecifier,
          isStatic: true,
          isModuleObject: true,
        })
      }
      const namedBindings = clause.namedBindings
      if (!namedBindings) continue
      if (ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          bindings.push({
            kind: 'static-named',
            localName: element.name.text,
            importedName: element.propertyName?.text ?? element.name.text,
            moduleSpecifier,
            isStatic: true,
            isModuleObject: false,
          })
        }
        continue
      }
      if (ts.isNamespaceImport(namedBindings)) {
        bindings.push({
          kind: 'static-namespace',
          localName: namedBindings.name.text,
          moduleSpecifier,
          isStatic: true,
          isModuleObject: true,
        })
      }
      continue
    }

    if (ts.isImportEqualsDeclaration(statement)) {
      if (
        ts.isExternalModuleReference(statement.moduleReference)
        && ts.isStringLiteral(statement.moduleReference.expression)
      ) {
        bindings.push({
          kind: 'import-equals',
          localName: statement.name.text,
          moduleSpecifier: normalizePath(statement.moduleReference.expression.text),
          isStatic: false,
          isModuleObject: true,
        })
      }
      continue
    }

    visitNodes(statement, node => {
      if (!ts.isVariableDeclaration(node)) return
      const moduleLoad = extractModuleLoad(node.initializer)
      if (!moduleLoad) return
      if (ts.isIdentifier(node.name)) {
        bindings.push({
          kind: moduleLoad.kind === 'require' ? 'require-namespace' : 'dynamic-namespace',
          localName: node.name.text,
          moduleSpecifier: moduleLoad.moduleSpecifier,
          isStatic: false,
          isModuleObject: true,
        })
        return
      }
      for (const binding of flattenBindingName(node.name)) {
        bindings.push({
          kind: moduleLoad.kind === 'require' ? 'require-named' : 'dynamic-named',
          localName: binding.localName,
          importedName: binding.importedName,
          moduleSpecifier: moduleLoad.moduleSpecifier,
          isStatic: false,
          isModuleObject: false,
        })
      }
    })
  }

  return bindings
}

function createScopeState(node: ts.Node, parent?: ScopeState): ScopeState {
  return {
    node,
    parent,
    declarations: new Map<string, ScopeDeclaration>(),
  }
}

function isScopeNode(
  node: ts.Node,
): node is ts.SourceFile | ts.Block | ts.CatchClause | ts.FunctionLikeDeclaration {
  return ts.isSourceFile(node)
    || ts.isBlock(node)
    || ts.isCatchClause(node)
    || ts.isFunctionLike(node)
}

function buildScopeMap(sourceFile: ts.SourceFile): Map<ts.Node, ScopeState> {
  const scopeMap = new Map<ts.Node, ScopeState>()
  const root = createScopeState(sourceFile)
  scopeMap.set(sourceFile, root)

  function visit(node: ts.Node, currentScope: ScopeState): void {
    let nextScope = currentScope
    if (node !== sourceFile && isScopeNode(node)) {
      nextScope = createScopeState(node, currentScope)
      scopeMap.set(node, nextScope)
    }
    node.forEachChild(child => visit(child, nextScope))
  }

  visit(sourceFile, root)
  return scopeMap
}

function addDeclaration(
  scope: ScopeState,
  name: string,
  declaration: ScopeDeclaration,
): void {
  const existing = scope.declarations.get(name)
  if (declaration.kind === 'local' || !existing) {
    scope.declarations.set(name, declaration)
  }
}

function nearestFunctionOrSourceScope(scope: ScopeState): ScopeState {
  let current: ScopeState | undefined = scope
  while (current && !ts.isSourceFile(current.node) && !ts.isFunctionLike(current.node)) {
    current = current.parent
  }
  return current ?? scope
}

function declarationTargetScope(
  currentScope: ScopeState,
  declaration: ts.VariableDeclaration,
): ScopeState {
  const declarationList = declaration.parent
  if (
    ts.isVariableDeclarationList(declarationList)
    && (declarationList.flags & ts.NodeFlags.BlockScoped) === 0
  ) {
    return nearestFunctionOrSourceScope(currentScope)
  }
  return currentScope
}

function collectDeclarations(
  sourceFile: ts.SourceFile,
  bindings: readonly ImportBinding[],
): Map<ts.Node, ScopeState> {
  const scopeMap = buildScopeMap(sourceFile)
  const rootScope = scopeMap.get(sourceFile)!

  for (const binding of bindings) {
    if (binding.kind === 'require-named' || binding.kind === 'require-namespace' || binding.kind === 'dynamic-named' || binding.kind === 'dynamic-namespace') {
      continue
    }
    addDeclaration(rootScope, binding.localName, { kind: 'import', binding })
  }

  function findImportBindingForVariableDeclaration(
    declaration: ts.VariableDeclaration,
  ): Map<string, ImportBinding> {
    const moduleLoad = extractModuleLoad(declaration.initializer)
    if (!moduleLoad) return new Map<string, ImportBinding>()
    const byLocalName = new Map<string, ImportBinding>()
    for (const binding of bindings) {
      if (binding.moduleSpecifier !== moduleLoad.moduleSpecifier) continue
      if (
        moduleLoad.kind === 'require'
        && binding.kind !== 'require-named'
        && binding.kind !== 'require-namespace'
      ) {
        continue
      }
      if (
        moduleLoad.kind === 'dynamic-import'
        && binding.kind !== 'dynamic-named'
        && binding.kind !== 'dynamic-namespace'
      ) {
        continue
      }
      byLocalName.set(binding.localName, binding)
    }
    return byLocalName
  }

  function visit(node: ts.Node, currentScope: ScopeState): void {
    let nextScope = currentScope

    if (ts.isFunctionDeclaration(node) && node.name) {
      addDeclaration(currentScope, node.name.text, { kind: 'local' })
    }
    if (ts.isClassDeclaration(node) && node.name) {
      addDeclaration(currentScope, node.name.text, { kind: 'local' })
    }
    if (ts.isVariableDeclaration(node)) {
      const targetScope = declarationTargetScope(currentScope, node)
      const importBindingsByLocalName = findImportBindingForVariableDeclaration(node)
      for (const bindingName of flattenBindingName(node.name)) {
        const importBinding = importBindingsByLocalName.get(bindingName.localName)
        addDeclaration(
          targetScope,
          bindingName.localName,
          importBinding ? { kind: 'import', binding: importBinding } : { kind: 'local' },
        )
      }
    }

    if (node !== sourceFile && isScopeNode(node)) {
      nextScope = scopeMap.get(node)!
      if (ts.isFunctionLike(node)) {
        if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
          addDeclaration(nextScope, node.name.text, { kind: 'local' })
        }
        for (const parameter of node.parameters) {
          for (const binding of flattenBindingName(parameter.name)) {
            addDeclaration(nextScope, binding.localName, { kind: 'local' })
          }
        }
      }
      if (ts.isCatchClause(node) && node.variableDeclaration) {
        for (const binding of flattenBindingName(node.variableDeclaration.name)) {
          addDeclaration(nextScope, binding.localName, { kind: 'local' })
        }
      }
    }

    node.forEachChild(child => visit(child, nextScope))
  }

  visit(sourceFile, rootScope)
  return scopeMap
}

function resolveDeclaration(
  scope: ScopeState | undefined,
  name: string,
): ScopeDeclaration | undefined {
  let current = scope
  while (current) {
    const declaration = current.declarations.get(name)
    if (declaration) return declaration
    current = current.parent
  }
  return undefined
}

function withScopeTraversal<T>(
  sourceFile: ts.SourceFile,
  scopeMap: Map<ts.Node, ScopeState>,
  visitor: (node: ts.Node, scope: ScopeState) => T | undefined,
): T | undefined {
  const rootScope = scopeMap.get(sourceFile)!

  function walk(node: ts.Node, currentScope: ScopeState): T | undefined {
    const nextScope = node === sourceFile
      ? currentScope
      : (isScopeNode(node) ? scopeMap.get(node)! : currentScope)
    const result = visitor(node, nextScope)
    if (result !== undefined) return result
    let childResult: T | undefined
    node.forEachChild(child => {
      if (childResult !== undefined) return
      childResult = walk(child, nextScope)
    })
    return childResult
  }

  return walk(sourceFile, rootScope)
}

function hasIdentifierCallMatching(
  sourceFile: ts.SourceFile,
  scopeMap: Map<ts.Node, ScopeState>,
  predicate: (binding: ImportBinding) => boolean,
): boolean {
  return withScopeTraversal(sourceFile, scopeMap, (node, scope) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined
    const declaration = resolveDeclaration(scope, node.expression.text)
    return declaration?.kind === 'import' && declaration.binding && predicate(declaration.binding)
      ? true
      : undefined
  }) === true
}

function hasPropertyCallMatching(
  sourceFile: ts.SourceFile,
  scopeMap: Map<ts.Node, ScopeState>,
  propertyName: string,
  predicate: (binding: ImportBinding) => boolean,
): boolean {
  return withScopeTraversal(sourceFile, scopeMap, (node, scope) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined
    const receiver = node.expression.expression
    if (!ts.isIdentifier(receiver) || node.expression.name.text !== propertyName) return undefined
    const declaration = resolveDeclaration(scope, receiver.text)
    return declaration?.kind === 'import' && declaration.binding && predicate(declaration.binding)
      ? true
      : undefined
  }) === true
}

function hasModuleLoadPropertyCallMatching(
  sourceFile: ts.SourceFile,
  propertyName: string,
  predicate: (moduleSpecifier: string, kind: ModuleReference['kind']) => boolean,
): boolean {
  let matched = false
  visitNodes(sourceFile, node => {
    if (matched || !ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return
    if (node.expression.name.text !== propertyName) return
    const moduleLoad = extractModuleLoad(node.expression.expression)
    if (!moduleLoad) return
    if (predicate(moduleLoad.moduleSpecifier, moduleLoad.kind)) {
      matched = true
    }
  })
  return matched
}

function hasIdentifierConstructionMatching(
  sourceFile: ts.SourceFile,
  scopeMap: Map<ts.Node, ScopeState>,
  predicate: (binding: ImportBinding) => boolean,
): boolean {
  return withScopeTraversal(sourceFile, scopeMap, (node, scope) => {
    if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression)) return undefined
    const declaration = resolveDeclaration(scope, node.expression.text)
    return declaration?.kind === 'import' && declaration.binding && predicate(declaration.binding)
      ? true
      : undefined
  }) === true
}

function hasPropertyConstructionMatching(
  sourceFile: ts.SourceFile,
  scopeMap: Map<ts.Node, ScopeState>,
  propertyName: string,
  predicate: (binding: ImportBinding) => boolean,
): boolean {
  return withScopeTraversal(sourceFile, scopeMap, (node, scope) => {
    if (!ts.isNewExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined
    const receiver = node.expression.expression
    if (!ts.isIdentifier(receiver) || node.expression.name.text !== propertyName) return undefined
    const declaration = resolveDeclaration(scope, receiver.text)
    return declaration?.kind === 'import' && declaration.binding && predicate(declaration.binding)
      ? true
      : undefined
  }) === true
}

function hasModuleLoadPropertyConstructionMatching(
  sourceFile: ts.SourceFile,
  propertyName: string,
  predicate: (moduleSpecifier: string, kind: ModuleReference['kind']) => boolean,
): boolean {
  let matched = false
  visitNodes(sourceFile, node => {
    if (matched || !ts.isNewExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return
    if (node.expression.name.text !== propertyName) return
    const moduleLoad = extractModuleLoad(node.expression.expression)
    if (!moduleLoad) return
    if (predicate(moduleLoad.moduleSpecifier, moduleLoad.kind)) {
      matched = true
    }
  })
  return matched
}

function hasVariableDeclaration(sourceFile: ts.SourceFile, name: string): boolean {
  let found = false
  visitNodes(sourceFile, node => {
    if (found || !ts.isVariableDeclaration(node)) return
    if (flattenBindingName(node.name).some(binding => binding.localName === name)) {
      found = true
    }
  })
  return found
}

function hasFunctionDeclaration(sourceFile: ts.SourceFile, name: string): boolean {
  let found = false
  visitNodes(sourceFile, node => {
    if (found || !ts.isFunctionDeclaration(node) || !node.name) return
    if (node.name.text === name) {
      found = true
    }
  })
  return found
}

function matchesLifecycleDelegateSignal(signals: readonly RuntimeLifecycleSignal[]): boolean {
  return signals.includes('api-runtime-service') || signals.includes('cli-runtime-service')
}

function isStaticNamedImport(
  binding: ImportBinding,
  matcher: ImportMatcher,
  importedName: string,
): boolean {
  return binding.kind === 'static-named'
    && binding.importedName === importedName
    && moduleMatches(binding.moduleSpecifier, matcher)
}

function isStaticNamespaceImport(
  binding: ImportBinding,
  matcher: ImportMatcher,
): boolean {
  return binding.kind === 'static-namespace'
    && moduleMatches(binding.moduleSpecifier, matcher)
}

function moduleBindingMatches(binding: ImportBinding, matcher: ImportMatcher): boolean {
  return moduleMatches(binding.moduleSpecifier, matcher)
}

function matchSignalSet(
  relativePath: string,
  sourceFile: ts.SourceFile,
  scopeMap: Map<ts.Node, ScopeState>,
  moduleReferences: readonly ModuleReference[],
): RuntimeLifecycleSignal[] {
  const signals = new Set<RuntimeLifecycleSignal>()

  if (moduleReferences.some(reference => moduleMatches(reference.moduleSpecifier, API_RUNTIME_REQUEST_MODULE))) {
    signals.add('api-runtime-service-reference')
  }

  if (moduleReferences.some(reference => moduleMatches(reference.moduleSpecifier, CLI_RUNTIME_MODULE))) {
    signals.add('cli-runtime-service-reference')
  }

  if (
    hasIdentifierCallMatching(
      sourceFile,
      scopeMap,
      binding => isStaticNamedImport(binding, API_RUNTIME_REQUEST_MODULE, 'getApiRuntimeService'),
    )
    || hasPropertyCallMatching(
      sourceFile,
      scopeMap,
      'getApiRuntimeService',
      binding => isStaticNamespaceImport(binding, API_RUNTIME_REQUEST_MODULE),
    )
  ) {
    signals.add('api-runtime-service')
  }

  if (
    hasIdentifierCallMatching(
      sourceFile,
      scopeMap,
      binding => isStaticNamedImport(binding, CLI_RUNTIME_MODULE, 'getCLIRuntimeService'),
    )
    || hasPropertyCallMatching(
      sourceFile,
      scopeMap,
      'getCLIRuntimeService',
      binding => isStaticNamespaceImport(binding, CLI_RUNTIME_MODULE),
    )
  ) {
    signals.add('cli-runtime-service')
  }

  if (
    relativePath === 'app/api/apply/route.ts'
    || relativePath === 'app/api/chat/route.ts'
  ) {
    if (
      hasIdentifierConstructionMatching(
        sourceFile,
        scopeMap,
        binding => isStaticNamedImport(binding, CHAT_VALIDATOR_MODULE, 'ActionValidator'),
      )
      || hasPropertyConstructionMatching(
        sourceFile,
        scopeMap,
        'ActionValidator',
        binding => isStaticNamespaceImport(binding, CHAT_VALIDATOR_MODULE),
      )
    ) {
      signals.add('chat-action-validator')
    }
  }

  if (relativePath === 'lib/chat/validator.ts') {
    const guardUsed = hasIdentifierCallMatching(
      sourceFile,
      scopeMap,
      binding => isStaticNamedImport(binding, CHAT_COMMANDS_MODULE, 'isChatRuntimeControlCommand'),
    ) || hasPropertyCallMatching(
      sourceFile,
      scopeMap,
      'isChatRuntimeControlCommand',
      binding => isStaticNamespaceImport(binding, CHAT_COMMANDS_MODULE),
    )

    const rejectionUsed = hasIdentifierCallMatching(
      sourceFile,
      scopeMap,
      binding => isStaticNamedImport(binding, CHAT_COMMANDS_MODULE, 'buildRuntimeControlRejection'),
    ) || hasPropertyCallMatching(
      sourceFile,
      scopeMap,
      'buildRuntimeControlRejection',
      binding => isStaticNamespaceImport(binding, CHAT_COMMANDS_MODULE),
    )

    if (guardUsed && rejectionUsed) {
      signals.add('chat-runtime-control-guard')
    }
  }

  if (
    relativePath === 'lib/chat/commands.ts'
    && hasVariableDeclaration(sourceFile, 'CHAT_RUNTIME_CONTROL_COMMANDS')
    && hasFunctionDeclaration(sourceFile, 'isChatRuntimeControlCommand')
    && hasFunctionDeclaration(sourceFile, 'buildRuntimeControlRejection')
  ) {
    signals.add('chat-runtime-control-definition')
  }

  return [...signals].sort()
}

function matchImportViolations(
  moduleReferences: readonly ModuleReference[],
  patterns: ReadonlyArray<{ matcher: ImportMatcher; pattern: string }>,
  scope: RuntimeLifecycleViolationScope,
): RuntimeLifecycleViolationMatch[] {
  const violations = new Map<string, RuntimeLifecycleViolationMatch>()

  for (const reference of moduleReferences) {
    for (const candidate of patterns) {
      if (!moduleMatches(reference.moduleSpecifier, candidate.matcher)) continue
      violations.set(`${candidate.pattern}:${scope}`, {
        category: 'forbidden-import',
        pattern: candidate.pattern,
        scope,
      })
    }
  }

  return [...violations.values()]
}

function matchDirectRuntimeCallViolations(
  sourceFile: ts.SourceFile,
  scopeMap: Map<ts.Node, ScopeState>,
): RuntimeLifecycleViolationMatch[] {
  const matches = new Map<string, RuntimeLifecycleViolationMatch>()

  for (const candidate of DIRECT_RUNTIME_FORBIDDEN_CALLS) {
    const identifierCall = hasIdentifierCallMatching(
      sourceFile,
      scopeMap,
      binding => binding.importedName === candidate.importedName && moduleBindingMatches(binding, candidate.matcher),
    )
    const propertyCall = hasPropertyCallMatching(
      sourceFile,
      scopeMap,
      candidate.importedName,
      binding => binding.isModuleObject && moduleBindingMatches(binding, candidate.matcher),
    )
    const moduleLoadPropertyCall = hasModuleLoadPropertyCallMatching(
      sourceFile,
      candidate.importedName,
      moduleSpecifier => moduleMatches(moduleSpecifier, candidate.matcher),
    )
    if (identifierCall || propertyCall || moduleLoadPropertyCall) {
      matches.set(candidate.pattern, {
        category: 'forbidden-lifecycle-call',
        pattern: candidate.pattern,
        scope: 'global',
      })
    }
  }

  for (const candidate of DIRECT_RUNTIME_FORBIDDEN_CTORS) {
    const identifierCtor = hasIdentifierConstructionMatching(
      sourceFile,
      scopeMap,
      binding => binding.importedName === candidate.importedName && moduleBindingMatches(binding, candidate.matcher),
    )
    const propertyCtor = hasPropertyConstructionMatching(
      sourceFile,
      scopeMap,
      candidate.importedName,
      binding => binding.isModuleObject && moduleBindingMatches(binding, candidate.matcher),
    )
    const moduleLoadPropertyCtor = hasModuleLoadPropertyConstructionMatching(
      sourceFile,
      candidate.importedName,
      moduleSpecifier => moduleMatches(moduleSpecifier, candidate.matcher),
    )
    if (identifierCtor || propertyCtor || moduleLoadPropertyCtor) {
      matches.set(candidate.pattern, {
        category: 'forbidden-lifecycle-call',
        pattern: candidate.pattern,
        scope: 'global',
      })
    }
  }

  return [...matches.values()]
}

function matchDelegateCallViolations(
  sourceFile: ts.SourceFile,
  scopeMap: Map<ts.Node, ScopeState>,
): RuntimeLifecycleViolationMatch[] {
  const matches = new Map<string, RuntimeLifecycleViolationMatch>()

  for (const candidate of THREAD_SURFACE_REPOSITORY_CALLS) {
    const identifierCall = hasIdentifierCallMatching(
      sourceFile,
      scopeMap,
      binding => binding.importedName === candidate.importedName && moduleBindingMatches(binding, THREAD_SURFACE_REPOSITORY_MODULE),
    )
    const propertyCall = hasPropertyCallMatching(
      sourceFile,
      scopeMap,
      candidate.importedName,
      binding => binding.isModuleObject && moduleBindingMatches(binding, THREAD_SURFACE_REPOSITORY_MODULE),
    )
    if (identifierCall || propertyCall) {
      matches.set(candidate.pattern, {
        category: 'forbidden-lifecycle-call',
        pattern: candidate.pattern,
        scope: 'delegate-only',
      })
    }
  }

  return [...matches.values()]
}

async function walkRuntimeInterfaceFiles(
  repositoryRoot: string,
  relativeDir: string,
  filesystem: RuntimeLifecycleFileSystem,
  traversalErrors: RuntimeLifecycleTraversalError[],
): Promise<string[]> {
  const directory = join(repositoryRoot, ...relativeDir.split('/'))
  let entries: Dirent[]

  try {
    entries = await filesystem.readdir(directory, { withFileTypes: true })
  } catch (error) {
    traversalErrors.push({
      path: normalizePath(relativeDir),
      code: normalizeErrorCode(error),
    })
    return []
  }

  const files: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = normalizePath(join(relativeDir, entry.name))
    if (entry.isDirectory()) {
      if (GENERATED_PATH_PATTERN.test(child)) continue
      files.push(...await walkRuntimeInterfaceFiles(repositoryRoot, child, filesystem, traversalErrors))
      continue
    }
    if (entry.isFile() && isProductionInterfaceFile(child)) {
      files.push(child)
    }
  }

  return files
}

async function discoverRuntimeLifecycleProductionFilesDetailed(
  repositoryRoot: string,
  roots: readonly string[],
  filesystem: RuntimeLifecycleFileSystem,
): Promise<RuntimeLifecycleFileDiscoveryResult> {
  const traversalErrors: RuntimeLifecycleTraversalError[] = []
  const discovered = await Promise.all(
    roots.map(root => walkRuntimeInterfaceFiles(repositoryRoot, root, filesystem, traversalErrors)),
  )

  return {
    files: discovered.flat().sort(),
    traversalErrors: traversalErrors.sort((left, right) =>
      left.path.localeCompare(right.path) || left.code.localeCompare(right.code)),
  }
}

export async function discoverRuntimeLifecycleProductionFiles(
  repositoryRoot: string,
  roots: readonly string[] = RUNTIME_LIFECYCLE_INTERFACE_ROOTS,
): Promise<string[]> {
  const result = await discoverRuntimeLifecycleProductionFilesDetailed(
    repositoryRoot,
    roots,
    DEFAULT_FILESYSTEM,
  )
  if (result.traversalErrors.length > 0) {
    const error = new Error(
      `Runtime lifecycle interface discovery failed at ${result.traversalErrors[0].path} (${result.traversalErrors[0].code})`,
    )
    Object.assign(error, { code: result.traversalErrors[0].code })
    throw error
  }
  return result.files
}

export function matchRuntimeLifecycleSignals(
  relativePath: string,
  source: string,
): RuntimeLifecycleSignal[] {
  const sourceFile = parseSourceFile(relativePath, source)
  const moduleReferences = collectModuleReferences(sourceFile)
  const bindings = collectImportBindings(sourceFile)
  const scopeMap = collectDeclarations(sourceFile, bindings)
  return matchSignalSet(relativePath, sourceFile, scopeMap, moduleReferences)
}

function defaultSignalsForClassification(
  classification: RuntimeLifecycleInterfaceClassification,
): readonly RuntimeLifecycleSignal[] {
  if (classification.requiredSignals?.length) {
    return classification.requiredSignals
  }
  if (classification.kind === 'api-delegate') return ['api-runtime-service']
  if (classification.kind === 'cli-delegate') return ['cli-runtime-service']
  return []
}

export function requiredSignalsForClassification(
  classification: RuntimeLifecycleInterfaceClassification,
): readonly RuntimeLifecycleSignal[] {
  return defaultSignalsForClassification(classification)
}

export function shouldApplyDelegateOwnershipChecks(
  classification: RuntimeLifecycleInterfaceClassification | undefined,
  signals: readonly RuntimeLifecycleSignal[],
): boolean {
  return classification?.policy === 'delegate-to-runtime-service'
    || (!classification && matchesLifecycleDelegateSignal(signals))
}

export async function loadRuntimeLifecycleFileRecords(
  repositoryRoot: string,
  roots: readonly string[] = RUNTIME_LIFECYCLE_INTERFACE_ROOTS,
  filesystem: RuntimeLifecycleFileSystem = DEFAULT_FILESYSTEM,
): Promise<RuntimeLifecycleRecordLoadResult> {
  const discovery = await discoverRuntimeLifecycleProductionFilesDetailed(
    repositoryRoot,
    roots,
    filesystem,
  )
  const traversalErrors = [...discovery.traversalErrors]
  const records: RuntimeLifecycleFileRecord[] = []

  for (const file of discovery.files) {
    let source: string
    try {
      source = await filesystem.readFile(join(repositoryRoot, ...file.split('/')), 'utf8')
    } catch (error) {
      traversalErrors.push({
        path: file,
        code: normalizeErrorCode(error),
      })
      continue
    }

    const sourceFile = parseSourceFile(file, source)
    const moduleReferences = collectModuleReferences(sourceFile)
    const bindings = collectImportBindings(sourceFile)
    const scopeMap = collectDeclarations(sourceFile, bindings)
    const signals = matchSignalSet(file, sourceFile, scopeMap, moduleReferences)
    const globalViolations = [
      ...matchImportViolations(moduleReferences, DIRECT_RUNTIME_FORBIDDEN_IMPORTS, 'global'),
      ...matchDirectRuntimeCallViolations(sourceFile, scopeMap),
    ]
    const delegateViolations = [
      ...matchImportViolations(moduleReferences, DELEGATE_FORBIDDEN_IMPORTS, 'delegate-only'),
      ...matchDelegateCallViolations(sourceFile, scopeMap),
    ]
    records.push({
      file,
      source,
      signals,
      candidatePatterns: [
        ...new Set([
          ...signals,
          ...globalViolations.map(violation => violation.pattern),
        ]),
      ].sort(),
      globalViolations,
      delegateViolations,
    })
  }

  return {
    records,
    traversalErrors: traversalErrors.sort((left, right) =>
      left.path.localeCompare(right.path) || left.code.localeCompare(right.code)),
  }
}
