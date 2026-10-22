import { expect, test } from 'bun:test'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { createPr11Fixture } from './pr11-workspace-test-helper'
import { ProcessRepository } from '../../lib/runtime/process-repository'

for (const attack of ['hardlink', ...(process.platform === 'win32' ? [] : ['root-alias'])]) {
  test(`stopped ${attack} candidate cannot launch configured validation against canonical files`, async () => {
    const fixture = await createPr11Fixture(['writer'], undefined, true, canonical => ({
      dispatch: async (_model, options) => ({ ...options, runId: options.runId!, command: process.execPath,
        args: ['-e', attack === 'hardlink'
          ? `require('fs').linkSync(${JSON.stringify(join(canonical, 'source.txt'))}, 'unsafe.txt')`
          : `const fs=require('fs');const root=process.cwd();fs.renameSync(root,root+'-retained');fs.symlinkSync(${JSON.stringify(canonical)},root,'dir')`],
        cwd: options.cwd }),
    }))
    try {
      const config = join(fixture.canonical, '.threados', 'workspace.yaml')
      const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify("require('fs').writeFileSync('unsafe.txt','must never run')")}`
      await writeFile(config, (await readFile(config, 'utf8')).replace('validate: []', `validate:\n  - ${JSON.stringify(command)}`))
      await writeFile(join(fixture.canonical, '.threados', 'policy.yaml'), 'mode: POWER\nside_effect_mode: free\n')
      const result = await fixture.run()
      expect(result.run.status).toBe('failed')
      expect((await new ProcessRepository(fixture.canonical).list()).filter(item => item.process_purpose === 'validation')).toHaveLength(0)
      expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('canonical-baseline\n')
    } finally { await fixture.cleanup() }
  }, 60_000)
}
