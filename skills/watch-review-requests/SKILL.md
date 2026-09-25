---
name: watch-review-requests
description: Watch GitHub for PRs requesting your review and brief each one with pr-brief as it arrives.
disable-model-invocation: true
argument-hint: "[extra search qualifiers, e.g. org:neiybor]"
allowed-tools: Bash, Read, Skill, AskUserQuestion
---

`watch-review-requests.py`, in this skill's folder, waits on the user's **review queue** at no token cost: open PRs that are not drafts, not approved, and request a review from the user's account directly. It exits when a PR enters the queue, and each exit **wakes** you. A wake is done when every PR it reported has been briefed and the watcher is running again.

Arguments: `$ARGUMENTS` are extra GitHub search qualifiers. Pass them through as `--filter` on every launch.

## 1. Launch the watcher

Run it with the Bash tool and `run_in_background: true`:

```sh
python3 <this-skill-dir>/watch-review-requests.py --filter "$ARGUMENTS"
```

Tell the user in one line that their review queue is being watched, then end your turn. The harness wakes you with the watcher's output when it exits, so while it stays silent, nothing is waiting. The first launch reports every PR already in the queue, so the first wake can come within seconds. `--help` defines the queue and explains how a re-request counts as new.

The watcher dies with the session. Running `/watch-review-requests` in a new session resumes it, and requests that were already briefed stay quiet.

## 2. On each wake

The last stdout line is one JSON object. Act on its `status`:

| `status`           | Do                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `ready`            | Relaunch the watcher (step 1) first, so requests that land mid-brief are still caught. Then run step 3.  |
| `already_watching` | A live watcher will wake you. Leave it running and end your turn.                                         |
| `error`            | `gh` kept failing, and `detail` holds the last error. Report it (usually expired `gh auth`) and stop.    |
| `stopped`, or none | The watcher was killed. Relaunch it.                                                                      |

## 3. Brief each PR

Take the PRs in `prs` oldest `requested_at` first, and invoke the `pr-brief` skill with each one's `url`. Carry each brief through the user's choice of what to post before starting the next, so only one set of questions is open at a time.

Done when every PR in the wake has either been posted or deliberately held by the user. End your turn; the relaunched watcher carries the queue from here.
