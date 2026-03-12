#!/usr/bin/env python
"""
Claude Code Context Watcher Daemon

Monitors the active Claude Code session transcript (.jsonl) for token usage.
When estimated token count crosses THRESHOLD (default 75%), writes a sentinel
file that hookify rules or native hooks can detect.

Usage:
    python context_watcher.py                  # run in foreground
    python context_watcher.py --daemon         # run as background process
    python context_watcher.py --project-dir .  # scope to specific project

Memory model:
    - Incremental file reading: only new lines since last poll are parsed
    - No full-file re-reads after initial scan
    - Hard RSS ceiling (default 100 MB) with forced GC + reset on breach
    - Token count is a running integer accumulator, not stored text

JSONL structure (Claude Code transcripts):
    type=user:      msg["message"]["content"] -> str
    type=assistant:  msg["message"]["content"] -> list[{type, text?, thinking?}]
    type=system:     msg["message"]["content"] -> str or list
    type=progress:   msg["data"] -> dict (tool results, large)
"""

import argparse
import gc
import json
import os
import pathlib
import sys
import time
import logging

try:
    import tiktoken
except ImportError:
    print("ERROR: tiktoken not installed. Run: pip install tiktoken", file=sys.stderr)
    sys.exit(1)

# ── Configuration ────────────────────────────────────────────────────
THRESHOLD = 0.75
MAX_TOKENS = 200_000          # Claude Opus context window
POLL_INTERVAL = 10            # seconds between checks
MAX_MEMORY_MB = 100           # hard RSS ceiling in MB
SENTINEL = pathlib.Path("/tmp/.claude_checkpoint_needed")
CLAUDE_PROJECTS_DIR = pathlib.Path.home() / ".claude" / "projects"

enc = tiktoken.get_encoding("cl100k_base")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [context-watcher] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ── Memory monitoring ────────────────────────────────────────────────

def get_rss_mb() -> float:
    """Get current process RSS in MB. Cross-platform."""
    try:
        if sys.platform == "win32":
            import ctypes
            import ctypes.wintypes
            # Windows: use GetProcessMemoryInfo via kernel32
            class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
                _fields_ = [
                    ("cb", ctypes.wintypes.DWORD),
                    ("PageFaultCount", ctypes.wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                ]
            counters = PROCESS_MEMORY_COUNTERS()
            counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
            handle = ctypes.c_void_p(-1)  # pseudo-handle for current process
            ctypes.windll.kernel32.K32GetProcessMemoryInfo(
                handle, ctypes.byref(counters), counters.cb
            )
            return counters.WorkingSetSize / (1024 * 1024)
        else:
            import resource
            # Linux: ru_maxrss is in KB; macOS: in bytes
            usage = resource.getrusage(resource.RUSAGE_SELF)
            if sys.platform == "darwin":
                return usage.ru_maxrss / (1024 * 1024)
            return usage.ru_maxrss / 1024
    except Exception:
        return 0.0


# ── Text extraction ──────────────────────────────────────────────────

def extract_text_from_message(msg: dict) -> str:
    """Extract all text content from a JSONL transcript line."""
    msg_type = msg.get("type", "")
    parts = []

    if msg_type in ("user", "assistant", "system"):
        message = msg.get("message", {})
        if not isinstance(message, dict):
            return ""
        content = message.get("content", "")

        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    if "text" in block:
                        parts.append(block["text"])
                    if "thinking" in block:
                        parts.append(block["thinking"])
                elif isinstance(block, str):
                    parts.append(block)

    elif msg_type == "progress":
        data = msg.get("data", {})
        if isinstance(data, dict):
            content = data.get("content", "")
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and "text" in block:
                        parts.append(block["text"])

    return "\n".join(parts)


def count_tokens_in_text(text: str) -> int:
    """Count tokens in a string. Returns 0 for empty input."""
    if not text:
        return 0
    return len(enc.encode(text))


# ── Incremental session reader ───────────────────────────────────────

class SessionTracker:
    """Tracks a single JSONL session file incrementally.

    Instead of re-reading the entire file every poll, we remember the byte
    offset and only read new lines appended since the last poll.  The token
    count is a running accumulator — no text is stored.
    """

    def __init__(self):
        self.path: pathlib.Path | None = None
        self.file_offset: int = 0       # bytes read so far
        self.token_count: int = 0       # running total
        self._last_mtime: float = 0.0

    def reset(self, new_path: pathlib.Path | None = None):
        """Reset tracker for a new session file."""
        self.path = new_path
        self.file_offset = 0
        self.token_count = 0
        self._last_mtime = 0.0

    def update(self, session_path: pathlib.Path) -> int:
        """Read new lines from session file, return updated token count."""
        # Session changed — full reset
        if session_path != self.path:
            log.info("Session changed: %s -> %s",
                     self.path.name[:12] if self.path else "none",
                     session_path.name[:12])
            self.reset(session_path)

        try:
            stat = session_path.stat()
        except OSError:
            return self.token_count

        # File truncated or replaced (e.g. compaction rewrote it)
        if stat.st_size < self.file_offset:
            log.info("File truncated (compaction?), re-scanning from start")
            self.file_offset = 0
            self.token_count = 0

        # No new data
        if stat.st_size == self.file_offset:
            return self.token_count

        # Read only the new bytes
        new_tokens = 0
        try:
            with open(session_path, encoding="utf-8", errors="replace") as f:
                f.seek(self.file_offset)
                for line in f:
                    try:
                        msg = json.loads(line)
                        text = extract_text_from_message(msg)
                        new_tokens += count_tokens_in_text(text)
                    except (json.JSONDecodeError, TypeError):
                        pass
                self.file_offset = f.tell()
        except OSError as e:
            log.warning("Cannot read %s: %s", session_path, e)

        self.token_count += new_tokens
        self._last_mtime = stat.st_mtime
        return self.token_count


# ── Session discovery ────────────────────────────────────────────────

def find_active_session(project_slug: str | None = None) -> pathlib.Path | None:
    """Find the most recently modified .jsonl session file."""
    if not CLAUDE_PROJECTS_DIR.exists():
        return None

    search_dir = CLAUDE_PROJECTS_DIR
    if project_slug:
        specific = CLAUDE_PROJECTS_DIR / project_slug
        if specific.exists():
            search_dir = specific

    # Use glob (non-recursive) for the common case — sessions are
    # directly in the project dir, not nested
    jsonl_files = list(search_dir.glob("*.jsonl"))
    if not jsonl_files:
        # Fallback to recursive search
        jsonl_files = list(search_dir.rglob("*.jsonl"))

    if not jsonl_files:
        return None

    return max(jsonl_files, key=lambda p: p.stat().st_mtime)


# ── Sentinel management ─────────────────────────────────────────────

def write_sentinel(session: pathlib.Path, tokens: int, pct: float):
    """Write the checkpoint-needed sentinel file."""
    SENTINEL.parent.mkdir(parents=True, exist_ok=True)
    SENTINEL.write_text(
        json.dumps({
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "session": str(session),
            "tokens": tokens,
            "percentage": round(pct * 100, 1),
            "threshold": THRESHOLD,
        }),
        encoding="utf-8",
    )


def clear_sentinel():
    """Remove the sentinel file."""
    if SENTINEL.exists():
        SENTINEL.unlink()
        log.info("Cleared sentinel file %s", SENTINEL)


# ── Main loop ────────────────────────────────────────────────────────

def run_watcher(project_slug: str | None = None):
    """Main watch loop."""
    log.info("Context watcher started (memory ceiling: %d MB)", MAX_MEMORY_MB)
    log.info("  Threshold: %.0f%% of %d tokens (%d tokens)",
             THRESHOLD * 100, MAX_TOKENS, int(THRESHOLD * MAX_TOKENS))
    log.info("  Sentinel: %s", SENTINEL)
    log.info("  Poll interval: %ds", POLL_INTERVAL)
    log.info("  Scanning: %s", CLAUDE_PROJECTS_DIR / (project_slug or "*"))

    tracker = SessionTracker()
    sentinel_written = False
    last_reported_tokens = 0
    gc_poll_counter = 0

    while True:
        try:
            session = find_active_session(project_slug)
            if session is None:
                time.sleep(POLL_INTERVAL)
                continue

            tokens = tracker.update(session)
            pct = tokens / MAX_TOKENS

            # Log when count changes significantly (>1% change)
            if abs(tokens - last_reported_tokens) > MAX_TOKENS * 0.01:
                rss = get_rss_mb()
                log.info(
                    "%s: %d tokens (%.1f%%) | RSS %.1f MB %s",
                    session.name[:12],
                    tokens,
                    pct * 100,
                    rss,
                    "⚠ THRESHOLD" if pct >= THRESHOLD else "",
                )
                last_reported_tokens = tokens

            # Write sentinel at threshold
            if pct >= THRESHOLD and not sentinel_written:
                write_sentinel(session, tokens, pct)
                log.info("SENTINEL WRITTEN — checkpoint needed at %.1f%%",
                         pct * 100)
                sentinel_written = True

            # Reset if tokens drop (post-compaction)
            if pct < THRESHOLD * 0.5 and sentinel_written:
                clear_sentinel()
                sentinel_written = False
                log.info("Context dropped below 50%% — reset sentinel state")

            # Memory guard: check RSS every 6 polls (~60s)
            gc_poll_counter += 1
            if gc_poll_counter >= 6:
                gc_poll_counter = 0
                rss = get_rss_mb()
                if rss > MAX_MEMORY_MB:
                    log.warning(
                        "RSS %.1f MB exceeds ceiling %d MB — forcing GC + tracker reset",
                        rss, MAX_MEMORY_MB,
                    )
                    tracker.reset(session)
                    gc.collect()
                    rss_after = get_rss_mb()
                    log.info("Post-GC RSS: %.1f MB", rss_after)
                    if rss_after > MAX_MEMORY_MB:
                        log.error(
                            "RSS still %.1f MB after GC — restarting count from scratch",
                            rss_after,
                        )
                        # Force a full re-count next poll
                        tracker.reset(session)

        except Exception as e:
            log.error("Watcher error: %s", e)

        time.sleep(POLL_INTERVAL)


# ── Entry point ──────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Claude Code Context Watcher")
    parser.add_argument("--daemon", action="store_true",
                        help="Run as background process")
    parser.add_argument("--project-dir", type=str, default=None,
                        help="Project slug (e.g., c--Users-OmarAl-Bakri-THREAD-OS)")
    parser.add_argument("--threshold", type=float, default=THRESHOLD,
                        help=f"Token threshold ratio (default: {THRESHOLD})")
    parser.add_argument("--interval", type=int, default=POLL_INTERVAL,
                        help=f"Poll interval in seconds (default: {POLL_INTERVAL})")
    parser.add_argument("--max-memory-mb", type=int, default=MAX_MEMORY_MB,
                        help=f"RSS ceiling in MB (default: {MAX_MEMORY_MB})")
    args = parser.parse_args()

    THRESHOLD = args.threshold
    POLL_INTERVAL = args.interval
    MAX_MEMORY_MB = args.max_memory_mb

    if args.daemon:
        import subprocess
        cmd = [sys.executable, __file__]
        if args.project_dir:
            cmd += ["--project-dir", args.project_dir]
        cmd += ["--max-memory-mb", str(MAX_MEMORY_MB)]
        if sys.platform == "win32":
            with open(os.devnull, "w", encoding="utf-8") as devnull:
                subprocess.Popen(
                    cmd,
                    creationflags=(
                        subprocess.CREATE_NO_WINDOW
                        | subprocess.DETACHED_PROCESS
                    ),
                    stdout=devnull,
                    stderr=devnull,
                )
        else:
            with open(os.devnull, "w", encoding="utf-8") as devnull:
                subprocess.Popen(
                    cmd, stdout=devnull, stderr=devnull,
                    start_new_session=True,
                )
        print("Watcher daemon started (PID detached)")
        sys.exit(0)

    run_watcher(args.project_dir)
