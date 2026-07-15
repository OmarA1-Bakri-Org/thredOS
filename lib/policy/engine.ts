import YAML from 'yaml'
import { PolicyConfigSchema, type PolicyConfig, type PolicyAction, type PolicyResult } from './schema'
import { resolveExistingPathWithinRoot } from '@/lib/security/safe-path'
import { readTextFileNoFollow } from '@/lib/security/safe-io'

const SAFE_DEFAULTS: PolicyConfig = PolicyConfigSchema.parse({})

/**
 * Policy engine for validating actions against configured policies
 */
export class PolicyEngine {
  constructor(private config: PolicyConfig) {}

  /**
   * Load policy from .threados/policy.yaml, falling back to safe defaults
   */
  static async load(basePath: string): Promise<PolicyEngine> {
    try {
      const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
      const filePath = await resolveExistingPathWithinRoot(threadosRoot, 'policy.yaml')
      const content = await readTextFileNoFollow(filePath)
      const raw = YAML.parse(content)
      const config = PolicyConfigSchema.parse(raw)
      return new PolicyEngine(config)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new PolicyEngine(SAFE_DEFAULTS)
      }
      throw error
    }
  }

  /**
   * Get current policy config
   */
  getConfig(): PolicyConfig {
    return this.config
  }

  /**
   * Validate an action against the policy
   */
  validate(action: PolicyAction): PolicyResult {
    const forbiddenResult = this.checkForbiddenPatterns(action)
    if (forbiddenResult) return forbiddenResult

    const allowlistResult = this.checkCommandAllowlist(action)
    if (allowlistResult) return allowlistResult

    const cwdResult = this.checkCwdRestriction(action)
    if (cwdResult) return cwdResult

    const limitResult = this.checkResourceLimits(action)
    if (limitResult) return limitResult

    if (this.config.mode === 'SAFE' && action.type === 'run_command') {
      return { allowed: true, confirmation_required: true }
    }

    return { allowed: true, confirmation_required: false }
  }

  private checkForbiddenPatterns(action: PolicyAction): PolicyResult | null {
    const subjects = action.executable_payload
      ? [
          action.executable_payload.command,
          ...action.executable_payload.args,
          ...(action.executable_payload.script ? [action.executable_payload.script.content] : []),
        ]
      : action.command ? [action.command] : []
    for (const pattern of this.config.forbidden_patterns) {
      const expression = new RegExp(pattern, 'm')
      if (subjects.some(subject => expression.test(subject))) {
        return { allowed: false, reason: `Command matches forbidden pattern: ${pattern}`, confirmation_required: false }
      }
    }
    return null
  }

  private checkCommandAllowlist(action: PolicyAction): PolicyResult | null {
    const command = action.executable_payload?.command ?? action.command
    if (!command || this.config.command_allowlist.length === 0) return null
    const allowed = this.config.command_allowlist.some(prefix => command.startsWith(prefix))
    if (!allowed) {
      return { allowed: false, reason: `Command not in allowlist: ${command}`, confirmation_required: false }
    }
    return null
  }

  private checkCwdRestriction(action: PolicyAction): PolicyResult | null {
    const cwd = action.executable_payload?.cwd ?? action.cwd
    if (!cwd || this.config.cwd_patterns.length === 0) return null
    const cwdAllowed = this.config.cwd_patterns.some(pattern => {
      if (pattern === '**') return true
      const prefix = pattern.replace(/\*+$/, '')
      return cwd.startsWith(prefix)
    })
    if (!cwdAllowed) {
      return { allowed: false, reason: `CWD not allowed: ${cwd}`, confirmation_required: false }
    }
    return null
  }

  private checkResourceLimits(action: PolicyAction): PolicyResult | null {
    if (action.type === 'fanout' && action.fanout_count !== undefined && action.fanout_count > this.config.max_fanout) {
      return { allowed: false, reason: `Fanout ${action.fanout_count} exceeds limit ${this.config.max_fanout}`, confirmation_required: false }
    }
    if (action.type === 'concurrent' && action.concurrent_count !== undefined && action.concurrent_count > this.config.max_concurrent) {
      return { allowed: false, reason: `Concurrent ${action.concurrent_count} exceeds limit ${this.config.max_concurrent}`, confirmation_required: false }
    }
    return null
  }
}
