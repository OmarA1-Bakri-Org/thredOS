import { expect, test } from 'bun:test'
import { spawnSync } from 'child_process'
import { join } from 'path'
import { createFixtureRoot, removeFixtureTree } from '../../test/helpers/remove-fixture-tree'
import { WindowsHelperRequestSchema } from './windows-helper-types'

const digest = `sha256:${'1'.repeat(64)}`
test('stage rejects traversal, alternate separators and device aliases before loading native code or writing', async () => {
  const root = await createFixtureRoot('threados-helper-path-proof-')
  try {
    for (const destination of ['..\\outside\\new.txt', '../outside/new.txt', '/absolute.txt', 'C:/outside.txt', 'a/../new.txt', 'NUL.txt', 'file.']) {
      const request = { schema_version: 1, operation_id: 'op-invalid-stage', root,
        expected_root_id: '1'.repeat(48), source: 'stage.txt', expected_source_id: '1'.repeat(48),
        destination, expected_destination_parent_id: '1'.repeat(48), kind: 'stage',
        content_file: join(root, 'evidence.bin'), expected_sha256: digest, expected_size: 1, expected_mode: 0o644,
        plan_id: 'merge-1', plan_hash: digest, preview_hash: digest, approval_hash: digest, root_hash: digest }
      expect(WindowsHelperRequestSchema.safeParse(request).success).toBe(false)
      const child = spawnSync(process.execPath, [join(process.cwd(), 'native/windows-apply/helper.cjs'), join(root, 'op-invalid-stage.json')], {
        input: `${JSON.stringify(request)}\n`, encoding: 'utf8', timeout: 10_000, shell: false,
      })
      expect(child.status).not.toBe(0)
      expect(child.stdout + child.stderr).toContain('MERGE_HELPER_INVALID_REQUEST')
    }
  } finally { await removeFixtureTree(root) }
})
