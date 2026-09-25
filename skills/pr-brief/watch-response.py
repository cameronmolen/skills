#!/usr/bin/env python3
"""Wait for a PR's author to respond to your review without spending tokens.

    watch-response.py <pr-url-or-number> [--interval 60] [--settle 600]
    watch-response.py <pr> --dry-run     # one poll, print what would be reported, write nothing
    watch-response.py <pr> --done        # end monitoring: stop a live watcher, drop the state

Polls GitHub with one GraphQL query per interval and exits, printing one JSON
line, when the author responds:

- the PR is merged or closed                     -> {"status": "merged" | "closed"}
- you are re-requested as a reviewer             -> {"status": "events", "events": [...]} at once
- every thread you started is resolved           -> same, at once
- new commits, a reply on a thread you started,  -> same, once the PR has been quiet for --settle
  or a top-level comment from the author            seconds, so a burst of pushes wakes you once

Monitoring state lives in ~/.local/state/pr-brief-watch/ from the first launch
until the PR merges or closes, or --done ends it. The first launch seeds everything
already on the PR as seen, so launch it right after posting the review. A relaunch
reports only what is new since the last exit. While the state is fresh (touched on
every poll), watch-review-requests leaves this PR's re-requests to this watcher.
Only one watcher runs per PR: a second launch prints {"status": "already_watching"}
and exits 3.
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

STATE_DIR = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "pr-brief-watch"
IGNORED_AUTHORS = {"github-actions", "dependabot", "codecov", "vercel", "netlify", "renovate"}
URGENT = {"re_requested"}
BODY_LIMIT = 600
MAX_CONSECUTIVE_ERRORS = 30

QUERY = """
query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      url state headRefOid author { login }
      comments(last: 50) { nodes { databaseId url body lastEditedAt author { login } } }
      reviewThreads(last: 100) {
        nodes {
          id isResolved path line
          opener: comments(first: 1) { nodes { url author { login } } }
          comments(last: 30) { nodes { databaseId url body lastEditedAt author { login } } }
        }
      }
      timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 20) {
        nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } } } }
      }
    }
  }
}
"""


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def resolve_pr(target: str) -> tuple[str, str, int, str]:
    info = json.loads(gh("pr", "view", target, "--json", "url,number"))
    owner, name = info["url"].split("github.com/")[1].split("/")[:2]
    return owner, name, info["number"], info["url"]


def fetch(owner: str, name: str, number: int) -> tuple[str, dict]:
    out = gh("api", "graphql", "-f", f"query={QUERY}", "-F", f"owner={owner}", "-F", f"name={name}", "-F", f"number={number}")
    data = json.loads(out)["data"]
    return data["viewer"]["login"], data["repository"]["pullRequest"]


def login(node: dict) -> str:
    return ((node.get("author") or {}).get("login") or "ghost").removesuffix("[bot]")


def trim(body: str) -> str:
    body = (body or "").strip()
    return body if len(body) <= BODY_LIMIT else body[:BODY_LIMIT] + "…"


def my_threads(pr: dict, me: str) -> list[dict]:
    return [t for t in pr["reviewThreads"]["nodes"] if t["opener"]["nodes"] and login(t["opener"]["nodes"][0]) == me]


def events(pr: dict, me: str) -> dict[str, dict]:
    """Every author response on the PR right now, keyed so that an edit is a new key."""
    found: dict[str, dict] = {f"push:{pr['headRefOid']}": {"type": "pushed", "head": pr["headRefOid"]}}

    for t in my_threads(pr, me):
        where = {"thread_id": t["id"], "path": t["path"], "line": t["line"]}
        if t["isResolved"]:
            found[f"rs:{t['id']}"] = {"type": "resolved", "url": t["opener"]["nodes"][0]["url"], **where}
        for c in t["comments"]["nodes"]:
            if (a := login(c)) != me and a not in IGNORED_AUTHORS:
                found[f"tc:{c['databaseId']}:{c['lastEditedAt']}"] = {
                    "type": "reply", "id": c["databaseId"], "author": a, "url": c["url"], "body": trim(c["body"]), **where,
                }

    author = login(pr)
    for c in pr["comments"]["nodes"]:
        if login(c) == author:
            found[f"ic:{c['databaseId']}:{c['lastEditedAt']}"] = {
                "type": "comment", "id": c["databaseId"], "author": author, "url": c["url"], "body": trim(c["body"]),
            }

    for e in pr["timelineItems"]["nodes"]:
        if (e.get("requestedReviewer") or {}).get("login") == me:
            found[f"rr:{e['createdAt']}"] = {"type": "re_requested", "at": e["createdAt"]}

    return found


def summary(pr: dict, me: str) -> dict:
    threads = my_threads(pr, me)
    resolved = sum(t["isResolved"] for t in threads)
    return {
        "url": pr["url"], "state": pr["state"], "head": pr["headRefOid"],
        "my_threads": {"open": len(threads) - resolved, "resolved": resolved},
    }


def emit(payload: dict) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def latest_per_item(pending: dict[str, dict]) -> list[dict]:
    """Collapse successive edits of one comment into its newest version."""
    out: dict[str, dict] = {}
    for key, ev in pending.items():
        kind = key.split(":", 1)[0]
        out[f"{kind}:{ev['id']}" if kind in {"tc", "ic"} else key] = ev
    return list(out.values())


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def live_pid(pid_path: Path) -> int | None:
    pid = int(pid_path.read_text() or 0) if pid_path.exists() else 0
    return pid if pid and pid != os.getpid() and alive(pid) else None


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("pr", help="PR URL or number (number resolves against the current repo)")
    p.add_argument("--interval", type=int, default=60, help="seconds between polls")
    p.add_argument("--settle", type=int, default=600, help="quiet seconds required after a response before exiting")
    p.add_argument("--dry-run", action="store_true", help="poll once, print unseen responses, write nothing")
    p.add_argument("--done", action="store_true", help="end monitoring: stop a live watcher and drop the state")
    args = p.parse_args()

    owner, name, number, url = resolve_pr(args.pr)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state_path = STATE_DIR / f"{owner}__{name}__{number}.json"
    pid_path = state_path.with_suffix(".pid")

    if args.done:
        # Drop the state before signalling, so the watcher reports "done" rather than "stopped".
        state_path.unlink(missing_ok=True)
        if pid := live_pid(pid_path):
            os.kill(pid, signal.SIGTERM)
        emit({"status": "done", "pr": url})
        return 0

    if args.dry_run:
        me, pr = fetch(owner, name, number)
        seen = set(json.loads(state_path.read_text())["seen"]) if state_path.exists() else set()
        unseen = {k: v for k, v in events(pr, me).items() if k not in seen}
        emit({"status": "dry_run", "pr": summary(pr, me), "events": latest_per_item(unseen)})
        return 0

    if pid := live_pid(pid_path):
        emit({"status": "already_watching", "pid": pid, "pr": url})
        return 3
    pid_path.write_text(str(os.getpid()))

    def stop(signum, _frame):
        emit({"status": "stopped", "signal": signum, "pr": url} if state_path.exists() else {"status": "done", "pr": url})
        pid_path.unlink(missing_ok=True)
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    seen: set[str] | None = set(json.loads(state_path.read_text())["seen"]) if state_path.exists() else None
    pending: dict[str, dict] = {}
    last_new = 0.0
    errors = 0

    try:
        while True:
            try:
                me, pr = fetch(owner, name, number)
                errors = 0
            except (subprocess.CalledProcessError, json.JSONDecodeError, KeyError, TypeError) as exc:
                errors += 1
                if errors >= MAX_CONSECUTIVE_ERRORS:
                    detail = exc.stderr.strip() if isinstance(exc, subprocess.CalledProcessError) else repr(exc)
                    emit({"status": "error", "pr": url, "detail": detail[-1000:]})
                    return 1
                time.sleep(min(args.interval * errors, 600))
                continue

            if pr["state"] in {"MERGED", "CLOSED"}:
                state_path.unlink(missing_ok=True)
                emit({"status": pr["state"].lower(), "pr": summary(pr, me), "events": latest_per_item(pending)})
                return 0

            current = events(pr, me)
            if seen is None:  # first launch for this PR: everything already here is known
                seen = set(current)
                state_path.write_text(json.dumps({"pr": url, "seen": sorted(seen)}))
            elif not state_path.exists():  # --done raced this poll
                emit({"status": "done", "pr": url})
                return 0
            else:
                os.utime(state_path)  # heartbeat for watch-review-requests

            now = time.time()
            fresh = {k: v for k, v in current.items() if k not in seen and k not in pending}
            if fresh:
                pending.update(fresh)
                last_new = now

            if pending:
                threads = summary(pr, me)["my_threads"]
                urgent = any(ev["type"] in URGENT for ev in pending.values()) or (
                    threads["resolved"] and not threads["open"]
                )
                if urgent or now - last_new >= args.settle:
                    seen |= set(pending)
                    state_path.write_text(json.dumps({"pr": url, "seen": sorted(seen)}))
                    emit({"status": "events", "pr": summary(pr, me), "events": latest_per_item(pending)})
                    return 0

            time.sleep(args.interval)
    finally:
        if pid_path.exists() and pid_path.read_text() == str(os.getpid()):
            pid_path.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
