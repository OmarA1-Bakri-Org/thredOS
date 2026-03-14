---
name: pre-compaction-checkpoint
enabled: true
event: prompt
pattern: .*
action: warn
---

## Context Window Monitor — Pre-Compaction Checkpoint

**Check for sentinel file on every interaction.** Run this Bash command silently:

```
cat /tmp/.claude_checkpoint_needed 2>/dev/null
```

**If the file EXISTS** (the context watcher daemon has detected 75%+ token usage):

### Execute immediately — in this exact order:

1. **Invoke `/everything-claude-code:checkpoint`** — Captures current task state, files modified, decisions, and next steps into a durable checkpoint document.

2. **After checkpoint completes, invoke `/compact`** — Compresses the conversation while the checkpoint preserves detailed working state.

3. **Delete the sentinel file** after compact: `rm /tmp/.claude_checkpoint_needed`

**If the file DOES NOT EXIST**, ignore this reminder and continue normally.

The daemon (`context_watcher.py`) uses tiktoken against the active JSONL transcript and writes the sentinel at 75% of 200k tokens. Trust the daemon's measurement over heuristic estimates.
