# Worker threads

## What `t3_thread_start` gives you

Verified 2026-08-26 against the t3code source (`packages/contracts/src/orchestratorMcp.ts`, `apps/server/src/mcp/OrchestratorMcpService.ts`).

`t3_thread_start` and `create_threads` both take two arguments that decide where a worker runs:

- **`projectId`** targets another project. Omitted, the worker inherits the caller's project. Ids come from the `projects` array in `orchestrator_capabilities`, each entry carrying `projectId`, `name`, and `rootPath`.
- **`workspaceStrategy`** decides the checkout. Three shapes:

  | `type`              | Fields                                   | Effect                                                   |
  | ------------------- | ---------------------------------------- | -------------------------------------------------------- |
  | `worktree`          | `baseRef`, `branch?`, `startFromOrigin?` | Creates a fresh worktree and starts the thread inside it |
  | `existing_worktree` | `worktreePath`, `branch?`                | Starts the thread in a worktree that already exists      |
  | `root`              | `branch?`                                | Starts the thread in the project's root checkout         |

**Always pass `workspaceStrategy` explicitly.** The default is inherit-shaped and hostile to this skill. When you omit it and the target project matches the caller's, the worker inherits the caller's workspace, so an orchestrator already sitting in a worktree drops every worker into that same checkout. Four workers sharing one working tree corrupts all four. Cross-project defaults to `root`, which is no better: it puts the worker in the shared main checkout.

So one worker is one call, with `baseRef` set to the branch below it in the stack. The full shape is in [The launch prompt](#the-launch-prompt).

The worker is in its own worktree on its own branch before its first turn. There is no handoff step, and `t3_worktree_handoff` is not part of this design.

**Every worktree is a worktree of the one project clone, so they share a ref store and an object database.** That is what lets a worker branch off a sibling's branch that has never been pushed, and what lets `refs/stack-base/<branch>` be read from anywhere. It is also why branch names must stay unique across workers, which `branchFor` guarantees by keying on the ticket id.

## What is still project-scoped

**`t3_thread_list` never returns threads from another project.** It has no `projectId` parameter and filters on the caller's project. So a cross-project worker is invisible to listing.

**The ledger is therefore the only index of your workers.** Record `thread_id` the moment `t3_thread_start` returns, with `scripts/stack.mjs <PLN> push <ENG-####> --thread <id>`. Lose it and the worker is unreachable, because you cannot enumerate your way back to it. The same call appends the ticket to the stack, so skipping it also leaves the next launch branching off a stale tip.

**Reading and steering cross-project workers does work, but only ones you launched yourself.** `loadScopedThread` resolves a thread by the caller's project id unless the caller created it, and a thread it created resolves directly. `t3_thread_read`, `t3_thread_send`, `t3_thread_wait`, and `t3_thread_interrupt` all go through that path. Two consequences:

- Launch every worker from the orchestrator thread. A worker launched by anything else is one you can never read.
- The scheduled-task heartbeat must use `bindToCurrentThread: true`. A fresh thread per run created none of the workers and can reach none of them.

`t3_thread_read` returns `thread.worktreePath` and `thread.branch`, so you can confirm a worker landed where you put it without asking it.

`create_threads` batches up to `maxBatchThreads: 20` and takes `projectId` and `workspaceStrategy` per entry, but batching cannot build a stack: each entry's `baseRef` is the branch the entry before it created, which does not exist until that call returns. Launch one ticket at a time with `t3_thread_start` and push each to the stack as it returns.

Use `delegate_task` for child work the orchestrator owns, such as a graph-extraction pass or a divergence diff. Its result comes back to the orchestrator rather than to a worker. Do not use it for tickets. A delegated task is a subagent of this thread, and a ticket needs a top-level thread the operator can open, read, and steer.

## Check the build first

`projectId` and `workspaceStrategy` are recent. Call `orchestrator_capabilities` during bootstrap and confirm the result carries a `projects` array. If it does not, the running app predates cross-project launch: tell the operator to update T3 Code, and run the orchestrator from the target project in the meantime, since same-project launch still works.

## Claim before launch

A ticket about to get a worker is a ticket a human should stop picking up. Before the first launch in a tick, query the Sprints data source `86133bd6-b63a-4993-9bfc-90f56c5a31c5` for the sprint whose `Team` is `Host` and whose date window contains today:

```bash
ntn datasources query 86133bd6-b63a-4993-9bfc-90f56c5a31c5 \
  --filter '{"and":[{"property":"Team","select":{"equals":"Host"}},{"property":"Start Date","date":{"on_or_before":"<today>"}},{"property":"End Date","date":{"on_or_after":"<today>"}}]}' \
  --json
```

Use the `Team`, `Start Date`, and `End Date` properties as the authority. Sprint names are inconsistent. If the query does not resolve to one active Host sprint, launch nothing and report the lookup as blocked.

Immediately before each `t3_thread_start`, use `notion-update-page` to set the ticket's `Status` to `In progress`, `Assignee` to `Cameron Molen`, and `Sprint` to that sprint. The `Sprint` relation value must be the sprint's full Notion page URL, not its UUID. Do this for every ticket you launch, not for the launchable list you merely report.

Fetch the ticket after the update and verify all three fields. Claim first, launch second. If the write or verification fails, do not launch the worker. Report the ticket as blocked on the claim instead of starting a worker Notion does not show as owned.

## The launch prompt

Run `scripts/stack.mjs <PLN> plan <ENG-####>` first. It returns `branch`, `base_branch`, and `start_from_origin` for this launch, computed against the current stack tip. Do not derive any of them yourself.

```
t3_thread_start({
  projectId: "<rails-api project id>",
  workspaceStrategy: {type: "worktree", baseRef: "<base_branch>", branch: "<branch>", startFromOrigin: <start_from_origin>},
  prompt: "<below>",
  title: "<ENG-####> <ticket name>"
})
```

`start_from_origin` is true only at the stack floor, where `base_branch` is `staging` and the remote tip is what you want. Above the floor the base is another worker's branch, which may exist only locally, so it is false.

The moment `t3_thread_start` returns, run `scripts/stack.mjs <PLN> push <ENG-####> --thread <thread-id>`. That appends the ticket to the stack, freezes its base, and sets `status` to `running`. **Until you run it the stack tip is stale, and the next launch will branch off the wrong ticket.**

```
You own <ENG-####>: <ticket name>
Notion: <ticket url>

You are already in your own git worktree on branch <branch>, based on <base_branch>.
Do not create another worktree and do not switch branches.

This branch is one link in a stacked PR chain. <base_branch> is the link below you
and already contains the work you depend on. Treat it as read-only.

- First, before you change anything, run:
    git update-ref refs/stack-base/<branch> HEAD
  That records where you branched from. A later restack needs it and cannot
  recover it once you have committed.
- Read the Notion ticket in full, including its acceptance criteria.
- Implement it. Follow the repo's CLAUDE.md.
- Lint changed files, then run the tests.
- Stop after the implementation is complete and report what you changed, which
  checks you ran, and any remaining concern. Do not create or push a PR yet.

Do not rebase, merge, force-push, or create a PR on your own initiative. You will
be sent an exact rebase command when the branch below you moves. You will receive
a separate explicit instruction when the operator wants this ticket's PR opened.

YOUR FIRST TERMINAL STATE IS: implementation complete, changes reported, and no
PR created. Reply with exactly this first line, followed by a concise report:

READY_FOR_PR <branch>
Changed: <what you changed>
Checks: <lint and test results>
Remaining: <"none" or the specific concern>

Then wait. Do not open a PR until an explicit message says to create it. After
that instruction, open the PR with the create-pr skill, titled "<ENG-####>
<plain-language summary>". Pass the base explicitly:
  gh pr create --base <base_branch> --title "..." --body "..."
Your PR must show only your own ticket's diff. If it shows work from the branch
below you, the base is wrong. Stop and report instead of merging anything in.
Push, and stay on the PR until CI is green. Do not merge. When that second phase
is complete, reply with exactly: DONE <pr-url>
Stop and report instead of guessing if the ticket's approach is genuinely ambiguous.
```

**`refs/stack-base/<branch>` is the whole restack mechanism.** A rebase needs the fork point, and once the parent branch has itself been rebased, `git merge-base` no longer finds it. The ref is written before the first commit and updated on every restack, so it always names the exact commit the branch was cut from. Worktrees share the one clone's ref store, so the orchestrator and every sibling worker can resolve it.

**Only stack a ticket on top of its blockers.** A worker inherits exactly the branches beneath it, so a blocker that has not launched yet is not in its ancestry. `frontier.mjs` enforces this and reports the offenders as `held_blockers_not_stacked`. Never override it by launching out of order.

## Relaying an operator request

An operator request that lands on a live ticket's branch is a message to that ticket's worker. [`SKILL.md`](SKILL.md) has the rule; this is the message.

```
From the orchestrator, on <ENG-####>.

<the request, narrowed to what this branch needs>

Scope: your branch <branch> only. Leave every other branch alone, and rebase or
force-push only when a message tells you to.
When your PR is updated and CI is green again, reply: <TOKEN> <branch>
```

Two things make it land. **Narrow the request to the worker's branch** — the operator says "rename it everywhere", and each worker hears only its own files. Handed the whole request, and with a sibling's branch sitting in the same shared ref store, a worker will reach outside its own to satisfy it. And **write the ticket's `relay` field before sending** — `{token, request, sent_at}` — clearing it when the token comes back. Your context gets summarized; a relay you forget is a worker working on something nobody is waiting for.

## Restack on merge

`staging` squashes. When the bottom of the stack merges, its commits land in `staging` as one new commit, and every branch above still carries the originals. Left alone, the next PR up shows its parent's diff again and conflicts on merge. So a merge rebases the entire column above it.

Run `scripts/stack.mjs <PLN> restack <ENG-####>` for the merged ticket. It returns one entry per ticket above, bottom-to-top, each with:

- `command` — the exact rebase, ref update, and force-push, already filled in.
- `retarget` — a `gh pr edit --base` when the base branch name changed. Only the entry directly above a merge gets one; the rest keep the same parent, whose history simply moved.
- `base_was` and `base_now`, for the report.

Send each entry to its `thread_id`:

```
<merged branch> merged into staging. The branch below you moved, so restack:
  <command>
Then <retarget, when present>.
Resolve any conflicts in your own commits only, and confirm CI goes green again.
Reply RESTACKED <branch> when the force-push has landed.
```

**Work the list strictly in order and wait for each `RESTACKED` before sending the next.** Entry N+1 rebases onto entry N's new tip. Send them together and N+1 rebases onto a branch that is about to move under it.

`stack.mjs restack` writes the new `base_branch` into the ledger as it plans, so the plan is not idempotent in the sense of being re-runnable per worker — but calling it with no ticket id is safe and returns exactly the entries whose ledger base and stack position still disagree. Use that to recover a half-finished cascade.

**Never run git in a live worker's worktree yourself.** The worker may be mid-edit, and you will race it. The only worktree you may touch directly is one whose thread is terminal.

A worker that reports an unresolvable conflict during a restack is a human ask, not a zombie. Leave the branch as it is, and say in the report which entry the cascade stopped at — everything above it is stuck behind that one.

## Zombies

A stalled worker and a thinking worker look identical from outside. Both are just a thread that has not replied.

1. **Staleness timeout.** No new timeline items for 45 minutes on a `running` ticket. Check with `t3_thread_read` using `afterPosition` from the ledger's `last_read_position`, so you read incrementally instead of re-reading the whole transcript.
2. **Ping.** `t3_thread_send`: `Status check. What are you working on, and what is blocking you? Reply in two sentences.`
3. **Escalate.** No reply within 15 minutes: mark `zombie` and put it in the report's human-ask list. Do not interrupt or restart it on your own. `t3_thread_interrupt` discards in-flight work, and that call belongs to the operator.

A worker that replies asking a question is not a zombie. Relay its question to the operator verbatim and leave it `running`.

## Reading workers cheaply

Never read a worker thread just to see whether it is alive. `poll-prs.mjs` answers that from GitHub for free. Read a thread only when it has gone stale, has asked a question, or its PR went red. Use `view: "messages"`, a `limit`, and `afterPosition` from the ledger. The default full-activity read is the single most expensive thing a tick can do.
