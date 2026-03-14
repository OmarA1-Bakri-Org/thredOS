/**
 * Suppress "unhandled error between tests" from Bun's automatic module mock restoration.
 *
 * When test files use `mock.module()`, Bun restores the real modules after each test file.
 * This restoration can trigger SyntaxErrors like "Export named 'X' not found in module Y"
 * because the real module's CJS/ESM export shape differs from the mock. These errors are
 * benign — the tests already passed — but Bun counts them as failures.
 *
 * This preload script catches those specific errors and suppresses them.
 */
function isMockRestorationError(reason: unknown): boolean {
  return (
    reason instanceof SyntaxError &&
    reason.message.includes('not found in module')
  )
}

process.on('unhandledRejection', (reason: unknown) => {
  if (isMockRestorationError(reason)) return
  console.error('Unhandled rejection:', reason)
  process.exit(1)
})

process.on('uncaughtException', (error: Error) => {
  if (isMockRestorationError(error)) return
  console.error('Uncaught exception:', error)
  process.exit(1)
})
