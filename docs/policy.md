# Policy Configuration

thredOS enforces safety policies via `.threados/policy.yaml` in your project root.
If the file does not exist, thredOS falls back to SAFE defaults.

## Configuration

```yaml
# .threados/policy.yaml
mode: SAFE                    # SAFE or POWER
command_allowlist: []         # Empty = allow all; non-empty = whitelist
cwd_patterns:
  - "**"                      # Allowed working directories (glob patterns)
max_fanout: 10                # Maximum parallel fanout count
max_concurrent: 5             # Maximum concurrent steps
forbidden_patterns:           # Regex patterns to block
  - "rm -rf /"
  - "sudo.*"
```

## Where It Is Used

- CLI/runtime actions are validated against this policy before execution.
- `SAFE` mode requires confirmation for command execution actions.
- `POWER` mode removes confirmation prompts but still applies allowlist/forbidden/concurrency rules.
- Keep this file in `.threados/policy.yaml` so both UI/API and CLI flows resolve the same policy.

## Modes

### SAFE (default)

- Command execution actions require confirmation
- Policy checks enforced on every action
- Chat orchestrator always proposes, never auto-executes

### POWER

- Commands execute without confirmation prompts
- Policy limits still enforced (max_fanout, forbidden_patterns)
- Use with caution in trusted environments

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `SAFE \| POWER` | `SAFE` | Execution mode |
| `command_allowlist` | `string[]` | `[]` | Command prefixes to allow (empty = all) |
| `cwd_patterns` | `string[]` | `["**"]` | Allowed working directory patterns |
| `max_fanout` | `number` | `10` | Max parallel fanout |
| `max_concurrent` | `number` | `5` | Max concurrent steps |
| `forbidden_patterns` | `string[]` | `[]` | Regex patterns to block |

## Examples

### Restrictive policy

```yaml
mode: SAFE
command_allowlist:
  - "bun "
  - "node "
  - "git "
cwd_patterns:
  - "/home/user/projects/**"
max_fanout: 3
max_concurrent: 2
forbidden_patterns:
  - "rm -rf"
  - "sudo"
  - "curl.*\\|.*sh"
```

### Permissive policy

```yaml
mode: POWER
command_allowlist: []
cwd_patterns: ["**"]
max_fanout: 20
max_concurrent: 10
forbidden_patterns: []
```
