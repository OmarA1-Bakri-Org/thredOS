import path from 'path'

// Only the verification runner's structured receipt supplies artifact references.
// These strings are metadata; they never grant filesystem access.
export function verificationArtifactReferences(output, repositoryRoot, mode, paths = path) {
  const prefix = `[verify:${mode}] artifacts: `
  const references = output.split(/\r?\n/).flatMap(line => {
    if (!line.startsWith(prefix)) return []
    const candidate = line.slice(prefix.length)
    if (!paths.isAbsolute(candidate)) return []
    const within = paths.relative(repositoryRoot, paths.resolve(candidate))
    const portable = within.split(paths.sep).join('/')
    return portable.startsWith(`test-results/verify/${mode}/`) ? [portable] : []
  })
  return [...new Set(references)]
}

export function validateVerificationArtifactReferences(references) {
  for (const mode of ['ui', 'local']) {
    if (!Array.isArray(references) || !references.some(reference =>
      typeof reference === 'string' && reference.startsWith(`test-results/verify/${mode}/`))) {
      throw new Error(`M1 workspace UI proof is missing ${mode} artifact references`)
    }
  }
}
