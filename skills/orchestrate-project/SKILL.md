---
name: orchestrate-project
description: Drive a Notion project's tickets to merged as one stacked PR chain, unattended once the operator approves the plan. One worker thread per ticket, each branched off the one below it; the orchestrator launches, restacks as the bottom merges, and moves each ticket's Notion status through its lifecycle.
disable-model-invocation: true
argument-hint: <notion-project-url> [bootstrap|tick|status|teardown]
---

# Orchestrate project

Run a Notion project's ticket graph to completion as a single stacked PR chain. Read the project's dependency DAG, agree the plan with the operator, then launch one T3 worker thread per ticket on a branch cut from the branch below it, keep the stack rebased as its bottom merges, and keep Notion's `Status` in step, waking yourself as GitHub changes.

**Arguments:** `$ARGUMENTS` is the Notion project URL, then an optional phase (default `tick`, or `bootstrap` when no ledger exists yet).

## Who does what

|                  | Owns                                                                     | Leaves to others                                   |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| **Orchestrator** | The queue: launches, restacks, Notion `Status`, the ledger               | Code, PRs, and every conversation after bootstrap  |
| **Worker**       | One ticket's branch, its PR, and that PR's babysitting                   | Merging, and every other branch                    |
| **Operator**     | Scope and gates at bootstrap; then each worker directly; every merge     |                                                    |

Bootstrap is where you get in step with the operator. After it you run **unattended**: wake on GitHub, act, re-arm, sleep. The operator talks to each worker in its own thread — "create a PR", review feedback, a rename — and never needs to answer you. Each tick ends with a short report in this thread, a log the operator reads when they choose. Something only a human can resolve, such as a restack conflict, already surfaces in that worker's thread; name it in the report and carry on with everything else.

Merging is human-gated at Neighbor. PRs squash into `staging` on a person's click, so throughput is not yours to raise. Your job is queue management: keep the frontier launched, keep the ledger true, keep Notion honest.

## The stack

Every worker's branch is cut from the branch below it, and every PR targets that branch rather than `staging`. Workers link their PRs into a native GitHub stack with `gh stack link`, so reviewers see the chain. The project ships as one stack, merged bottom-up.

```
staging  <-  ENG-1  <-  ENG-2  <-  ENG-3  <-  ENG-4
             (bottom, the only one mergeable now)
```

This buys three things a fan of parallel PRs against `staging` does not. A worker starts on top of its blocker's real code instead of waiting for it to merge, so the DAG stops serializing the work. Each PR's diff shows only its own ticket, because the base already contains everything beneath it. And no PR ever has to re-litigate a parent's diff, because nothing in the stack is merged out of order.

Three rules hold it together.

- **The stack is launch order, not DAG order.** `project.stack` is the real bottom-to-top array, appended to as each worker launches. A new worker always branches off the current stack tip, whether or not that ticket is one of its blockers. `project.chain`, frozen at bootstrap, is only the _intended_ order and decides what to launch next.
- **A ticket launches only once every blocker is merged or already on the stack.** A blocker that has not launched yet is not in the tip's ancestry, so stacking on the tip would give the worker a base missing code it depends on. `frontier.mjs` reports these as `held_blockers_not_stacked`.
- **Merging the bottom moves the ground under everything above it.** `staging` squashes, so a dependent's branch still carries its parent's pre-squash commits. The whole column above the merge rebases, bottom-to-top, one worker at a time.

`scripts/stack.mjs` owns all of this. Never hand-compute a base branch.

| Command                                         | Does                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `stack.mjs <PLN> view`                          | The stack bottom-to-top, which entry is mergeable now, and `pending_restack`    |
| `stack.mjs <PLN> plan <ENG-####>`               | The branch, base, parent, and `startFromOrigin` for a launch. Read-only         |
| `stack.mjs <PLN> push <ENG-####> --thread <id>` | Appends to the stack and freezes that base. Run right after `t3_thread_launch`  |
| `stack.mjs <PLN> restack <ENG-####>`            | Plans the rebase for every ticket above a merge and parks it on each ticket     |
| `stack.mjs <PLN> restacked <ENG-####>`          | Clears a ticket's parked restack once its worker confirms                       |

**The cost of a stack is that its bottom is a single point of blockage.** An unmerged PR at position 0 holds every PR above it. When the bottom stalls — CI red, changes requested, a gate — say so at the top of the report.

## Notion lifecycle

You own each launched ticket's `Status`, and it moves forward only:

| Move                         | When                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| `Blocked` → `Ready`          | It becomes launchable: every blocker merged or on the stack beneath it |
| `Ready` → `In progress`      | You claim it, immediately before its launch                           |
| `In progress` → `In review`  | Its PR opens                                                          |
| `In review` → `In verification` | Its PR merges                                                      |

`Done` is a human's call after verification. A ticket a human already moved further along, or parked in `Abandoned`, stays where it is.

`frontier.mjs` computes the moves due as `notion_writes`. Apply each with `notion-update-page`, fetch the ticket to verify it, then set `notion_status` in the ledger. A failed write leaves `notion_status` untouched, so the next tick retries it. The claim also sets `Assignee` and `Sprint` — see [`WORKER.md`](WORKER.md#claim-before-launch). A worker's `create-pr` makes the `In review` and `In verification` moves too; because both sides only move forward, whichever lands first wins and the other finds nothing to do.

## The ledger

Your context gets summarized and your session ends. The **ledger** is what survives. It lives at `~/.orchestrate-project/<PLN>/ledger.json`, alongside `dag.json` (the frozen graph), `pr-snapshot.json`, `events.jsonl`, and `waiter.json`.

**Every phase starts by reading the ledger and ends by writing it.** Never reconstruct state from your own memory of earlier in the conversation.

Per-ticket fields: `name`, `notion_id`, `status`, `notion_status`, `blocked_by[]`, `gate`, `thread_id`, `worktree_path`, `branch`, `base_branch`, `stack_index`, `pr_number`, `pr_base`, `restack`, `launched_at`, `last_checked`, `last_read_position`.

`restack` holds a planned rebase waiting on its worker — `{after_merge_of, base_now, command, retarget}` — and clears with `stack.mjs restacked`. It is how a cascade survives a summarized context or a dead session.

Project-level fields include `name`, the Notion project's title; `project_id`, the target repo's T3 project id from `t3_project_list`; `chain` and `stack` from the section above; and `pending_restack`, the merges whose restack is not yet planned.

`status` is orchestrator-owned and distinct from Notion's `Status`:

`queued` → `gated` → `running` → `open` → `merged`, plus `abandoned`.

`base_branch` is the branch this ticket was cut from and the base its PR targets. `pr_base` is what GitHub actually reports for the PR. They diverge whenever a restack has been planned but not yet carried out, and the poller raises `pr_base_drift` once they should have converged.

## Phases

When the operator invokes this skill, whatever the phase, first rename this thread so it reads as the orchestrator in the thread list:

```
t3_thread_update({action: "rename", title: "[ORC] <project name>"})
```

The project name is the Notion project page's title. `bootstrap` reads it in step 1; every other phase reads `project.name` from the ledger, or fetches the page when a ledger from before this field has no `name`. Ticks you run on your own wakes skip the rename, because the title is already set.

Route on the phase argument.

- **`bootstrap`** gets in step with the operator, builds the frozen DAG and ledger from Notion, and starts the run. Read [`NOTION-GRAPH.md`](NOTION-GRAPH.md).
- **`tick`** reconciles, restacks, writes Notion, launches, and re-arms. You run it yourself on every wake; the operator runs it only to restart a run that died. Read [`WORKER.md`](WORKER.md).
- **`status`** prints a read-only summary.
- **`teardown`** reaps worktrees, compose stacks, the waiter, and the heartbeat.

---

## Phase: bootstrap

1. Resolve the project URL to its `PLN-####`, page id, and title, and rename this thread `[ORC] <title>`. Refuse to proceed if `~/.orchestrate-project/<PLN>/ledger.json` already exists. Say so and suggest `tick` instead.

   The default repo is `neiybor/rails-api`. Ask the operator when the project's tickets are tagged for another one.

   Then find the target repo's T3 project in `t3_project_list`, matching its workspace root's `gh repo view --json nameWithOwner` to the repo, and record its id for `bootstrap-ledger.mjs --project-id`. The orchestrator itself can run from any project, within the limits in [`WORKER.md`](WORKER.md).

2. Query the ticket graph and detect gates, following [`NOTION-GRAPH.md`](NOTION-GRAPH.md). That file carries the verified field traps, and the query is wrong without it.

3. Diff `Blocked by` against the project page's Mermaid "Ticket Dependency Graph". They routinely disagree in both directions. **Report every divergence to the operator and reconcile nothing on your own.** The Mermaid often encodes a human gate the relation cannot express, which is signal rather than noise.

4. Pipe the ticket array to `scripts/bootstrap-ledger.mjs`, passing the project's title as `--name`. It mints branch names, rejects cycles, topologically sorts the DAG into `project.chain`, opens an empty `project.stack`, and writes `ledger.json` and `dag.json`.

   The chain is the intended bottom-to-top order of the PR stack. Ties break toward the `5. ` ordering prefix in the ticket names, and gated tickets sort as late as topology allows, because a gate part-way up the stack stalls everything above it.

5. Present the operator with `project.chain` as the proposed stack order, the frontier, every Mermaid divergence, the concurrency cap, and each gated ticket with its evidence. **Ask for each gate's decision now.** This is the last conversation of the run; a gate left open stays unlaunched, along with everything that depends on it, until the operator comes back to this thread to settle it. **Wait for explicit approval of the stack order before launching anything.** The order is frozen once the first worker launches, so this is the one cheap moment to change it.

6. Start the run. Schedule the heartbeat from [`POLLING.md`](POLLING.md), then run the tick, which launches the first workers and starts the waiter. Close by telling the operator the run is live and that from here they talk to the workers, each in its own thread.

Done when the operator has approved, `ledger.json` assigns every ticket a `status`, the first workers are launched, the waiter is running, and the heartbeat is scheduled.

---

## Phase: tick

A tick starts on a wake — the waiter exiting, the heartbeat finding the waiter dead, or the operator restarting the run. Run all five steps in order, every tick. Read [`WORKER.md`](WORKER.md) for the launch contract and the restack move.

1. **Reconcile.** Run `scripts/poll-prs.mjs <PLN>` for one pass. It updates PR state in the ledger, marks merges, and queues each merge with live tickets above it on `pending_restack`.

2. **Restack.** Run `scripts/frontier.mjs <PLN>`. For each id in `pending_restack`, oldest first, run `scripts/stack.mjs <PLN> restack <ENG-####>`, which parks a rebase on every ticket above the merge. Then rerun `frontier.mjs` and work `restack_queue` bottom-to-top, **one worker at a time**: send the parked command, wait for `RESTACKED`, run `stack.mjs <PLN> restacked <ENG-####>`, then move to the next. Each rebase moves the base the next one rebases onto, so sending them together races the whole column. A `RESTACK_BLOCKED` reply stops the cascade there; leave its `restack` in place and name it in the report. Every later tick resumes the queue from its bottom.

   **Send the commands to the worker thread. Never touch a live worker's worktree yourself.** See [`WORKER.md`](WORKER.md#restack-on-merge).

3. **Notion.** Apply every `notion_writes` entry from `frontier.mjs`, per [Notion lifecycle](#notion-lifecycle).

4. **Launch.** From `frontier.mjs`, launch `launch_now` up to the remaining capacity, **in the order it returns**, one at a time: claim the ticket, call `t3_thread_launch`, then run `stack.mjs <PLN> push <ENG-####> --thread <id>` before the next. Each launch changes the stack tip, so the next ticket's base is not knowable until the one before it is recorded.

   **Never launch a `gated` ticket.** A gate clears only when the operator names the ticket and states the decision. A gated ticket that sits below unlaunched work also caps the stack: nothing that depends on it can launch until the gate clears.

5. **Re-arm and report.** Start the waiter per [`POLLING.md`](POLLING.md), unless one is already live. Then report in a few lines: the stack from `frontier.mjs <PLN> --table`, bottom-to-top, marking the entry mergeable now; what this tick changed; and anything stuck — a stalled bottom, a blocked restack, a failed Notion write, a gate. End the turn.

   When nothing is running, open, launchable, or restacking, the run is over: skip the waiter, delete the heartbeat, report what is merged and any gated tickets left, and suggest `teardown`.

Done when the ledger is written, `pending_restack` is empty, `restack_queue` is empty or stopped on a named `RESTACK_BLOCKED`, `notion_writes` is empty or each failure is reported, `launch_now` is launched up to capacity, and a waiter is live.

---

## Phase: status

Read the ledger, run `scripts/frontier.mjs <PLN> --table`, and print it. No network calls, no writes, no launches.

---

## Phase: teardown

Run `scripts/reap.sh <PLN>` to see the plan, then `scripts/reap.sh <PLN> --force` to execute. It removes the project's worktrees, tears down their compose stacks, deletes the `refs/stack-base/*` fork-point refs of terminal tickets, prunes the orphaned Docker networks, and kills the waiter.

Reap only when the stack is empty. A live entry's worktree is skipped, but its `refs/stack-base` ref is what any remaining restack depends on, so tearing down mid-stack strands whatever is left above.

**Teardown is not optional.** Deleting a worktree does not stop its compose stack, and abandoned stacks exhaust Docker's bridge-network pool of roughly 30 until every `make run-test` on the machine dies with `all predefined address pools have been fully subnetted`.

Then delete the heartbeat via `list_scheduled_tasks` and `delete_scheduled_task`, and report which threads are still alive so the operator can close them.

---

## Invariants

- **Cap concurrent workers at 4.** Each worker holds a full compose stack (postgres, redis, localstack, rails) on its own bridge network. Four leaves headroom under the ceiling of roughly 30 networks for the operator's own worktrees. Raise it only after counting `docker network ls`.
- **One worktree per worker, and no cross-worker test lock.** `local-development/get-project-name.sh` derives the compose project name from the worktree's directory basename, so each worktree gets its own Postgres. Concurrent `make run-test` across worktrees is safe. What is not safe is two runs inside one worktree, and one worker owning one worktree makes that impossible by construction.
- **Every change to a live ticket's branch is made by that ticket's worker.** Not by you, and not by a subagent of yours — `delegate_task` returns work to this thread, which owns no branch.
- **Merged means `gh pr view <n> --json state,mergedAt` says so.** Nothing else counts as merged.
- **Merge the stack bottom-up, never out of order.** An entry merged from the middle strands a base for everything below it and squashes its parents' commits into `staging` twice.
- **Every PR targets its `base_branch`, not the repo default.** `gh pr create` defaults to the default branch, so the worker passes `--base` explicitly. A PR silently opened against `staging` shows every parent's diff and cannot be reviewed.
- **Shipped to prod is a grep for a distinctive symbol on `origin/master`.** Never SHA ancestry. `staging` is merged into `master`, so `git merge-base --is-ancestor` returns false for code that is live.
- **Launch every worker with `t3_thread_launch`, the ledger's `projectId`, and an explicit `workspaceStrategy`.** Without the `projectId`, an orchestrator running from another project launches workers into the wrong repo; without the `workspaceStrategy`, they share the main checkout. Both are in [`WORKER.md`](WORKER.md).

## Waking

You wake yourself: a background waiter wakes you when GitHub changes, and a heartbeat restarts the waiter when the session dies. Read [`POLLING.md`](POLLING.md) to arm either.
