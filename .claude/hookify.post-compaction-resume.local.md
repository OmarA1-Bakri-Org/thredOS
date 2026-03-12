---
name: post-compaction-resume
enabled: true
event: prompt
pattern: .*
action: warn
---

## Post-Compaction Context Recovery

**Detect post-compaction state.** Check for ANY of these indicators:
- A `SessionStart:compact hook success: Previous session summary:` message is present in context
- The conversation starts with a compaction summary block
- Context feels fresh/short despite the session summary referencing ongoing work

### If post-compaction state is detected, execute these steps IN ORDER:

1. **Find and read the most recent checkpoint document:**
   ```
   Glob pattern="**/*checkpoint*" in .claude/ and .threados/
   ```
   The checkpoint contains: current task state, files modified, decisions made, and explicit next steps.

2. **Refresh context** from the checkpoint:
   - Re-read any files listed as actively being modified
   - Restore awareness of the current task and its progress
   - Note any pending items or blockers

3. **Invoke `/task-router:task-router`** with the next steps from the checkpoint. The task-router selects the most appropriate tools and approach for continuing work based on what the checkpoint prescribes.

4. **Verify the watcher daemon is still running:**
   ```
   ps aux | grep context_watcher || python3 .threados/context_watcher.py --daemon --project-dir c--Users-OmarAl-Bakri-THREAD-OS
   ```

### If this is NOT a post-compaction session, ignore this reminder entirely.

**Goal: zero context loss between compaction cycles.** Checkpoint captures state, task-router restores momentum.
