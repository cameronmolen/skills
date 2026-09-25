# Monitoring the author's response

`watch-response.py`, in this skill's folder, waits at no token cost for the PR's author to respond to the user's review, and exits when they do. Each exit **wakes** you. A wake is done when a new brief and recommendation are in front of the user.

## Launch

Launch it as soon as the review posts. The first launch counts everything already on the PR as seen, so any response that lands before launch is never reported. Run it with the Bash tool and `run_in_background: true`:

```sh
python3 <this-skill-dir>/watch-response.py <PR-URL>
```

Tell the user in one line that you'll re-brief the PR when its author responds. If other PRs from the same wake are still waiting to be briefed (a `watch-review-requests` wake), carry on with the next one. Otherwise, end your turn. `--help` covers what counts as a response and how a burst of pushes becomes one wake. While the monitor holds the PR, `watch-review-requests` stays quiet about its re-requests, so each response produces exactly one brief.

The monitor dies with the session. Running `pr-brief` on the PR in a new session briefs it again and relaunches the monitor, and the monitor's state carries over.

## On each wake

The last stdout line is one JSON object. Act on its `status`:

| `status`           | Do                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `events`           | The author responded. Re-brief (below).                                                                                     |
| `merged`, `closed` | Report it, including how many of the user's threads were still open (`pr.my_threads`). Monitoring is over, and the state is already cleared. |
| `done`             | Monitoring was ended with `--done`. Nothing to do.                                                                         |
| `already_watching` | A live monitor for this PR will wake you. Leave it running.                                                                 |
| `error`            | `gh` kept failing, and `detail` holds the last error. Report it (usually expired `gh auth`).                               |
| `stopped`, or none | The monitor was killed. Relaunch it. Its state keeps what was already reported.                                            |

## Re-brief

Each event in `events` is `pushed`, `reply`, `resolved`, `comment`, or `re_requested`. `pr.my_threads` counts the user's threads that are open and resolved.

Run `pr-brief` again from step 1 on this PR. It is a re-review, so the brief leads with what the author changed and which of the user's threads they addressed, followed by the recommendation. Where the author replied instead of changing the code, weigh the argument in their reply and say whether the finding still stands. Steps 6 through 8 run as usual, and step 8 decides whether monitoring goes on.
