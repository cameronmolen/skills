# Babysitting a PR

Babysitting ends when the PR is **merged or closed**. Until then it alternates between two modes:

- **Active**: work the PR to **handoff**, meaning CI green, mergeable, and every piece of review feedback **answered** and its human reviewers re-requested (see Review feedback).
- **Watching**: T3 Code's `watch_pull_request` waits on reviewers and CI for you at no token cost, for hours or days. Each time it messages you, you **wake** and go back to Active.

Babysitting starts with two things, before the first active pass: call `watch_pull_request` with the PR URL, and launch the merge waiter (see Watching). Only comments posted after the call wake you, so watching first leaves no gap between what the active loop reads and what the watch reports. Handoff is where your turn ends and the watch takes over. Merging is always the user's call.

## Active loop

1. Prefer a project-specific PR watcher when the repository ships one, in continuous `--watch` mode. When its JSON snapshots carry an `actions` list, read that list first.
2. Without one, poll:
   - `gh pr view <PR> --json url,state,number,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision,isDraft,reviews,comments,statusCheckRollup`
   - `gh pr checks <PR> --watch --fail-fast` while checks are running.
   - `gh run list --branch <headRefName> --commit <headRefOid> --json databaseId,name,conclusion,status,url` when a failed check needs run-level detail.
3. Each pass reads review feedback first, then CI, then mergeability. If a review fix is pending, rerunning CI on the old SHA is wasted work, because the next commit retriggers CI anyway.
4. After any push or rerun, resume the loop on the new SHA.

Own the terminal for the whole active loop. Consume watcher output in the same turn, and relaunch `--watch` yourself after any pause to patch, commit, or push. At handoff, go to **Watching**.

## Watching

At handoff, tell the user in a line or two that the PR is at handoff and being watched, then end your turn. T3 Code checks the PR every two minutes and wakes you with a message, so its silence means there is nothing to do. It skips comments from the user's GitHub account, so your own replies won't wake you. The watch lives on the thread's PR link and survives app restarts.

A merge or close ends the watch **without waking you**. The **merge waiter** catches it, launched with the Bash tool, `run_in_background: true`, and `timeout: 7200000`:

```sh
for i in $(seq 23); do [ "$(gh pr view <PR-URL> --json state --jq .state)" = OPEN ] || break; sleep 300; done; gh pr view <PR-URL> --json state --jq .state
```

The harness kills background commands at two hours, so the waiter gives up at 115 minutes and prints the state itself. `OPEN` means it timed out: relaunch it and end your turn. It dies with the session; running `/create-pr` again on the branch starts babysitting over from the top.

### On each wake

A watch wake is a message headed `Update on pull request #<n>`. Read the PR (`gh pr view <PR> --json headRefOid,state,comments,reviews`) first, then drop the **stale** items, the ones that need nothing from you:

- Checks on a `<sha>` other than the current `headRefOid`. The head's own checks wake you when they finish.
- A comment already answered (see Review feedback), often by the active loop before a mid-turn wake was delivered.
- A bot's progress placeholder, such as `Claude is working…`. The bot rewrites it in place when it finishes, and an edit never wakes you, so wait on the rewrite with the Bash tool, `run_in_background: true`, and `timeout: 1800000`, then end your turn. Its exit is the wake to answer the finished comment as feedback.

  ```sh
  until ! gh api repos/<owner>/<repo>/issues/comments/<id> --jq .body | grep -qF '<placeholder text>'; do sleep 60; done
  ```

A wake with only stale items ends your turn in one line. Before patching, sync with the remote as SKILL.md step 4 does, since someone else may have pushed or restacked during the watch. Then act on each remaining item:

| Item                                         | Do                                                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checks failed on `<sha>`                     | See CI failures. Each failed check carries its URL.                                                                                                  |
| All required checks passed                   | Nothing to fix. When every piece of feedback is answered and the PR is mergeable, tell the user it's ready for them to merge.                        |
| New comments                                 | Feedback: see Review feedback. Each carries its author and URL, but the body is cut to 200 characters, so fetch the full text and thread first. A review with no body shows as its state; `APPROVED` means nothing to fix. |
| The branch now conflicts                     | See Mergeability.                                                                                                                                    |
| Stopped watching after 10 comment-only updates | A bot is chatty. Handle the comments, then call `watch_pull_request` again.                                                                          |
| Stopped watching, could not read the PR      | Escalate: usually expired `gh` auth or lost repository access.                                                                                       |

After handling the items, run the active loop to handoff and end your turn.

The merge waiter's output is the other wake. `MERGED`: run On merge, then report that the PR merged. `CLOSED`: report that it closed without merging. Either way, babysitting is over.

### On merge

A merged PR moves its Notion ticket from `In review` to `In verification`.

1. Find the ticket: the page ID from SKILL.md step 5 when this session still holds it, otherwise the URL on the PR body's `**Related Notion ticket:**` line (`gh pr view <PR> --json body`). `N/A` or no link means there is no ticket, and On merge is done.
2. Fetch the ticket and read `Status`. Move it only when it reads `In review`. Any other value stays, since the ticket was either never advanced by this skill or a human has already moved it on.
3. Write with the Notion update-page tool: the page ID, `command: "update_properties"`, `properties: {"Status": "In verification"}`.

Done when a re-fetch shows `Status` at `In verification`, or at the untouched value step 2 left; report it alongside the ticket URL. A failed write is reported with the value you meant to write.

## Review feedback

Every piece of feedback from a reviewer, human or bot, ends up **answered**. That means a reply is posted on it, and if it's an inline thread, the thread is resolved. Resolve human reviewers' threads too: the re-request below is what hands the PR back to them. Write each reply with the `leaving-pr-comments` skill, then post it with the commands below.

For each item, pick the response:

- **Actionable and clearly correct**: patch locally, run focused checks, commit, push. The reply names the commit SHA and what changed. Push before replying so the SHA exists, and when one push covers several threads, answer each of them.
- **A question the code, diff, ticket, or this session answers**: the reply is the answer, pointing at the file or line that shows it.
- **Already addressed, outdated, or mistaken**: the reply says so and why, citing the commit or code.
- **Unsure**: ask the user with AskUserQuestion, and put your recommended responses first among the options. You're unsure when you don't know the answer, when the feedback can be read more than one way, when you'd push back on it, or when whether to implement it is a product or scope call. Batch the open items into one AskUserQuestion call. The user's answer becomes the reply, and a patch too when they choose one.

Resolve each inline thread in the same command that posts your reply (below). The one exception is a reply that asks the reviewer something back: that thread stays open, waiting on them. A new comment on a thread you already resolved is fresh feedback that needs answering. Top-level comments and review bodies can't be resolved. They count as answered once a later PR comment from the author responds to them.

Unresolved inline threads, each with the `id` you reply to and resolve with:

```sh
gh api graphql -F owner=<owner> -F name=<repo> -F number=<PR> -f query='
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) { pullRequest(number: $number) {
      reviewThreads(first: 100) { nodes {
        id isResolved isOutdated path line
        comments(first: 50) { nodes { author { login } body url } }
      } }
    } }
  }' --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)'
```

Reply to an inline thread and resolve it in one command. The resolve runs only once the reply has posted:

```sh
gh api graphql -F id=<thread_id> -F body=@<reply-file> -f query='
  mutation($id: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) { comment { url } }
  }' --jq .data.addPullRequestReviewThreadReply.comment.url &&
gh api graphql -F id=<thread_id> -f query='
  mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }' --jq .data.resolveReviewThread.thread.isResolved
```

Feedback is all answered when the unresolved-threads query returns only threads where your reply asked the reviewer something.

Top-level feedback comes from `gh pr view <PR> --json reviews,comments`. Answer it with `gh pr comment <PR> --body '<reply>'`: @mention the author and quote the line you're answering. Run `gh pr comment` with no `--jq` or `--json`, which make it post nothing and still exit cleanly. The comment URL it prints is your confirmation that it posted.

Once every piece of a human reviewer's feedback is answered, **re-request** their review, which puts the PR back in their queue. This covers each human whose latest review in `reviews` is `CHANGES_REQUESTED` or `COMMENTED`. An `APPROVED` reviewer is done, and bots are left to their own triggers.

```sh
gh api repos/<owner>/<repo>/pulls/<PR>/requested_reviewers -f 'reviewers[]=<login>'
```

## CI failures

Read the failed run logs and classify each failure as branch-caused or ambient (a flaky test, CI infrastructure, a dependency outage, or the runner).

- Branch-caused: patch locally, run the relevant checks, commit, push.
- Ambient: `gh run rerun <run-id> --failed`, which keeps the rest of the run's results.
- Unclear which: ask the user.

## Mergeability

Once reviews and CI are handled, read `mergeable`, `mergeStateStatus`, `reviewDecision`, `state`, and `isDraft`.

- Straightforward conflicts with enough local context: resolve them.
- Conflicts that depend on product judgment, need broad refactoring, or force a choice between competing human-authored changes: ask the user.

## Fixes made during the loop

Keep each fix minimal and tied to the CI, review, or mergeability issue raised on the PR. Name that issue in the commit message, and push to the PR branch as SKILL.md step 4 does.

## Escalation

Ask the user when you can't find a target PR, when credentials, repository permissions, or tooling are missing, or when one of the judgment calls above falls to them. Include the PR URL, the blocker, what you inspected, and the smallest decision you need from them.
