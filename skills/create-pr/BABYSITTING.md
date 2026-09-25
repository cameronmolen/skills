# Babysitting a PR

Babysitting ends when the PR is **merged or closed**. Until then it alternates between two modes:

- **Active**: work the PR to **handoff**, meaning CI green, mergeable, and every piece of review feedback **answered** (see Review feedback).
- **Watching**: `watch-pr.py` waits on reviewers and CI for you at no token cost, for hours or days. Each time it exits, you **wake** and go back to Active.

Handoff is where watching begins. Merging is always the user's call.

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

Launch the watcher from this skill folder with the Bash tool and `run_in_background: true`:

```sh
python3 <this-skill-dir>/watch-pr.py <PR-URL>
```

Tell the user in a line or two that the PR is at handoff and being watched, then end your turn. The harness wakes you with the watcher's output when it exits, so its silence means there is nothing to do. `watch-pr.py --help` covers what it reports and how it batches bursts of activity into one wake. It skips your own replies, so posting them won't wake you.

The watcher dies with the session. Running `/create-pr` again on the branch resumes babysitting, and the watcher then reports whatever arrived in the meantime.

### On each wake

The last stdout line is one JSON object. Its `pr` field is a snapshot of state, mergeability, review decision, and check counts. Act on `status`:

| `status`           | Do                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `events`           | Handle `events` (below), run the active loop to handoff, then relaunch the watcher.                  |
| `merged`           | Report that the PR merged. Babysitting is over.                                                      |
| `closed`           | Report that it closed without merging. Babysitting is over.                                          |
| `already_watching` | A live watcher for this PR will wake you. Leave it running.                                          |
| `error`            | `gh` kept failing, and `detail` holds the last error. Escalate: usually expired auth or lost access. |
| `stopped`, or none | The watcher was killed. Relaunch it. Its state file keeps what was already reported.                 |

Before patching, run `git pull --ff-only`, since someone else may have pushed during the watch. Each event carries `author` and `url`:

- `comment`, `review`, `thread_comment`: feedback, with `body` truncated. Fetch the full text or the surrounding thread through `url` or `gh api graphql` when it matters. A `thread_comment` carries the `thread_id` you reply to and resolve with. `edited: true` marks a comment the author changed after you may have handled it. Compare against what you did before redoing work.
- `review` with `state: APPROVED`: nothing to fix. When CI is green and the PR is mergeable, tell the user it's ready for them to merge.
- `check_failed`: a failure on the current head. See CI failures.
- `conflict`: the PR has stopped merging cleanly with its base. See Mergeability.

When a judgment call lands on the user, relaunch the watcher **before** you ask, so feedback keeps being collected while they decide.

## Review feedback

Every piece of feedback from a reviewer, human or bot, ends up **answered**. That means a reply is posted on it, and if it's an inline thread, the thread is resolved. Replies post under the user's GitHub account, so write them the way the PR author would: a sentence or two with the substance the reviewer needs.

For each item, pick the response:

- **Actionable and clearly correct**: patch locally, run focused checks, commit, push. The reply names the commit SHA and what changed. Push before replying so the SHA exists, and when one push covers several threads, answer each of them.
- **A question the code, diff, ticket, or this session answers**: the reply is the answer, pointing at the file or line that shows it.
- **Already addressed, outdated, or mistaken**: the reply says so and why, citing the commit or code.
- **Unsure**: ask the user with AskUserQuestion, and put your recommended responses first among the options. You're unsure when you don't know the answer, when the feedback can be read more than one way, when you'd push back on it, or when whether to implement it is a product or scope call. Batch the open items into one AskUserQuestion call. The user's answer becomes the reply, and a patch too when they choose one.

Resolve each inline thread once your reply is posted. The one exception is a reply that asks the reviewer something back: that thread stays open, waiting on them. A new comment on a thread you already resolved is fresh feedback that needs answering. Top-level comments and review bodies can't be resolved. They count as answered once a later PR comment from the author responds to them.

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

Reply to an inline thread, then resolve it:

```sh
gh api graphql -F id=<thread_id> -f body='<reply>' -f query='
  mutation($id: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) { comment { url } }
  }'
gh api graphql -F id=<thread_id> -f query='
  mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }'
```

Top-level feedback comes from `gh pr view <PR> --json reviews,comments`. Answer it with `gh pr comment <PR> --body '<reply>'`: @mention the author and quote the line you're answering.

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

Keep each fix minimal and tied to the CI, review, or mergeability issue raised on the PR. Name that issue in the commit message, and push to the PR branch.

## Escalation

Ask the user when you can't find a target PR, when credentials, repository permissions, or tooling are missing, or when one of the judgment calls above falls to them. Include the PR URL, the blocker, what you inspected, and the smallest decision you need from them.
