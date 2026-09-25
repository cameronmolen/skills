#!/usr/bin/env python3
"""Wait on your GitHub review queue without spending tokens; exit once a PR is ready for you.

    watch-review-requests.py [--filter "org:neiybor"] [--interval 120]
    watch-review-requests.py --dry-run     # one poll, print what would be reported, write nothing

A PR is in the queue when it is open, not a draft, not approved, and requests a
review from your account directly (team requests don't count). Each poll is one
GraphQL search. The script exits, printing one JSON line, when a PR enters the queue:

    {"status": "ready", "prs": [...], "queue": <PRs in the queue right now>}

A PR enters the queue once per review request, so a new PR, a draft marked ready,
and a re-request after you reviewed each report once, and a relaunch after a wake
stays quiet until something new arrives. The first launch reports everything
already waiting.

A PR that pr-brief is monitoring for its author's response belongs to that monitor,
which wakes on re-requests itself. Its requests are recorded as reported without
waking you, as long as the monitor's state was touched within the last hour.

Reported requests are recorded in ~/.local/state/watch-review-requests/. Only one watcher
runs at a time: a second launch prints {"status": "already_watching"} and exits 3.
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

STATE_HOME = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state"))
STATE_DIR = STATE_HOME / "watch-review-requests"
MONITOR_DIR = STATE_HOME / "pr-brief-watch"  # owned by pr-brief/watch-response.py
STATE_PATH = STATE_DIR / "reported.json"
PID_PATH = STATE_DIR / "watcher.pid"
BASE_QUERY = "is:pr is:open draft:false archived:false user-review-requested:@me -review:approved"
MAX_CONSECUTIVE_ERRORS = 30
MAX_REMEMBERED = 500
MONITOR_LEASE = 3600

QUERY = """
query($q: String!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 50) {
    nodes { ... on PullRequest {
      url number title isDraft reviewDecision additions deletions changedFiles
      author { login }
      repository { nameWithOwner }
      timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 20) {
        nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } } } }
      }
    } }
  }
}
"""


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def fetch(search: str) -> tuple[str, list[dict]]:
    data = json.loads(gh("api", "graphql", "-f", f"query={QUERY}", "-f", f"q={search}"))["data"]
    return data["viewer"]["login"], [n for n in data["search"]["nodes"] if n]


def queue(me: str, nodes: list[dict]) -> dict[str, dict]:
    """Every PR waiting on you right now, keyed by its latest request so a re-request is a new key."""
    found: dict[str, dict] = {}
    for pr in nodes:
        # The search already filters these; re-checking guards against a lagging search index.
        if pr["isDraft"] or pr["reviewDecision"] == "APPROVED":
            continue
        requests = [
            e["createdAt"] for e in pr["timelineItems"]["nodes"]
            if (e.get("requestedReviewer") or {}).get("login") == me
        ]
        requested_at = max(requests, default=None)
        found[f"{pr['url']}@{requested_at}"] = {
            "url": pr["url"], "repo": pr["repository"]["nameWithOwner"], "number": pr["number"],
            "title": pr["title"], "author": (pr["author"] or {}).get("login", "ghost"),
            "requested_at": requested_at, "additions": pr["additions"], "deletions": pr["deletions"],
            "changed_files": pr["changedFiles"],
        }
    return found


def monitored(pr: dict) -> bool:
    owner, name = pr["repo"].split("/")
    try:
        return time.time() - (MONITOR_DIR / f"{owner}__{name}__{pr['number']}.json").stat().st_mtime < MONITOR_LEASE
    except FileNotFoundError:
        return False


def emit(payload: dict) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def load_reported() -> list[str]:
    return json.loads(STATE_PATH.read_text())["reported"] if STATE_PATH.exists() else []


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--filter", default="", help="extra GitHub search qualifiers, e.g. 'org:neiybor -author:app/dependabot'")
    p.add_argument("--interval", type=int, default=120, help="seconds between polls")
    p.add_argument("--dry-run", action="store_true", help="poll once, print unreported PRs, write nothing")
    args = p.parse_args()

    search = f"{BASE_QUERY} {args.filter}".strip()
    STATE_DIR.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        me, nodes = fetch(search)
        current = queue(me, nodes)
        reported = set(load_reported())
        prs = [v for k, v in current.items() if k not in reported and not monitored(v)]
        emit({"status": "dry_run", "prs": prs, "queue": len(current)})
        return 0

    if PID_PATH.exists() and (pid := int(PID_PATH.read_text() or 0)) and pid != os.getpid() and alive(pid):
        emit({"status": "already_watching", "pid": pid})
        return 3
    PID_PATH.write_text(str(os.getpid()))

    def stop(signum, _frame):
        emit({"status": "stopped", "signal": signum})
        PID_PATH.unlink(missing_ok=True)
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    reported = load_reported()
    errors = 0

    try:
        while True:
            try:
                me, nodes = fetch(search)
                errors = 0
            except (subprocess.CalledProcessError, json.JSONDecodeError, KeyError, TypeError) as exc:
                errors += 1
                if errors >= MAX_CONSECUTIVE_ERRORS:
                    detail = exc.stderr.strip() if isinstance(exc, subprocess.CalledProcessError) else repr(exc)
                    emit({"status": "error", "detail": detail[-1000:]})
                    return 1
                time.sleep(min(args.interval * errors, 600))
                continue

            current = queue(me, nodes)
            fresh = {k: v for k, v in current.items() if k not in reported}
            if fresh:
                reported = (reported + list(fresh))[-MAX_REMEMBERED:]
                STATE_PATH.write_text(json.dumps({"reported": reported}))
                if prs := [v for v in fresh.values() if not monitored(v)]:
                    emit({"status": "ready", "prs": prs, "queue": len(current)})
                    return 0

            time.sleep(args.interval)
    finally:
        if PID_PATH.exists() and PID_PATH.read_text() == str(os.getpid()):
            PID_PATH.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
