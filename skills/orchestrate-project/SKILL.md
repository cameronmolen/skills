---
name: orchestrate-project
description: Drive a Notion project's tickets to merged as one stacked PR chain. One worker thread per ticket, each branched off the one below it, polled and restacked as the bottom merges.
disable-model-invocation: true
argument-hint: <notion-project-url> [bootstrap|tick|status|teardown] [--auto-launch]
---

# Orchestrate project

Run a Notion project's ticket graph to completion as a single stacked PR chain. Read the project's dependency DAG, launch one T3 worker thread per ticket on a branch cut from the branch below it, and keep the stack rebased as its bottom merges.

**Arguments:** `$ARGUMENTS` is the Notion project URL, then an optional phase (default `tick`, or `bootstrap` when no ledger exists yet), then optional `--auto-launch`.

## Division of labor

Two different terminal states. Confusing them wastes more work than any other mistake here.

|                   | Terminal state                                                | Never does                          |
| ----------------- | ------------------------------------------------------------- | ----------------------------------- |
| **Worker thread** | Implementation complete, report sent, waiting for PR approval | Merge or open a PR without approval |
| **Orchestrator**  | Every ticket merged into `staging`                            | Write code                          |

Merging is human-gated at Neighbor. PRs squash into `staging` on a person's click, so throughput is not yours to raise. Your job is queue management. Keep the frontier launched, keep the ledger true, and put what needs a human in front of the human in one legible list.

## Relay operator requests

Mid-run the operator will ask for things: rebase every branch, add a test to three tickets, rename a method everywhere. Each one is a relay to the workers that own the branches, not work for you. They hold the worktrees and the context; you hold the queue.

Resolve the affected tickets from the ledger, then send one message per worker. Anything touching branch history goes bottom-to-top, one worker at a time, waiting for each to confirm — `scripts/stack.mjs` knows that order. Independent edits go out at once. **The relay is done when every worker has confirmed, not when the messages are sent.** [`WORKER.md`](WORKER.md) has the message shape.

## The stack

Every worker's branch is cut from the branch below it, and every PR targets that branch rather than `staging`. The project ships as one stack, merged bottom-up.

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

| Command                                         | Does                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `stack.mjs <PLN> view`                          | The stack bottom-to-top, and which entry is mergeable now                     |
| `stack.mjs <PLN> plan <ENG-####>`               | The branch, base branch, and `startFromOrigin` for a launch. Read-only        |
| `stack.mjs <PLN> push <ENG-####> --thread <id>` | Appends to the stack and freezes that base. Run right after `t3_thread_start` |
| `stack.mjs <PLN> restack [<ENG-####>]`          | The ordered rebase plan after a merge, one exact command per worker           |

**The cost of a stack is that its bottom is a single point of blockage.** An unmerged PR at position 0 holds every PR above it. When the bottom stalls — CI red, changes requested, a gate — say so at the top of the report, because it is the one merge that unblocks the whole project.

## The ledger

Your context gets summarized and your session ends. The **ledger** is what survives. It lives at `~/.orchestrate-project/<PLN>/ledger.json`, alongside `dag.json` (the frozen graph), `pr-snapshot.json`, `events.jsonl`, and `WAKE`.

**Every phase starts by reading the ledger and ends by writing it.** Never reconstruct state from your own memory of earlier in the conversation.

Per-ticket fields: `name`, `notion_id`, `status`, `notion_status`, `blocked_by[]`, `gate`, `thread_id`, `worktree_path`, `branch`, `base_branch`, `stack_index`, `pr_number`, `pr_base`, `relay`, `launched_at`, `last_checked`, `last_read_position`.

`relay` holds the request currently out with that worker — `{token, request, sent_at}` — and clears when the worker replies with the token. It is how a relay survives a summarized context.

Project-level fields include `project_id`, the target project's id from `orchestrator_capabilities`, plus `chain` and `stack` from the section above.

Write `thread_id` and `launched_at` the moment `t3_thread_start` returns. Staleness is measured from `launched_at`, and **`t3_thread_list` cannot see workers in another project**, so a worker whose id you failed to record is unreachable with no way to enumerate it back.

`status` is orchestrator-owned and distinct from Notion's `Status`:

`queued` → `gated` → `running` → `open` → `merged`, plus `zombie` and `abandoned`.

`base_branch` is the branch this ticket was cut from and the base its PR targets. `pr_base` is what GitHub actually reports for the PR. They diverge whenever a restack has been planned but not yet carried out, and the poller raises `pr_base_drift` once they should have converged.

## Phases

Route on the phase argument. Each phase is self-contained. Run one, report, stop.

An operator request between ticks is not a phase. Relay it, then carry on.

- **`bootstrap`** builds the frozen DAG and ledger from Notion, confirmed with the operator. Read [`NOTION-GRAPH.md`](NOTION-GRAPH.md).
- **`tick`** reconciles, restacks, launches, reports. Read [`WORKER.md`](WORKER.md).
- **`status`** prints a read-only summary.
- **`teardown`** reaps worktrees, compose stacks, the poller, and any scheduled task.

---

## Phase: bootstrap

1. Resolve the project URL to its `PLN-####` and page id. Refuse to proceed if `~/.orchestrate-project/<PLN>/ledger.json` already exists. Say so and suggest `tick` instead.

   Then call `orchestrator_capabilities` and pick the target repo's `projectId` from its `projects` array. A result with no `projects` array means the running build predates cross-project launch, so say so and fall back to running from the target project.

   The default repo is `neiybor/rails-api`. Ask the operator when the project's tickets are tagged for another one.

2. Query the ticket graph and detect gates, following [`NOTION-GRAPH.md`](NOTION-GRAPH.md). That file carries the verified field traps, and the query is wrong without it.

3. Diff `Blocked by` against the project page's Mermaid "Ticket Dependency Graph". They routinely disagree in both directions. **Report every divergence to the operator and reconcile nothing on your own.** The Mermaid often encodes a human gate the relation cannot express, which is signal rather than noise.

4. Pipe the ticket array to `scripts/bootstrap-ledger.mjs`. It mints branch names, rejects cycles, topologically sorts the DAG into `project.chain`, opens an empty `project.stack`, and writes `ledger.json` and `dag.json`.

   The chain is the intended bottom-to-top order of the PR stack. Ties break toward the `5. ` ordering prefix in the ticket names, and gated tickets sort as late as topology allows, because a gate part-way up the stack stalls everything above it.

5. Present the operator with `project.chain` as the proposed stack order, the frontier, the gated tickets and the evidence for each gate, every Mermaid divergence, and the concurrency cap. **Wait for explicit approval of the stack order before launching anything.** The order is frozen once the first worker launches, so this is the one cheap moment to change it.

Done when the operator has approved and `ledger.json` exists with every ticket assigned a `status`.

---

## Phase: tick

Run all four steps in order, every tick. Read [`WORKER.md`](WORKER.md) for the launch contract, the restack move, and zombie handling.

1. **Reconcile.** Run `scripts/poll-prs.mjs <PLN>`. It updates PR state in the ledger and appends to `events.jsonl`. For every ledger ticket whose `status` is `merged` but whose `notion_status` is not `Done`, set the Notion ticket's `Status` to `Done`, verify the write, and update `notion_status` in the ledger. A failed write stays pending for the next tick and goes in the human-ask list. Then check each `running` worker for staleness.

2. **Restack.** For each ticket that just merged, run `scripts/stack.mjs <PLN> restack <ENG-####>`. It returns one entry per ticket above the merge, bottom-to-top, each carrying the exact rebase command and, where the base name changed, the `gh pr edit --base` retarget.

   **Work that list strictly in order, one worker at a time.** Send entry N's commands to its thread and wait for it to confirm the force-push before sending entry N+1, because each rebase moves the base the next one rebases onto. Sending them at once races the whole column.

   **Send the commands to the worker thread. Never touch a live worker's worktree yourself.** See [`WORKER.md`](WORKER.md).

3. **Launch.** Run `scripts/frontier.mjs <PLN>` for the launchable set and remaining capacity, then branch on the launch mode.
   - Default, operator-gated: list what is launchable and stop. Launch nothing.
   - `--auto-launch`: launch up to the remaining capacity.

   **Launch in the order `frontier.mjs` returns**, one at a time, and run `stack.mjs <PLN> push <ENG-####> --thread <id>` after each `t3_thread_start` returns. Each launch changes the stack tip, so the next ticket's base is not knowable until the one before it is recorded. `frontier.mjs` reports only the first entry's base for that reason.

   Either way, **never launch a `gated` ticket.** A gate clears only when the operator says so, by name. A gated ticket that sits below unlaunched work also caps the stack: nothing that depends on it can launch until the gate clears.

   **Claim each ticket you actually launch.** Immediately before `t3_thread_start`, set its Notion `Status` to `In progress`, `Assignee` to `Cameron Molen`, and `Sprint` to the current active Host sprint. Claim only tickets you are about to launch, never the whole launchable list. See [`WORKER.md`](WORKER.md).

4. **Report.** Lead with the stack from `scripts/frontier.mjs <PLN> --table`, bottom-to-top, marking the entry that is mergeable now. Then one table: merged since last tick, open awaiting merge, running, launchable, held, gated, zombie, outstanding `relay`. Then the ask, naming the specific decisions and merges only a human can do.

   **The bottom of the stack leads the ask.** Merging it is the single action that moves everything else, so name it first and say what it is waiting on.

Done when the ledger is written, the report shows the stack in merge order, and it names every ticket that needs a human.

---

## Phase: status

Read the ledger, run `scripts/frontier.mjs <PLN> --table`, print the same stack and table as `tick` step 4. No network calls, no writes, no launches.

---

## Phase: teardown

Run `scripts/reap.sh <PLN>` to see the plan, then `scripts/reap.sh <PLN> --force` to execute. It removes the project's worktrees, tears down their compose stacks, deletes the `refs/stack-base/*` fork-point refs of terminal tickets, prunes the orphaned Docker networks, and unloads the launchd poller.

Reap only when the stack is empty. A live entry's worktree is skipped, but its `refs/stack-base` ref is what any remaining restack depends on, so tearing down mid-stack strands whatever is left above.

**Teardown is not optional.** Deleting a worktree does not stop its compose stack, and abandoned stacks exhaust Docker's bridge-network pool of roughly 30 until every `make run-test` on the machine dies with `all predefined address pools have been fully subnetted`.

Then delete any scheduled task via `list_scheduled_tasks` and `delete_scheduled_task`, and report which threads are still alive so the operator can close them.

---

## Invariants

- **Cap concurrent workers at 4.** Each worker holds a full compose stack (postgres, redis, localstack, rails) on its own bridge network. Four leaves headroom under the ceiling of roughly 30 networks for the operator's own worktrees. Raise it only after counting `docker network ls`.
- **One worktree per worker, and no cross-worker test lock.** `local-development/get-project-name.sh` derives the compose project name from the worktree's directory basename, so each worktree gets its own Postgres. Concurrent `make run-test` across worktrees is safe. What is not safe is two runs inside one worktree, and one worker owning one worktree makes that impossible by construction.
- **Every change to a live ticket's branch is made by that ticket's worker.** Not by you, and not by a subagent of yours — `delegate_task` returns work to this thread, which owns no branch.
- **Merged means `gh pr view <n> --json state,mergedAt` says so.** Nothing else counts as merged.
- **Merge the stack bottom-up, never out of order.** An entry merged from the middle strands a base for everything below it and squashes its parents' commits into `staging` twice. A green PR above the bottom is not an ask; `poll-prs.mjs` files it as `stack_green` rather than `ready_to_merge`.
- **Every PR targets its `base_branch`, not the repo default.** `gh pr create` defaults to the default branch, so the worker passes `--base` explicitly. A PR silently opened against `staging` shows every parent's diff and cannot be reviewed.
- **Shipped to prod is a grep for a distinctive symbol on `origin/master`.** Never SHA ancestry. `staging` is merged into `master`, so `git merge-base --is-ancestor` returns false for code that is live.
- **Launch every worker from the orchestrator thread, with `projectId` and an explicit `workspaceStrategy`.** You can run this skill from any project, because `t3_thread_start` targets one. Two rules make that safe. Always pass `workspaceStrategy`, since the default drops the worker into the caller's own checkout. And launch the workers yourself, because cross-project read and steer only resolve for threads the caller created. Both are in [`WORKER.md`](WORKER.md).

## Polling

Set the tick loop up once, during bootstrap. Read [`POLLING.md`](POLLING.md) for the launchd poller, the `schedule_task` fallback, and which to pick.
