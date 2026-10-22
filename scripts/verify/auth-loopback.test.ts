import { expect, test } from 'bun:test'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'
import { resolve } from 'path'

// The verification runner uses Node; Bun's HTTP response URL behavior differs.
test('the local verification URL retains Secure session cookies for API requests', () => {
  const helperURL = pathToFileURL(resolve(import.meta.dir, 'runtime-helpers.mjs')).href
  const script = `
    import { createServer } from 'node:http'
    import { request } from '@playwright/test'
    import { createPlaywrightServerSettings } from ${JSON.stringify(helperURL)}
    const server = createServer((incoming, response) => {
      if (incoming.url === '/login') {
        response.setHeader('Set-Cookie', 'verification_dummy=present; Secure; HttpOnly; SameSite=Lax; Path=/')
      }
      response.end(JSON.stringify({ cookiePresent: incoming.headers.cookie?.includes('verification_dummy=present') ?? false }))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let context
    try {
      const settings = createPlaywrightServerSettings({ mode: 'ci', env: { PLAYWRIGHT_PORT: String(server.address().port) } })
      context = await request.newContext({ baseURL: settings.baseURL, timeout: 5000 })
      await context.get('/login')
      console.log(JSON.stringify(await (await context.get('/session')).json()))
    } finally {
      await context?.dispose()
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  `
  const result = spawnSync('node', ['--input-type=module', '-e', script], {
    cwd: resolve(import.meta.dir, '../..'), encoding: 'utf8', timeout: 10_000,
  })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ cookiePresent: true })
})
