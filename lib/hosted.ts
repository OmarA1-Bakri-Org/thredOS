function readHostedEnv(key: string): string | undefined {
  return process.env[`THREDOS_${key}`] ?? process.env[`THREADOS_${key}`]
}

export function isHostedMode(): boolean {
  return readHostedEnv('HOSTED_MODE') === 'true'
}

export function allowChatApply(): boolean {
  if (!isHostedMode()) return true
  return readHostedEnv('ALLOW_CHAT_APPLY') === 'true'
}

export function allowShellModel(): boolean {
  if (!isHostedMode()) return true
  return readHostedEnv('ALLOW_SHELL_MODEL') === 'true'
}

export function enableThreadRunner(): boolean {
  return readHostedEnv('ENABLE_THREAD_RUNNER') === 'true'
}

export function allowHostedProcessControls(): boolean {
  if (!isHostedMode()) return true
  return readHostedEnv('ALLOW_PROCESS_CONTROLS') === 'true'
}

export function requireHostedAuth(): boolean {
  return isHostedMode()
}

export function getAdminEmail(): string | null {
  return readHostedEnv('ADMIN_EMAIL')?.trim() || null
}

export function getSessionSecret(): string | null {
  return readHostedEnv('SESSION_SECRET')?.trim() || null
}

export function getAdminPasswordHash(): string | null {
  return readHostedEnv('ADMIN_PASSWORD_HASH')?.trim() || null
}
