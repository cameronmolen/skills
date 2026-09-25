#!/bin/bash
#
# Run a Ruby file inside a DEPLOYED rails-api pod, in staging or production.
#
# Agent-facing. The user's own console tooling (`make staging-console` -> staging.sh)
# is human-shaped — a confirm prompt, a TTY REPL, and an EXIT trap that tears
# everything down the moment the command returns — so it cannot be driven from here.
#
# You get the real database AND real Redis, so kill switches, feature flags and cache
# state read truthfully. Note that staging.sh MOCKS Redis, so any such result the user
# reports from their own console is meaningless; re-check it through this script.
#
# The pod runs the DEPLOYED image, not your working tree. This cannot exercise
# uncommitted code — use a test for that.
#
# PRODUCTION IS READ-ONLY. Reads are yours to run; writes are the user's. A production
# mutation goes to the user in your reply — written with the rails-console-snippet skill,
# so its dry_run: wrapper lets them preview it — for them to paste into their own console.
# That holds even when they ask you to run it. `bin/rails runner` has no dry-run and no
# undo, so the hand-off is the guardrail.
#
# Usage:
#   ./pod-run.sh staging snippet.rb
#   ./pod-run.sh production snippet.rb
#   echo 'puts Organization.count' | ./pod-run.sh staging
#
# Rails boot noise goes to stderr-ish INFO lines on stdout; filter with:
#   ./pod-run.sh staging s.rb 2>&1 | grep -vE '^[IWDEF], \[|level-experimental'

set -euo pipefail

ENVIRONMENT="${1:?usage: pod-run.sh <staging|production> [file.rb]}"
shift || true

case "$ENVIRONMENT" in
  staging)    AWS_PROFILE_NAME=staging; CONTEXT_MATCH=staging ;;
  production) AWS_PROFILE_NAME=prod;    CONTEXT_MATCH=production ;;
  *) echo "ERROR: environment must be 'staging' or 'production', got '$ENVIRONMENT'" >&2; exit 1 ;;
esac

NAMESPACE="${NAMESPACE:-rails-api}"
SELECTOR="${SELECTOR:-app.kubernetes.io/instance=rails-api}"
SOURCE_PROFILE="${SOURCE_PROFILE:-neiybor}"

die() { echo "[pod-run] ERROR: $*" >&2; exit 1; }

# Read the cached-session TTL out of `aws-vault list` without touching credentials.
# Calling aws-vault with no live session opens a GUI MFA dialog that a headless
# caller cannot answer, and it hangs forever rather than erroring.
ttl=$(aws-vault list 2>/dev/null | awk -v p="$SOURCE_PROFILE" '$1 == p { print $3 }')
[[ -n "$ttl" && "$ttl" != "-" ]] || die "no cached aws-vault session for '$SOURCE_PROFILE'.
    Run this in a terminal where you can answer the MFA prompt:
        aws-vault exec $SOURCE_PROFILE -- aws sts get-caller-identity
    duration_seconds=43200, so one token covers 12 hours."
[[ "$ttl" != -* ]] || die "the aws-vault session for '$SOURCE_PROFILE' expired ($ttl). Re-authenticate as above."

context=$(kubectl config get-contexts -o name 2>/dev/null | grep "$CONTEXT_MATCH" | head -1 || true)
[[ -n "$context" ]] || die "no kubectl context matching '$CONTEXT_MATCH'. Run:
    aws-vault exec $AWS_PROFILE_NAME -- aws eks update-kubeconfig --name neighbor-$ENVIRONMENT-eks --region us-east-1"

pod=$(aws-vault exec "$AWS_PROFILE_NAME" -- kubectl --context "$context" \
  get pods -n "$NAMESPACE" -l "$SELECTOR" --field-selector status.phase=Running \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
[[ -n "$pod" ]] || die "no Running pod matching '$SELECTOR' in namespace '$NAMESPACE' ($ENVIRONMENT).
    For production the aws-vault profile must be 'prod' — 'prodreadonly' fails kubectl auth."

echo "[pod-run] $ENVIRONMENT -> $pod" >&2
[[ "$ENVIRONMENT" != production ]] || echo "[pod-run] production is READ-ONLY — hand any mutation to the user to run" >&2

# `sh`, not `bash`: the rails-api image has no bash. Piping the program in on stdin
# and writing it to a file sidesteps every layer of shell quoting between here and Ruby.
remote="/tmp/pod-run-$$.rb"
run_remote() {
  aws-vault exec "$AWS_PROFILE_NAME" -- kubectl --context "$context" \
    exec -i -n "$NAMESPACE" "$pod" -- sh -c "cat > $remote && bin/rails runner $remote; rc=\$?; rm -f $remote; exit \$rc"
}

if [[ $# -ge 1 && -f "$1" ]]; then
  run_remote < "$1"
else
  run_remote
fi
