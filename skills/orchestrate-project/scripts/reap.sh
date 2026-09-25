#!/usr/bin/env bash
# Reap a project's worktrees, compose stacks, and poller.
#
#   ./reap.sh <PLN>           # dry run, prints exactly what it would do
#   ./reap.sh <PLN> --force   # actually does it
#
# Deleting a worktree does NOT stop its compose stack. Abandoned stacks exhaust
# Docker's bridge-network pool (~30) until every make run-test on the machine
# dies with "all predefined address pools have been fully subnetted".
set -euo pipefail

PLN="${1:-}"
FORCE="${2:-}"
[ -n "$PLN" ] || { echo "usage: reap.sh <PLN> [--force]" >&2; exit 2; }

LEDGER="$HOME/.orchestrate-project/$PLN/ledger.json"
[ -f "$LEDGER" ] || { echo "no ledger at $LEDGER" >&2; exit 1; }

CHECKOUT="$(jq -r '.project.checkout' "$LEDGER")"
run() { if [ "$FORCE" = "--force" ]; then echo "+ $*"; "$@" || true; else echo "  would run: $*"; fi; }

echo "== worktrees =="
# Only reap terminal tickets. A running or open ticket still owns its worktree.
jq -r '.tickets | to_entries[]
       | select(.value.worktree_path != null)
       | select(.value.status == "merged" or .value.status == "abandoned")
       | "\(.key)\t\(.value.worktree_path)"' "$LEDGER" |
while IFS=$'\t' read -r id path; do
  [ -n "$path" ] || continue
  echo "-- $id  $path"
  if [ -d "$path" ]; then
    dirty="$(git -C "$path" status --porcelain 2>/dev/null | head -1 || true)"
    if [ -n "$dirty" ]; then echo "  SKIP: uncommitted changes present"; continue; fi
    project="$(basename "$path" | tr '[:upper:]' '[:lower:]' | tr '.' '_')-dev"
    run docker compose -p "$project" -f "$path/local-development/docker/docker-compose.yml" down -v --remove-orphans
    run git -C "$CHECKOUT" worktree remove "$path" --force
  else
    echo "  directory already gone"
    project="$(basename "$path" | tr '[:upper:]' '[:lower:]' | tr '.' '_')-dev"
    run docker compose -p "$project" down -v --remove-orphans
  fi
done

echo "== stack-base refs =="
# refs/stack-base/<branch> is the fork point each worker records before its first
# commit. Shared across worktrees, so removing a worktree leaves the ref behind.
jq -r '.tickets | to_entries[]
       | select(.value.status == "merged" or .value.status == "abandoned")
       | .value.branch' "$LEDGER" |
while read -r branch; do
  [ -n "$branch" ] || continue
  if git -C "$CHECKOUT" show-ref --quiet "refs/stack-base/$branch"; then
    run git -C "$CHECKOUT" update-ref -d "refs/stack-base/$branch"
  fi
done

echo "== stale networks =="
run git -C "$CHECKOUT" worktree prune
run docker network prune -f

echo "== poller =="
PLIST="$HOME/Library/LaunchAgents/com.neighbor.orchestrate-project.$PLN.plist"
if [ -f "$PLIST" ]; then
  run launchctl unload "$PLIST"
  run rm "$PLIST"
else
  echo "  no plist at $PLIST"
fi

echo
echo "Networks now in use: $(docker network ls -q 2>/dev/null | wc -l | tr -d ' ') (pool is ~30)"
[ "$FORCE" = "--force" ] || echo "DRY RUN. Nothing changed. Re-run with --force."
echo "Still to do by hand: delete the scheduled task (list_scheduled_tasks -> delete_scheduled_task) and close the worker threads."
