const http = require('http')
const fs = require('fs/promises')
const path = require('path')

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function safeId(value) {
  if (typeof value !== 'string' || value.length > 255 || !SAFE_ID.test(value)
    || value === '.' || value === '..' || /[. ]$/.test(value)
    || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)) {
    throw new Error('Invalid workspace identifier')
  }
  return value
}

function localOrigin(startUrl) {
  const url = new URL(startUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password) {
    throw new Error('Workspace inspection requires the local desktop server')
  }
  return url.origin
}

function inspectionUrl(startUrl, id) {
  return `${localOrigin(startUrl)}/api/workspaces/${encodeURIComponent(safeId(id))}`
}

function requestInspection(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 5000 }, response => {
      if (response.statusCode !== 200 || response.headers.location) {
        response.resume()
        reject(new Error('Workspace inspection failed'))
        return
      }
      const chunks = []
      let size = 0
      response.on('data', chunk => {
        size += chunk.length
        if (size > 1024 * 1024) {
          request.destroy(new Error('Workspace inspection response is too large'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch { reject(new Error('Workspace inspection response is invalid')) }
      })
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('Workspace inspection timed out')))
    request.on('error', reject)
  })
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function within(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function validatedRoot(inspection, id, canonicalRoot) {
  const workspace = inspection?.workspace
  if (inspection?.schema_version !== 1 || workspace?.id !== id
    || workspace.provider !== 'copy' || workspace.isolation_label !== 'THREADOS_SCOPED'
    || !['ready', 'frozen', 'retained'].includes(workspace.status)
    || inspection.verification?.exists !== true
    || !Array.isArray(inspection.diagnostics)
    || inspection.diagnostics.some(item => ['WORKSPACE_STORAGE_UNSAFE', 'WORKSPACE_TREE_MISSING', 'WORKSPACE_MANIFEST_INVALID'].includes(item?.code))) {
    throw new Error('Workspace is not verified for Explorer')
  }
  const runId = safeId(workspace.workflow_run_id)
  const root = workspace.root_path
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.normalize(root) !== root
    || root.split(/[\\/]/).some(segment => segment === '.' || segment === '..')
    || (process.platform === 'win32' && (root.startsWith('\\\\') || root.startsWith('\\?\\')))) {
    throw new Error('Workspace root is unsafe')
  }
  const workspaceDir = path.dirname(root)
  const runDir = path.dirname(workspaceDir)
  const namespaceDir = path.dirname(runDir)
  const workspacesDir = path.dirname(namespaceDir)
  if (!samePath(path.basename(root), 'tree') || !samePath(path.basename(workspaceDir), id)
    || !samePath(path.basename(runDir), runId) || !samePath(path.basename(workspacesDir), 'workspaces')
    || within(path.resolve(canonicalRoot), root) || within(root, path.resolve(canonicalRoot))) {
    throw new Error('Workspace root is unsafe')
  }
  return root
}

async function verifyActualDirectory(root, canonicalRoot, fileSystem = fs) {
  const parsed = path.parse(root)
  let current = parsed.root
  for (const segment of root.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const info = await fileSystem.lstat(current)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('Workspace root contains a link or non-directory')
    }
  }
  const actual = await fileSystem.realpath(root)
  if (!samePath(actual, root)) throw new Error('Workspace root resolves to another path')
  const canonical = await fileSystem.realpath(canonicalRoot)
  if (within(canonical, actual) || within(actual, canonical)) {
    throw new Error('Workspace root overlaps the canonical project')
  }
  return actual
}

async function openVerifiedWorkspace({ id, startUrl, canonicalRoot, fetchInspection = requestInspection, fileSystem = fs, openPath }) {
  const url = inspectionUrl(startUrl, id)
  const inspection = await fetchInspection(url)
  const root = validatedRoot(inspection, id, canonicalRoot)
  const actual = await verifyActualDirectory(root, canonicalRoot, fileSystem)
  const failure = await openPath(actual)
  if (failure) throw new Error(`Explorer could not open workspace: ${failure}`)
}

module.exports = { safeId, localOrigin, inspectionUrl, validatedRoot, verifyActualDirectory, openVerifiedWorkspace }
