---
name: watch-review-requests
description: Watch GitHub for PRs requesting your review and launch a T3 Code thread that briefs each one with pr-brief.
disable-model-invocation: true
argument-hint: "[extra search qualifiers, e.g. org:neiybor]"
allowed-tools: Bash, Read, AskUserQuestion, mcp__t3-code__t3_project_list, mcp__t3-code__t3_thread_launch, mcp__t3-code__t3_thread_list
---

`watch-review-requests.py`, in this skill's folder, waits on the user's **review queue** at no token cost: open PRs that are not drafts, not approved, and request a review from the user's account directly. It exits when a PR enters the queue, and each exit **wakes** you. Each PR it reports gets its own top-level T3 Code thread running `pr-brief`, so this thread stays a lightweight dispatcher and every brief keeps its questions and follow-ups in its own conversation. A wake is done when every PR it reported has a launched thread and the watcher is running again.

Arguments: `$ARGUMENTS` are extra GitHub search qualifiers. Pass them through as `--filter` on every launch.

## 1. Launch the watcher

Run it with the Bash tool and `run_in_background: true`:

```sh
python3 <this-skill-dir>/watch-review-requests.py --filter "$ARGUMENTS"
```

Tell the user in one line that their review queue is being watched, then end your turn. The harness wakes you with the watcher's output when it exits, so while it stays silent, nothing is waiting. The first launch reports every PR already in the queue, so the first wake can come within seconds. `--help` defines the queue and explains how a re-request counts as new.

The watcher dies with the session. Running `/watch-review-requests` in a new session resumes it, and requests that were already reported stay quiet.

## 2. On each wake

The last stdout line is one JSON object. Act on its `status`:

| `status`           | Do                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `ready`            | Relaunch the watcher (step 1) first, so requests that land mid-dispatch are still caught. Then run step 3. |
| `already_watching` | A live watcher will wake you. Leave it running and end your turn.                                         |
| `error`            | `gh` kept failing, and `detail` holds the last error. Report it (usually expired `gh auth`) and stop.    |
| `stopped`, or none | The watcher was killed. Relaunch it.                                                                      |

## 3. Launch a thread per PR

Running this skill is the user's request for one top-level thread per PR. Take the PRs in `prs` oldest `requested_at` first.

1. **Map each PR's `repo` to a T3 project.** Call `t3_project_list` (page through `cursor`) once per wake, and for each project read its repo with `gh repo view --json nameWithOwner --jq .nameWithOwner`, run in the project's workspace root. A PR whose `repo` matches a project launches into it, where `pr-brief` uses that checkout as its base clone and builds its review worktree beside it. A PR with no matching project launches as `scratch`, and `pr-brief` clones the repo into its cache.
2. **Launch one thread per PR** with `t3_thread_launch`, inheriting this thread's model and modes:

   ```
   t3_thread_launch({
     title: "Review <repo>#<number> <title>",
     projectId: "<matching project id>", workspaceStrategy: {type: "root"},  // or scratch: true
     message: "Use the pr-brief skill to brief <url>."
   })
   ```

   Pass `workspaceStrategy: {type: "root"}` explicitly with a project: `pr-brief` reads from the project's checkout and leaves its working tree untouched, so a fresh worktree per review would be wasted setup. A re-request launches a fresh thread too; `pr-brief` reads the user's earlier review from GitHub and briefs it as a re-review.

3. **Keep each `threadId`.** `t3_thread_launch` has no retry key, so after an error or a lost response, look for the thread with `t3_thread_list` (`titleContains: "<repo>#<number>"`) before launching again. That listing only covers this thread's project, so a scratch or cross-project launch that may have landed is reported to the user rather than retried.

Done when every PR in the wake has a launched thread. Report one line per PR, its title and thread, then end your turn; the relaunched watcher carries the queue from here.
