#!/usr/bin/env python3
"""Wait on a PR without spending tokens; exit once there is something to act on.

    watch-pr.py <pr-url-or-number> [--interval 60] [--settle 300] [--max-ci-wait 1800]
    watch-pr.py <pr> --dry-run     # one poll, print what would be reported, write nothing

Polls GitHub with one GraphQL query per interval and exits, printing one JSON
line, when any of these land:

- the PR is merged or closed                    -> {"status": "merged" | "closed"}
- new or edited feedback from anyone but you    -> {"status": "events", "events": [...]}
  (issue comments, reviews with a body or a verdict, inline thread comments)
- a check fails on the current head             -> same, event type "check_failed"
- the PR starts conflicting with its base       -> same, event type "conflict"

Once something new shows up it keeps polling until the PR has been quiet for
--settle seconds and no check is still running (capped at --max-ci-wait), so a
reviewer leaving five comments, or a bot editing its sticky review comment as it
works, wakes the agent once instead of five times.

What has been reported lives in ~/.local/state/create-pr-watch/, so a relaunch
reports only what is new since the last exit. The first launch for a PR seeds
everything already there as seen. Only one watcher runs per PR: a second launch
prints {"status": "already_watching"} and exits 3.
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

STATE_DIR = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "create-pr-watch"
IGNORED_AUTHORS = {"github-actions", "dependabot", "codecov", "vercel", "netlify", "renovate"}
FAILED_CONCLUSIONS = {"FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"}
FAILED_STATES = {"FAILURE", "ERROR"}
BODY_LIMIT = 600
MAX_CONSECUTIVE_ERRORS = 30

QUERY = """
query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      url state isDraft mergeable mergeStateStatus reviewDecision
      headRefName baseRefName headRefOid baseRefOid
      comments(last: 100) { nodes { databaseId url body createdAt lastEditedAt author { login } } }
      reviews(last: 100) { nodes { databaseId url body state submittedAt lastEditedAt author { login } } }
      reviewThreads(last: 100) {
        nodes {
          id isResolved isOutdated path line
          comments(last: 50) { nodes { databaseId url body createdAt lastEditedAt author { login } } }
        }
      }
      commits(last: 1) {
        nodes { commit { oid statusCheckRollup { contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { databaseId name status conclusion detailsUrl }
          ... on StatusContext { context state targetUrl createdAt }
        } } } } }
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


def checks(pr: dict) -> list[dict]:
    commits = pr["commits"]["nodes"]
    rollup = commits[0]["commit"]["statusCheckRollup"] if commits else None
    return rollup["contexts"]["nodes"] if rollup else []


def is_pending(check: dict) -> bool:
    if check["__typename"] == "CheckRun":
        return check["status"] != "COMPLETED"
    return check["state"] in {"PENDING", "EXPECTED"}


def events(pr: dict, me: str) -> dict[str, dict]:
    """Every reportable item on the PR right now, keyed so that an edit is a new key."""
    found: dict[str, dict] = {}

    def keep(author: str) -> bool:
        return author != me and author not in IGNORED_AUTHORS

    for c in pr["comments"]["nodes"]:
        if keep(a := login(c)):
            found[f"ic:{c['databaseId']}:{c['lastEditedAt']}"] = {
                "type": "comment", "id": c["databaseId"], "author": a, "url": c["url"], "body": trim(c["body"]),
                "edited": bool(c["lastEditedAt"]),
            }

    for r in pr["reviews"]["nodes"]:
        # An empty COMMENTED review is only the envelope for inline comments, which arrive as threads.
        if r["state"] in {"PENDING", "DISMISSED"} or (r["state"] == "COMMENTED" and not (r["body"] or "").strip()):
            continue
        if keep(a := login(r)):
            found[f"rv:{r['databaseId']}:{r['lastEditedAt']}"] = {
                "type": "review", "id": r["databaseId"], "author": a, "state": r["state"], "url": r["url"],
                "body": trim(r["body"]), "edited": bool(r["lastEditedAt"]),
            }

    for t in pr["reviewThreads"]["nodes"]:
        for c in t["comments"]["nodes"]:
            if keep(a := login(c)):
                found[f"tc:{c['databaseId']}:{c['lastEditedAt']}"] = {
                    "type": "thread_comment", "id": c["databaseId"], "thread_id": t["id"], "author": a,
                    "url": c["url"], "path": t["path"], "line": t["line"], "thread_resolved": t["isResolved"],
                    "thread_outdated": t["isOutdated"], "body": trim(c["body"]), "edited": bool(c["lastEditedAt"]),
                }

    head = pr["headRefOid"]
    for c in checks(pr):
        if c["__typename"] == "CheckRun" and c["conclusion"] in FAILED_CONCLUSIONS:
            found[f"ck:{head}:{c['name']}:{c['databaseId']}"] = {
                "type": "check_failed", "name": c["name"], "conclusion": c["conclusion"], "url": c["detailsUrl"],
            }
        elif c["__typename"] == "StatusContext" and c["state"] in FAILED_STATES:
            found[f"ck:{head}:{c['context']}:{c['createdAt']}"] = {
                "type": "check_failed", "name": c["context"], "conclusion": c["state"], "url": c["targetUrl"],
            }

    if pr["mergeable"] == "CONFLICTING":
        found[f"cf:{head}:{pr['baseRefOid']}"] = {"type": "conflict", "base": pr["baseRefName"]}

    return found


def summary(pr: dict) -> dict:
    cs = checks(pr)
    return {
        "url": pr["url"], "state": pr["state"], "head": pr["headRefOid"], "branch": pr["headRefName"],
        "base": pr["baseRefName"], "draft": pr["isDraft"], "mergeable": pr["mergeable"],
        "merge_state": pr["mergeStateStatus"], "review_decision": pr["reviewDecision"],
        "checks": {
            "pending": sum(map(is_pending, cs)),
            "failed": sum(1 for c in cs if c.get("conclusion") in FAILED_CONCLUSIONS or c.get("state") in FAILED_STATES),
            "total": len(cs),
        },
    }


def emit(payload: dict) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def latest_per_item(pending: dict[str, dict]) -> list[dict]:
    """Collapse successive edits of one comment into its newest version."""
    out: dict[str, dict] = {}
    for key, ev in pending.items():
        kind = key.split(":", 1)[0]
        ident = key if kind in {"ck", "cf"} else f"{kind}:{ev['id']}"
        out[ident] = ev
    return list(out.values())


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
    p.add_argument("pr", help="PR URL or number (number resolves against the current repo)")
    p.add_argument("--interval", type=int, default=60, help="seconds between polls")
    p.add_argument("--settle", type=int, default=300, help="quiet seconds required after new activity before exiting")
    p.add_argument("--max-ci-wait", type=int, default=1800, help="longest to hold new activity for running checks")
    p.add_argument("--dry-run", action="store_true", help="poll once, print unseen items, write nothing")
    args = p.parse_args()

    owner, name, number, url = resolve_pr(args.pr)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state_path = STATE_DIR / f"{owner}__{name}__{number}.json"
    pid_path = state_path.with_suffix(".pid")

    if args.dry_run:
        me, pr = fetch(owner, name, number)
        seen = set(json.loads(state_path.read_text())["seen"]) if state_path.exists() else set()
        unseen = {k: v for k, v in events(pr, me).items() if k not in seen}
        emit({"status": "dry_run", "pr": summary(pr), "events": latest_per_item(unseen)})
        return 0

    if pid_path.exists() and (pid := int(pid_path.read_text() or 0)) and pid != os.getpid() and alive(pid):
        emit({"status": "already_watching", "pid": pid, "pr": url})
        return 3
    pid_path.write_text(str(os.getpid()))

    def stop(signum, _frame):
        emit({"status": "stopped", "signal": signum, "pr": url})
        pid_path.unlink(missing_ok=True)
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    seen: set[str] | None = set(json.loads(state_path.read_text())["seen"]) if state_path.exists() else None
    pending: dict[str, dict] = {}
    first_new = last_new = 0.0
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
                emit({"status": pr["state"].lower(), "pr": summary(pr), "events": latest_per_item(pending)})
                return 0

            current = events(pr, me)
            if seen is None:  # first launch for this PR: everything already here is known
                seen = set(current)
                state_path.write_text(json.dumps({"pr": url, "seen": sorted(seen)}))

            now = time.time()
            fresh = {k: v for k, v in current.items() if k not in seen and k not in pending}
            if fresh:
                pending.update(fresh)
                first_new = first_new or now
                last_new = now

            if pending:
                quiet = now - last_new >= args.settle
                ci_done = not any(map(is_pending, checks(pr))) or now - first_new >= args.max_ci_wait
                if quiet and ci_done:
                    seen |= set(pending)
                    state_path.write_text(json.dumps({"pr": url, "seen": sorted(seen)}))
                    emit({"status": "events", "pr": summary(pr), "events": latest_per_item(pending)})
                    return 0

            time.sleep(args.interval)
    finally:
        if pid_path.exists() and pid_path.read_text() == str(os.getpid()):
            pid_path.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
