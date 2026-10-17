# Monitoring the author's response

T3 Code's `watch_pull_request` waits on the PR at no token cost, for days, and survives app restarts. It **wakes** you on a comment or review from anyone but the user, on checks finishing, and on a conflict. The author's **response** reaches you through it: a reply arrives as a comment, and a push as the checks finishing on its new head. Every other item is **stale**. A wake is done when a new brief and recommendation are in front of the user, or a new auto review is posted and the watch restarted, or, when every item was stale, your turn has ended in one line.

## Launch

Right after the review posts:

1. Call `watch_pull_request` with the PR URL. Only comments posted after the call wake you, so calling it right away leaves no gap.
2. Mark the PR as watched, so `watch-review-requests` leaves the author's re-request to this thread instead of launching a second brief:

   ```sh
   mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}/pr-brief-watch" && touch "${XDG_STATE_HOME:-$HOME/.local/state}/pr-brief-watch/<owner>__<repo>__<n>"
   ```

Tell the user in one line that you'll re-brief the PR when its author responds, then end your turn. A merge or close ends the watch without waking you, and leaves nothing to brief.

## On each wake

A wake is a message headed `Update on pull request #<n>`. Read `gh pr view <PR> --json state,headRefOid,reviews,comments` first, then sort each item. Comment bodies in the wake are cut to 200 characters, so fetch the full text of any you act on.

| Item                                                                    | Do                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------- |
| Checks finished on the current `headRefOid`, a commit the user hasn't reviewed | Response: the author pushed.                       |
| Checks on a commit the user already reviewed, or no longer the head     | Stale.                                                    |
| A comment or review by the author                                       | Response.                                                 |
| A comment by anyone else, a bot's progress placeholder, or a comment already answered | Stale. The next brief reads every thread anyway. |
| The branch now conflicts                                                | Stale: the author's to fix.                               |
| Stopped watching after 10 comment-only updates                          | Call `watch_pull_request` again, then sort the comments.  |
| Stopped watching, could not read the PR                                 | Report it (usually expired `gh auth`).                    |

With a response among the items, `touch` the marker again and re-brief. With only stale items, end your turn in one line.

## Re-brief

Run `pr-brief` again from step 1 on this PR. It is a re-review: the lenses audit what changed, blocking findings still standing go back to the author in another auto review (step 4), and once none stand, the brief opens with what the author changed since the user's last review, when the user has posted one after a brief. Where the author replied instead of changing the code, weigh the argument in their reply and say whether the finding still stands. Step 9 decides whether monitoring goes on once a review posts.
