---
name: babysit-pr
description: Babysit, monitor, or watch a GitHub pull request until it is closed/merged, user help is required, or it reaches the handoff milestone of green CI, mergeable state, and clean review status. Use this whenever the user asks to babysit, monitor, watch, shepherd, or keep an eye on a PR. Accepts an optional PR URL; if omitted, find the open PR for the current branch.
argument-hint: [PR URL]
allowed-tools: Bash(git *), Bash(gh *)
---

# PR Babysitter

Babysit a GitHub pull request by continuously checking review, CI, and mergeability state, handling safe actionable work, and escalating anything that needs user judgment. Do not merge the PR. A green, mergeable, review-clean PR is a handoff milestone, not permission to merge.

## Inputs

- Arguments provided: `$ARGUMENTS`
- If `$ARGUMENTS` includes a PR URL, use that PR.
- If no PR URL is provided, check whether the current branch has an open PR:
  - Get the current branch with `git branch --show-current`.
  - Use `gh pr view --json url,state,number,headRefName,baseRefName` or an equivalent `gh pr status` check.
  - If no open PR exists for the branch, stop and ask the user for a PR URL or branch with an open PR.

## Stop Conditions

Continue babysitting until exactly one of these occurs:

- The PR is merged or closed.
- User help is required.
- Handoff milestone: CI is green, the PR is mergeable, and there are no unresolved actionable review items.

When the handoff milestone is reached, report the state clearly and stop. Do not merge the PR and do not imply that approval to merge has been granted.

## Core Workflow

1. Start the watcher in continuous mode with `--watch` unless intentionally doing a one-shot diagnostic snapshot.
2. Run the watcher script for the target PR and snapshot PR, review, CI, and mergeability state. If the watcher streams JSON snapshots, consume each snapshot as it arrives.
3. Inspect the `actions` list in each JSON response before doing anything else.
4. On every loop, check for newly surfaced review feedback before acting on CI failures or mergeability state.
5. Verify mergeability and merge-conflict status alongside CI, for example with `gh pr view --json mergeable,mergeStateStatus,reviewDecision,state,isDraft`.
6. After any push or CI rerun, immediately return to the watcher loop on the updated SHA/state.

Maintain terminal/session ownership while babysitting is active. Keep consuming watcher output in the same turn. Do not leave a detached `--watch` process running and then end the turn as though monitoring were complete.

## Review Feedback

When `process_review_comment` is present:

- Inspect the surfaced review items.
- If a review item is actionable and clearly correct, patch the code locally, run appropriate focused checks, commit, and push.
- After the fix is on GitHub, mark the associated review thread/comment as resolved.
- If there is any question about whether to implement the requested change, stop and confirm with the user first.
- If a human review item is non-actionable, already addressed, incorrect, or better handled with explanation, surface the item and your recommended response to the user.
- Do not post replies to human-authored review comments or review threads unless the user explicitly confirms the exact response text.

If both actionable review feedback and `retry_failed_checks` are present, prioritize review feedback first. A new commit will retrigger CI, so avoid rerunning flaky checks on the old SHA unless intentionally deferring the review change.

## CI Failures

When `diagnose_ci_failure` is present:

- Inspect failed run logs and classify the failure.
- If the failure is likely caused by the current branch, patch code locally, run relevant checks, commit, and push.
- Do not patch random flaky tests, CI infrastructure failures, dependency outages, runner issues, or failures unrelated to the branch.
- If the failure appears flaky or unrelated and `retry_failed_checks` is present, rerun failed jobs with `--retry-failed-now`.
- If the failure is ambiguous or the safe next action is unclear, stop and ask the user for help.

For flaky CI failures, rerun only the failed jobs when possible. Avoid broad reruns that hide useful signal unless the available tooling cannot retry failed jobs selectively.

## Mergeability

Check mergeability after reviews and CI are handled:

- If the PR has merge conflicts, attempt to resolve them when the resolution is straightforward and local context is sufficient.
- If conflict resolution requires product judgment, broad refactoring, or choosing between competing human-authored changes, stop and ask the user for help.
- If the PR is green, mergeable, and review-clean, report the handoff milestone and stop without merging.

## Committing And Pushing

When making fixes:

- Keep changes minimal and directly tied to the PR babysitting task.
- Do not use `--no-verify` when committing or pushing.
- Use clear commit messages that describe the CI or review fix.
- Push to the PR branch.
- If `--watch` was active before pausing to patch, commit, or push, relaunch `--watch` yourself immediately after pushing.

## User Help Required

Stop and ask the user before continuing when:

- No target PR can be found.
- A review item may or may not be desirable to implement.
- A response to a human review comment/thread is needed.
- CI failure classification is ambiguous and the next action could waste time or introduce risk.
- Merge conflicts require judgment about intended behavior.
- Required credentials, repository permissions, or tooling are missing.

When asking for help, include the current PR URL, the blocker, what you inspected, and the smallest useful decision you need from the user.
