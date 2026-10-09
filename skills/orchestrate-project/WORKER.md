# Worker threads

## What `t3_thread_launch` gives you

`t3_thread_launch` creates one top-level thread and binds its workspace before the agent's first turn. Three arguments decide where and what it runs:

- **`projectId`** names the target repo's project: the ledger's `project.project_id`. Omitted, the worker inherits the orchestrator's project, which is wrong whenever the orchestrator runs from elsewhere.
- **`workspaceStrategy`** decides the checkout. Three shapes:

  | `type`              | Fields                                   | Effect                                                   |
  | ------------------- | ---------------------------------------- | -------------------------------------------------------- |
  | `worktree`          | `baseRef`, `branch?`, `startFromOrigin?` | Creates a fresh worktree and starts the thread inside it |
  | `existing_worktree` | `worktreePath`, `branch?`                | Starts the thread in a worktree that already exists      |
  | `root`              | `branch?`                                | Starts the thread in the project's root checkout         |

- **`message`** is the worker's first prompt, delivered once the worktree is ready.

**Always pass `workspaceStrategy` explicitly.** Omitted, it means `root`: the project's main checkout, never the caller's worktree. Four workers sharing one working tree corrupts all four. So one worker is one call, with `baseRef` set to the branch below it in the stack. The full shape is in [The launch prompt](#the-launch-prompt).

The launch needs a full-access or default-mode caller and has no retry key. It returns `threadId` once accepted, while the worktree may still be preparing. After an error or a lost response, find the thread with `t3_thread_list` (`projectId` from the ledger, `titleContains: "<ENG-####>"`) before launching again, or you get two workers on one ticket.

The worker is in its own worktree on its own branch before its first turn. There is no handoff step, and `t3_worktree_handoff` is not part of this design.

**Every worktree is a worktree of the one project clone, so they share a ref store and an object database.** That is what lets a worker branch off a sibling's branch that has never been pushed, and what lets `refs/stack-base/<branch>` be read from anywhere. It is also why branch names must stay unique across workers, which `branchFor` guarantees by keying on the ticket id.

## Reaching workers from any project

`t3_thread_read`, `t3_thread_send`, `t3_thread_wait`, and `t3_thread_interrupt` resolve a `threadId` anywhere in the environment, and `t3_thread_list` lists the project its `projectId` names. So the orchestrator can run from any project, a hub thread included, and still drive workers in the target repo. Two limits hold:

- **A worker can't run with broader permission modes than the orchestrator.** A send or interrupt aimed at one is rejected. Launches inherit the orchestrator's modes, so pass no `runtimeMode` or `interactionMode` wider than its own.
- **The orchestrator writes to other threads only during a live run of its own.** Every tick is one, so restacks go out from inside a turn.

**The ledger is the index of your workers.** Record `thread_id` the moment `t3_thread_launch` returns, with `scripts/stack.mjs <PLN> push <ENG-####> --thread <id>`. The same call appends the ticket to the stack, so skipping it also leaves the next launch branching off a stale tip. `t3_thread_list` with the ledger's `projectId` and `titleContains` can recover a lost id, but only because every worker's title starts with its ticket id.

`t3_thread_read` returns `thread.worktreePath` and `thread.branch`, so you can confirm a worker landed where you put it without asking it.

Launch one ticket at a time with `t3_thread_launch` and push each to the stack as it returns. Each entry's `baseRef` is the branch the launch before it created, and `create_threads` would put every worker in the orchestrator's own checkout anyway.

Use `delegate_task` for child work the orchestrator owns, such as a graph-extraction pass or a divergence diff. Its result comes back to the orchestrator rather than to a worker. Do not use it for tickets. A delegated task is a subagent of this thread, and a ticket needs a top-level thread the operator can open, read, and steer.

## Claim before launch

A ticket about to get a worker is a ticket a human should stop picking up. Before the first launch in a tick, query the Sprints data source `86133bd6-b63a-4993-9bfc-90f56c5a31c5` for the sprint whose `Team` is `Host` and whose date window contains today:

```bash
ntn datasources query 86133bd6-b63a-4993-9bfc-90f56c5a31c5 \
  --filter '{"and":[{"property":"Team","select":{"equals":"Host"}},{"property":"Start Date","date":{"on_or_before":"<today>"}},{"property":"End Date","date":{"on_or_after":"<today>"}}]}' \
  --json
```

Use the `Team`, `Start Date`, and `End Date` properties as the authority. Sprint names are inconsistent. If the query does not resolve to one active Host sprint, launch nothing and report the lookup as blocked.

Immediately before each `t3_thread_launch`, use `notion-update-page` to set the ticket's `Status` to `In progress`, `Assignee` to `Cameron Molen`, and `Sprint` to that sprint. The `Sprint` relation value must be the sprint's full Notion page URL, not its UUID. Claim only the tickets you are launching this tick; the rest of the launchable list stays at `Ready`.

Fetch the ticket after the update, verify all three fields, and set the ledger's `notion_status` to `In progress`. Claim first, launch second. If the write or verification fails, do not launch the worker. Report the ticket as blocked on the claim instead of starting a worker Notion does not show as owned.

## The launch prompt

Run `scripts/stack.mjs <PLN> plan <ENG-####>` first. It returns `branch`, `base_branch`, `start_from_origin`, `parent`, `parent_thread_id`, `floor`, and `repo` for this launch, computed against the current stack tip. Do not derive any of them yourself.

```
t3_thread_launch({
  projectId: "<project.project_id from the ledger>",
  workspaceStrategy: {type: "worktree", baseRef: "<base_branch>", branch: "<branch>", startFromOrigin: <start_from_origin>},
  message: "<below>",
  title: "<ENG-####> <ticket name>"
})
```

`start_from_origin` is true only at the stack floor, where `base_branch` is `staging` and the remote tip is what you want. Above the floor the base is another worker's branch, which may exist only locally, so it is false.

The moment `t3_thread_launch` returns, run `scripts/stack.mjs <PLN> push <ENG-####> --thread <thread-id>`. That appends the ticket to the stack, freezes its base, and sets `status` to `running`. **Until you run it the stack tip is stale, and the next launch will branch off the wrong ticket.**

Fill `<below you>` with `<parent>, owned by worker thread <parent_thread_id>` when there is a parent, and with `the project's base` at the floor.

```
You own <ENG-####>: <ticket name>
Notion: <ticket url>

You are already in your own git worktree on branch <branch>, based on <base_branch>.
Stay in this worktree and on this branch.

This branch is one layer of a stacked PR chain on <repo>, merged bottom-up into
<floor>. <base_branch> is the layer below you (<below you>). It already
contains the work you depend on. Treat it as read-only.

The operator talks to you directly in this thread. An orchestrator thread runs
the stack and Notion; its only messages to you are restacks.

## Implement

- First, before you change anything, run:
    git update-ref refs/stack-base/<branch> HEAD
  That records where you branched from. A later restack needs it and cannot
  recover it once you have committed.
- Read the Notion ticket in full, including its acceptance criteria.
- Implement it. Follow the repo's CLAUDE.md.
- Lint changed files, then run the tests.
- If the change is frontend-facing, verify it in a browser before you call it
  done: run the app, exercise every acceptance criterion the change touches,
  and save a screenshot or recording of each. create-pr uses those as the
  PR's demo. If you can't get it running in a browser, report the work as
  unverified, say what stopped you, and leave the call to the operator.
- Report to the operator what you changed, which checks you ran (including
  the browser verification), and any remaining concern. Then end your turn
  and wait for the operator. Ask them instead of guessing when the ticket's
  approach is genuinely ambiguous.

## Open the PR, when the operator asks

Your PR stacks on the PR of the layer below you, so that layer opens first.

1. Your base is <base_branch>, or the newer base a restack message has given you since.
2. A base of <floor> is ready. Any other base, check its PR:
     gh pr list --repo <repo> --head <base> --state all --json number,state,url
   - OPEN: ready.
   - MERGED: the orchestrator is about to restack you onto a new base. Wait
     for its restack message, carry it out, then start this list again.
   - No PR yet: tell the operator you are waiting on the layer below you to
     open its PR. Run this with the Bash tool, run_in_background: true and the
     longest timeout, then end your turn:
       until [ -n "$(gh pr list --repo <repo> --head <base> --state all --json number --jq '.[0].number')" ]; do sleep 120; done
     It exits once that PR exists; then start this list again. If the harness
     stops it first, launch it again.
3. Open your PR with the create-pr skill, titled "<ENG-####> <plain-language
   summary>", passing the base explicitly:
     gh pr create --base <base> --title "..." --body "..."
4. On any base other than <floor>, link your PR onto the base's PR as a GitHub stack:
     gh stack link --base <floor> <base PR number> <your PR number>
   It adds your PR to the top of the stack the base PR is already in, or
   starts one. If it errors, tell the operator and carry on; the PR still
   targets the right base.
5. Your PR shows only your own ticket's diff. Work from the layer below you
   showing up in it means the base is wrong: stop and tell the operator,
   leaving both branches as they are.
6. Carry on with create-pr's babysitting. Merging is the operator's call.

## Restacks

When the layer below you moves, the orchestrator sends you the exact commands.
Run them as given, resolve conflicts in your own commits only, and reply with
exactly one line:
  RESTACKED <branch>                  once the force-push has landed
  RESTACK_BLOCKED <branch>: <why>     when a conflict needs the operator
Those are the rebases and force-pushes you make unprompted. Any other history
change waits for the operator to ask for it.
```

**`refs/stack-base/<branch>` is the whole restack mechanism.** A rebase needs the fork point, and once the parent branch has itself been rebased, `git merge-base` no longer finds it. The ref is written before the first commit and updated on every restack, so it always names the exact commit the branch was cut from. Worktrees share the one clone's ref store, so the orchestrator and every sibling worker can resolve it.

**Only stack a ticket on top of its blockers.** A worker inherits exactly the branches beneath it, so a blocker that has not launched yet is not in its ancestry. `frontier.mjs` enforces this and reports the offenders as `held_blockers_not_stacked`. Never override it by launching out of order.

## Restack on merge

`staging` squashes. When the bottom of the stack merges, its commits land in `staging` as one new commit, and every branch above still carries the originals. Left alone, the next PR up shows its parent's diff again and conflicts on merge. So a merge rebases the entire column above it.

The poller queues the merge on `pending_restack`. `scripts/stack.mjs <PLN> restack <ENG-####>` plans the column and parks one entry on each ticket above it, as its `restack` field:

- `command` — the exact rebase, ref update, and force-push, already filled in.
- `retarget` — a `gh pr edit --base` when the base branch name changed. Only the entry directly above a merge gets one; the rest keep the same parent, whose history simply moved.
- `base_now` — the ticket's new base, which the worker needs for its PR.

`frontier.mjs` lists the parked entries bottom-to-top as `restack_queue`. Send the bottom one to its `thread_id`:

```
<merged branch> merged into <floor>. The branch below you moved, so restack.
Your base is now <base_now>.
  <command>
Then <retarget, when present>.
```

**Work the queue strictly in order and wait for each reply before sending the next.** Entry N+1 rebases onto entry N's new tip. Send them together and N+1 rebases onto a branch that is about to move under it. Wait with `t3_thread_wait` on the worker's `thread_id`, with a bounded `timeoutMs`, then read its reply with `t3_thread_read` (`view: "messages"`, `afterPosition` from the ledger's `last_read_position`), and advance `last_read_position`. A timeout leaves the worker running, so wait again rather than resending.

On `RESTACKED`, run `stack.mjs <PLN> restacked <ENG-####>` and send the next. On `RESTACK_BLOCKED`, stop: the entry keeps its `restack`, everything above it waits behind it, and the worker has already put the conflict in front of the operator. Name it in the report.

**A parked entry may already be in flight.** Before sending, read the worker's thread from `last_read_position`. A `RESTACKED` there means it landed while you were away: clear it and move on. Your own restack message there with no reply yet means it is still working: wait on it rather than resending.

**Never run git in a live worker's worktree yourself.** The worker may be mid-edit, and you will race it. The only worktree you may touch directly is one whose thread is terminal.

## Reading workers cheaply

Read a worker's thread only to collect a restack reply. `poll-prs.mjs` answers everything else from GitHub for free. Use `view: "messages"`, a `limit`, and `afterPosition` from the ledger. The default full-activity read is the single most expensive thing a tick can do.
