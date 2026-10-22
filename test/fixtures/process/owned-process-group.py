"""Own and reap both POSIX group members; never leave an orphan fixture."""
import json
import os
import subprocess
import sys

leader = None
worker = None
try:
    leader = subprocess.Popen(
        [sys.executable, "-c", "import sys; sys.stdin.read()"],
        stdin=subprocess.PIPE, preexec_fn=os.setpgrp, cwd=sys.argv[1],
    )
    worker = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(120)"],
        preexec_fn=lambda: os.setpgid(0, leader.pid), cwd=sys.argv[1],
    )
    print(json.dumps({"leader": leader.pid, "worker": worker.pid,
                      "pgid": os.getpgid(worker.pid)}), flush=True)
    sys.stdin.readline()
    leader.stdin.close()
    leader.wait(timeout=5)
    print(json.dumps({"leader_reaped": True, "worker_live": worker.poll() is None,
                      "worker_pgid": os.getpgid(worker.pid)}), flush=True)
    sys.stdin.readline()
finally:
    for child in (worker, leader):
        if child is not None:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)
    print(json.dumps({"all_owned_children_reaped": True}), flush=True)
