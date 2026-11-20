# Waking the orchestrator

T3 Code's `watch_pull_request` cannot be the signal. It wakes a thread for free on checks, comments, and conflicts, but a merge ends the watch silently, and a merge is the event you exist to act on. Workers still use it through `create-pr`, so CI and review feedback reach the thread that owns the branch.

## The waiter

The harness re-invokes a thread when one of its background commands exits. While the run is active, end each tick with a live waiter. Launch it with the Bash tool, `run_in_background: true`, and `timeout: 7200000`, the maximum:

```sh
node <skill-dir>/scripts/poll-prs.mjs <PLN> --wait 300
```

It runs a pass every five minutes at no token cost and exits on the first pass with an actionable event — a merge, a PR opening, a PR closed unmerged, a base drifted off the stack, a layer rewritten under the layers above it, a ticket newly launchable — printing that pass's events. **Its exit is the wake: run a tick.** CI and review events land in `events.jsonl` without waking you, because the owning worker handles them through `create-pr`.

The harness stops the waiter at the timeout. That re-invokes you too, with nothing new: relaunch the waiter and end the turn.

**Run one waiter at a time.** Each pass stamps `waiter.json` with its `pid`, `every_secs`, and `last_poll`. A waiter is live when `ps -p <pid> -o command=` still shows `poll-prs.mjs <PLN>` and `last_poll` is within twice `every_secs`. Launch only when neither holds.

If the session ends, the operator resumes polling with `/orchestrate-project <url> tick` in the orchestrator thread.

### Why two calls and not one

`gh` is already authed on this machine (`GITHUB_TOKEN`, account `cameronmolen`). Each pass makes two bounded `gh pr list` calls and matches `headRefName` against the ledger's minted branch names; a PR that has aged out of both windows gets one exact `gh pr view`. On `neiybor/rails-api`:

| Call                                                | Result                        |
| --------------------------------------------------- | ----------------------------- |
| `--state all --limit 200` with `statusCheckRollup`  | HTTP 504 from the GraphQL API |
| `--state open --limit 100` with `statusCheckRollup` | 3.3s                          |
| `--state merged --limit 100` without rollup         | 0.7s                          |

Open PRs are the only ones whose CI state matters, and merged PRs need nothing but `mergedAt`.

The CI rollup is also fiddlier than it looks. A `CheckRun` reports `status` plus `conclusion`, a `StatusContext` reports `state`, and an in-flight `CheckRun` returns `conclusion: ""` with `status: "IN_PROGRESS"`. Keying on `conclusion || state` alone reads every running job as an empty string and can never resolve to green.
