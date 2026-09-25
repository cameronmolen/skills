# The tick loop

Set this up once, during bootstrap.

## The constraint nothing works around

**Nothing available can wake a model without spending tokens.** A launchd script cannot push a message into a T3 thread. There is no `t3` CLI on the machine (checked: `t3`, `t3-code`, `~/.local/bin`, the app bundle). There is a local server descriptor at `~/.t3/dev/server-runtime.json` carrying a host and port, but its API is undocumented and unversioned, so building the loop on it would break silently on any nightly.

Token efficiency therefore comes from making the polling free and the wakes rare, not from eliminating wakes. Both designs below accept that. They differ in who does the waking.

## Primary: launchd poller plus operator tick

Zero tokens while idle. The operator is the wake signal, which costs nothing and is honest about the fact that the default launch mode already waits on them.

- `scripts/poll-prs.mjs` runs every 10 minutes under launchd. `gh` is already authed on this machine (`GITHUB_TOKEN`, account `cameronmolen`), and `node` and `jq` are present.
- It makes two bounded `gh pr list` calls and matches `headRefName` against the ledger's minted branch names. A PR that has aged out of both windows gets one exact `gh pr view`.
- It diffs against `pr-snapshot.json`, recomputes the frontier locally from the frozen DAG, and appends only actionable edges to `events.jsonl`: a merge that leaves a column of the stack needing a restack, a PR whose base has drifted off the stack, CI gone red, review comments landed, a ticket newly launchable, a worker gone stale. A green PR above the stack floor is filed as `stack_green` and is not actionable, because only the floor can be merged.
- On an actionable edge it writes `WAKE` and fires a macOS notification. **A merge with no dependents costs nothing and raises nothing.**
- The operator sees the notification and runs `/orchestrate-project <url> tick`. The tick reads `events.jsonl`, so the model arrives already knowing what changed.

### Why two calls and not one

Measured 2026-08-26 on `neiybor/rails-api`:

| Call                                                | Result                        |
| --------------------------------------------------- | ----------------------------- |
| `--state all --limit 200` with `statusCheckRollup`  | HTTP 504 from the GraphQL API |
| `--state open --limit 100` with `statusCheckRollup` | 3.3s                          |
| `--state merged --limit 100` without rollup         | 0.7s                          |

So the poller runs the two fast calls. Open PRs are the only ones whose CI state matters, and merged PRs need nothing but `mergedAt`.

The CI rollup is also fiddlier than it looks. A `CheckRun` reports `status` plus `conclusion`, a `StatusContext` reports `state`, and an in-flight `CheckRun` returns `conclusion: ""` with `status: "IN_PROGRESS"`. Keying on `conclusion || state` alone reads every running job as an empty string and can never resolve to green.

### Install

```sh
PLN=PLN-3716
mkdir -p ~/.orchestrate-project/$PLN
sed "s|__PLN__|$PLN|g; s|__SKILL_DIR__|$PWD|g; s|__HOME__|$HOME|g; s|__NODE__|$(which node)|g; s|__GH_DIR__|$(dirname $(which gh))|g" \
  com.neighbor.orchestrate-project.plist.tmpl \
  > ~/Library/LaunchAgents/com.neighbor.orchestrate-project.$PLN.plist
launchctl load ~/Library/LaunchAgents/com.neighbor.orchestrate-project.$PLN.plist
```

`__NODE__` and `__GH_DIR__` are substituted with absolute paths deliberately. launchd gives the job a bare environment: `node` comes from nvm and `gh` from homebrew, neither of which is on `PATH` outside an interactive shell. `poll-prs.mjs` spawns `gh` by name, so a plist without the `PATH` in `EnvironmentVariables` fails every run with `spawnSync gh ENOENT` — silently, since the failure only lands in `events.jsonl`.

`scripts/reap.sh` unloads and removes it. Logs land in `~/.orchestrate-project/<PLN>/poller.log`.

## Thread-bound child-progress heartbeat

Use this when the run must proceed unattended, which is exactly the `--auto-launch` case, since nobody is watching for the notification. It is also the right choice if launchd is unavailable, or if the project is short enough that setup is not worth it.

```
schedule_task({
  prompt: "Scheduled child-progress heartbeat for /orchestrate-project <url>. Read ~/.orchestrate-project/<PLN>/ledger.json. For every ticket with status running, read its recorded thread_id with t3_thread_read using view='messages', a bounded limit, and last_read_position. Update last_checked and last_read_position in the ledger. Look for DONE, RESTACKED, questions, blockers, errors, or meaningful progress. Run the normal tick reconciliation only when the child-thread evidence requires action. If nothing changed, reply exactly HEARTBEAT_IDLE.",
  schedule: {type: "interval", everyMs: 600000},
  bindToCurrentThread: true,
  title: "orchestrate <PLN> child progress"
})
```

Pass `schedule` as a structured object, never as JSON text.

**`bindToCurrentThread: true` is mandatory here, not a preference.** Cross-project read and steer resolve only for threads the caller created, so a fresh thread per run created none of the workers and can reach none of them. It would wake up unable to do the one thing it woke for.

The ten-minute interval is intentional. The heartbeat reads only active workers, incrementally from each ticket's `last_read_position`, and leaves PR and CI polling to the launchd poller. It should not use the `WAKE` file as a gate, because its job is to notice child-thread progress even when GitHub has not changed. Run both under `--auto-launch`: the poller watches GitHub, and the heartbeat watches worker conversations.

Report the returned `nextRunAt` to the operator. Clean it up in teardown via `list_scheduled_tasks` and `delete_scheduled_task`.

## Not `CronCreate`

Session-only, 7-day expiry, fires only while the REPL is idle, and every fire costs tokens. It cannot survive the session, which is the one thing this loop must do.
