# Waking the orchestrator

After bootstrap nobody ticks you. Two mechanisms wake you, and bootstrap arms both: the **waiter** wakes you when GitHub changes, and the **heartbeat** revives the waiter when the session dies.

T3 Code's `watch_pull_request` cannot be the signal. It wakes a thread for free on checks, comments, and conflicts, but a merge ends the watch silently, and a merge is the event you exist to act on. Workers still use it through `create-pr`, so CI and review feedback reach the thread that owns the branch.

## The waiter

The harness re-invokes a thread when one of its background commands exits. The waiter turns that into a free GitHub watch. End every tick by launching it with the Bash tool, `run_in_background: true`, and `timeout: 7200000`, the maximum:

```sh
node <skill-dir>/scripts/poll-prs.mjs <PLN> --wait 300
```

It runs a pass every five minutes at no token cost and exits on the first pass with an actionable event — a merge, a PR opening, a PR closed unmerged, a base drifted off the stack, a ticket newly launchable — printing that pass's events. **Its exit is the wake: run a tick.** CI and review events land in `events.jsonl` without waking you, because the owning worker handles them through `create-pr`.

The harness stops the waiter at the timeout. That re-invokes you too, with nothing new: relaunch the waiter and end the turn.

**Run one waiter at a time.** Each pass stamps `waiter.json` with its `pid`, `every_secs`, and `last_poll`. A waiter is live when `ps -p <pid> -o command=` still shows `poll-prs.mjs <PLN>` and `last_poll` is within twice `every_secs`. Launch only when neither holds.

### Why two calls and not one

`gh` is already authed on this machine (`GITHUB_TOKEN`, account `cameronmolen`). Each pass makes two bounded `gh pr list` calls and matches `headRefName` against the ledger's minted branch names; a PR that has aged out of both windows gets one exact `gh pr view`. On `neiybor/rails-api`:

| Call                                                | Result                        |
| --------------------------------------------------- | ----------------------------- |
| `--state all --limit 200` with `statusCheckRollup`  | HTTP 504 from the GraphQL API |
| `--state open --limit 100` with `statusCheckRollup` | 3.3s                          |
| `--state merged --limit 100` without rollup         | 0.7s                          |

Open PRs are the only ones whose CI state matters, and merged PRs need nothing but `mergedAt`.

The CI rollup is also fiddlier than it looks. A `CheckRun` reports `status` plus `conclusion`, a `StatusContext` reports `state`, and an in-flight `CheckRun` returns `conclusion: ""` with `status: "IN_PROGRESS"`. Keying on `conclusion || state` alone reads every running job as an empty string and can never resolve to green.

## The heartbeat

The waiter dies with the session: an app restart, a crash, a closed thread. A thread-bound scheduled task brings it back. Schedule it once, during bootstrap:

```
schedule_task({
  prompt: "Heartbeat for /orchestrate-project <url>. Read ~/.orchestrate-project/<PLN>/waiter.json. If its last_poll is within 15 minutes, reply exactly HEARTBEAT_IDLE. Otherwise the waiter is dead: run a tick, which relaunches it.",
  schedule: {type: "interval", everyMs: 3600000},
  bindToCurrentThread: true,
  title: "orchestrate <PLN> heartbeat"
})
```

Pass `schedule` as a structured object, never as JSON text.

**`bindToCurrentThread: true` is mandatory here, not a preference.** An unbound run starts a fresh thread in a new worktree cut from `main`, a branch rails-api does not use, carrying none of this thread's context. A bound run lands here, beside the conversation that launched the workers.

An hour bounds how long a dead session can stall the stack, and a live waiter makes each heartbeat a one-line reply. Report the returned `nextRunAt` to the operator. Delete it when the run ends or at teardown, via `list_scheduled_tasks` and `delete_scheduled_task`.

## Ruled out

- **A launchd poller** cannot push a message into a T3 thread; it could only notify the operator, who no longer ticks the run.
- **`CronCreate`** is session-only, expires in 7 days, fires only while the REPL is idle, and spends tokens on every fire.
