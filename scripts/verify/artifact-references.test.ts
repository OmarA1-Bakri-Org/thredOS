import { describe, expect, test } from 'bun:test'
import { posix, win32 } from 'path'
import { verificationArtifactReferences, validateVerificationArtifactReferences } from './artifact-references.mjs'

describe('M1 verification artifact references', () => {
  test.each([
    { paths: posix, root: '/workspace/project' },
    { paths: posix, root: '/workspace/project with spaces' },
    { paths: win32, root: 'C:\\Users\\Verifier\\project with spaces' },
  ])('preserves structured receipts and spaces under $root', ({ paths, root }) => {
    const artifact = paths.join(root, 'test-results', 'verify', 'ui', '2026-proof')
    const receipt = `[verify:ui] artifacts: ${artifact}`
    expect(verificationArtifactReferences(`${receipt}\r\n${receipt}\r\n`, root, 'ui', paths))
      .toEqual(['test-results/verify/ui/2026-proof'])
  })

  test.each([posix, win32])('rejects unrelated, relative, sibling and outside paths', paths => {
    const root = paths.resolve('/project')
    const valid = paths.join(root, 'test-results', 'verify', 'ui', 'proof')
    const lines = [
      `unstructured ${valid}`,
      `[verify:local] artifacts: ${valid}`,
      '[verify:ui] artifacts: test-results/verify/ui/relative',
      `[verify:ui] artifacts: ${root}`,
      `[verify:ui] artifacts: ${paths.join(root, 'test-results', 'verify', 'local', 'wrong-mode')}`,
      `[verify:ui] artifacts: ${paths.join(root, '..', 'outside', 'test-results', 'verify', 'ui', 'proof')}`,
      `[verify:ui] artifacts: ${paths.join(`${root}-sibling`, 'test-results', 'verify', 'ui', 'proof')}`,
    ]
    expect(verificationArtifactReferences(lines.join('\n'), root, 'ui', paths)).toEqual([])
  })

  test('requires artifact references for both successful browser commands', () => {
    const ui = 'test-results/verify/ui/proof'
    const local = 'test-results/verify/local/proof'
    for (const references of [undefined, [], [ui], [local], [null, ui]]) {
      expect(() => { validateVerificationArtifactReferences(references) }).toThrow('artifact references')
    }
    expect(() => { validateVerificationArtifactReferences([ui, local]) }).not.toThrow()
  })
})
