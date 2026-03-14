import { readFile } from 'fs/promises'
import { join } from 'path'
import YAML from 'yaml'
import { PolicyConfigSchema, type PolicyConfig, type PolicyAction, type PolicyResult } from './schema'

const POLICY_PATH = '.threados/policy.yaml'

const SAFE_DEFAULTS: PolicyConfig = {
  mode: 'SAFE',
  command_allowlist: [],
  cwd_patterns: ['**'],
  max_fanout: 10,
  max_concurrent: 5,
  forbidden_patterns: [],
}

/**
 * Policy engine for validating actions against configured policies
 */
export class PolicyEngine {
  constructor(private config: PolicyConfig) {}

  /**
   * Load policy from .threados/policy.yaml, falling back to safe defaults
   */
  static async load(basePath: string): Promise<PolicyEngine> {
    const filePath = join(basePath, POLICY_PATH)
    try {
      const content = await readFile(filePath, 'utf-8')
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
    if (!action.command) return null
    for (const pattern of this.config.forbidden_patterns) {
      if (new RegExp(pattern).test(action.command)) {
        return { allowed: false, reason: `Command matches forbidden pattern: ${pattern}`, confirmation_required: false }
      }
    }
    return null
  }

  private checkCommandAllowlist(action: PolicyAction): PolicyResult | null {
    if (!action.command || this.config.command_allowlist.length === 0) return null
    const allowed = this.config.command_allowlist.some(prefix => action.command!.startsWith(prefix))
    if (!allowed) {
      return { allowed: false, reason: `Command not in allowlist: ${action.command}`, confirmation_required: false }
    }
    return null
  }

  private checkCwdRestriction(action: PolicyAction): PolicyResult | null {
    if (!action.cwd || this.config.cwd_patterns.length === 0) return null
    const cwdAllowed = this.config.cwd_patterns.some(pattern => {
      if (pattern === '**') return true
      const prefix = pattern.replace(/\*+$/, '')
      return action.cwd!.startsWith(prefix)
    })
    if (!cwdAllowed) {
      return { allowed: false, reason: `CWD not allowed: ${action.cwd}`, confirmation_required: false }
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
