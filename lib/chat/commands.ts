export const CHAT_MUTATION_COMMANDS = [
  'step add',
  'step remove',
  'step update',
  'gate approve',
  'gate block',
  'dep add',
  'dep remove',
  'group create',
  'fusion create',
] as const

export const CHAT_RUNTIME_CONTROL_COMMANDS = ['run', 'stop', 'restart'] as const

export const CHAT_KNOWN_COMMANDS = [
  ...CHAT_MUTATION_COMMANDS,
  ...CHAT_RUNTIME_CONTROL_COMMANDS,
] as const

export type ChatMutationCommand = (typeof CHAT_MUTATION_COMMANDS)[number]
export type ChatRuntimeControlCommand = (typeof CHAT_RUNTIME_CONTROL_COMMANDS)[number]
export type ChatKnownCommand = (typeof CHAT_KNOWN_COMMANDS)[number]

const mutationCommands = new Set<string>(CHAT_MUTATION_COMMANDS)
const runtimeCommands = new Set<string>(CHAT_RUNTIME_CONTROL_COMMANDS)
const knownCommands = new Set<string>(CHAT_KNOWN_COMMANDS)

export const CHAT_RUNTIME_CONTROL_GUIDANCE =
  'Use ThreadOSRuntimeService through the canonical workbench or CLI until chat delegation exists.'

export function isKnownChatCommand(command: string): command is ChatKnownCommand {
  return knownCommands.has(command)
}

export function isChatMutationCommand(command: string): command is ChatMutationCommand {
  return mutationCommands.has(command)
}

export function isChatRuntimeControlCommand(command: string): command is ChatRuntimeControlCommand {
  return runtimeCommands.has(command)
}

export function buildRuntimeControlRejection(command: string): string {
  return `Command "${command}" is not available in chat/apply. ${CHAT_RUNTIME_CONTROL_GUIDANCE}`
}
