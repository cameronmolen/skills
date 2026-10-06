---
name: pr-brief
description: Brief a pull request for its human reviewer. Requests changes on bugs, coding-standards breaks, and missing demos without asking, then shows the API, data, and logic decisions the PR makes, flags design problems, recommends a verdict, posts the comments the user picks, and re-briefs once the author responds. Use when the user wants to understand or review someone else's PR.
argument-hint: <PR URL or number>
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
---

A **brief** lets the reviewer decide a PR's future without reading its code. It is built from two things:

- A **decision** is a choice the codebase will live with after this PR merges. That covers a public API or contract (endpoints, GraphQL types, exported signatures, event payloads), the data model, a module boundary or dependency direction, a new abstraction or pattern, a rule in the logic (what gets validated, computed, or branched on), cross-cutting behavior, and config or infra. Everything else is **implementation detail**, and it stays out of the brief unless it carries a finding.
- A **finding** is a problem worth a review comment (the kinds are in step 4). A **mechanical** finding has an objective test the author can fix against without the reviewer weighing in, so it goes straight to the author in an **auto review**. A **judgment** finding needs the reviewer's call, so it goes in the brief.

Arguments: `$ARGUMENTS` is a PR URL or number. With neither, use the PR for the current branch.

Steps 1 through 4 run straight through. When a mechanical finding stands, step 5 posts an auto review and the run ends there; the user sees the brief only once the author has cleared every mechanical finding. Your first question to the user comes in step 7, after the brief. Settle anything unclear before then by reading the worktree. When only the author can settle it, put it in the brief as a finding whose consequence depends on the answer.

## 1. Load and link the PR

```sh
gh pr view <PR> --json url,number,title,body,author,baseRefName,headRefOid,additions,deletions,changedFiles,files,reviews,comments
gh pr diff <PR>
gh api user --jq .login
```

Line counts split into app code and **test code**, meaning code that doesn't ship (tests, mocks, fixtures, factories, snapshots, stories):

```sh
gh pr view <PR> --json files --jq '
  def test_code: test("(^|/)(tests?|spec|__tests__|__mocks__|e2e|fixtures|factories)/|[._](test|spec)\\.[a-z]+$|\\.stories\\.[a-z]+$|\\.snap$");
  .files | map(.path |= (if test_code then "tests" else "app" end))
  | group_by(.path)[] | "\(.[0].path) +\(map(.additions) | add) −\(map(.deletions) | add)"'
```

Existing review threads, so a finding someone already raised isn't posted twice:

```sh
gh api graphql -F owner=<owner> -F name=<repo> -F number=<n> -f query='
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) { pullRequest(number: $number) {
      reviewThreads(first: 100) { nodes {
        isResolved path line
        comments(first: 20) { nodes { author { login } body } }
      } }
    } }
  }'
```

This is a **re-review** when `reviews` holds one by the user. Every re-review reports which of the user's earlier threads the author addressed, auto reviews included. The brief covers the change since the `commit.oid` of the user's latest review whose body lacks the `<!-- pr-brief:auto -->` marker, the last review the user made after reading a brief. When every review by the user is an auto review, the user hasn't seen a brief yet, so brief the whole PR. If the author merged the base in since the reviewed commit, the delta also carries base changes, so leave those out. If that commit can't be fetched because it was force-pushed away, brief the whole PR.

Link the PR to the current thread (if the harness being used supports it).

## 2. Check out the head

Findings about how the PR fits the codebase need the codebase itself, beyond the diff. Build a detached worktree at the PR head, off a **base clone**:

- The base clone is the current directory when `gh repo view --json nameWithOwner` matches the PR's repo. Otherwise it's `~/.cache/pr-brief/<owner>/<repo>`, created on first use with `gh repo clone <owner>/<repo> <path> -- --filter=blob:none --no-checkout`.
- `git -C <base> fetch origin pull/<n>/head`, then `git -C <base> worktree add --detach "$TMPDIR/pr-brief/<repo>-<n>" FETCH_HEAD`. If a leftover worktree is already at that path, `git -C <base> worktree remove --force` it first. For a re-review, also fetch the last-reviewed commit: `git -C <base> fetch origin <oid>`.

The user's own working tree stays untouched. Read the repo's agent docs (`AGENTS.md`, `CLAUDE.md`, at the root and in the touched directories). They state the conventions that findings are measured against. Also read every `CODING_STANDARDS.md` that `git -C <worktree> ls-files '*CODING_STANDARDS.md'` lists at the root or above a touched file; its rules are what Standards findings cite.

## 3. Map the decisions

Read every changed file in the worktree in full, beyond its hunks, and sort each change into a decision or implementation detail. For each decision, pin down:

- what it was before and what it is now
- who depends on it: callers, clients, and consumers, found by grepping the worktree
- whether the PR description states it or the code makes it implicitly
- your **take**: whether it holds up as the codebase grows, and what it commits the team to. A take that it doesn't hold up becomes a Design finding in step 4.

The PR description gives the intended behavior. Where the code does something different, that mismatch is a finding.

Then rate the PR's **merge danger**, meaning what it costs if the merge turns out wrong:

- **Door**: a **two-way door** can be walked back, because a revert restores the state from before the merge. A **one-way door** can't be. Destructive actions (dropped columns, deleted data, irreversible migrations) and hard-to-reverse decisions (a contract that clients pick up before a rollback, emails or payments already sent) are one-way doors. A PR that is cheap to roll back is lower risk.
- **Blast radius**: everything the merge could affect if it's wrong. Consider every surface the change reaches, beyond the code it touches, such as layout shift, breakages for consumers, and mobile responsiveness. The dependents you found for each decision are the starting point.
- **Deploy order**: another PR or deploy that has to land first.

Done when every changed file is accounted for, either inside a named decision or as implementation detail, and the merge danger names its door, every surface in its blast radius, and any deploy order.

## 4. Hunt findings

Check every decision, and the implementation detail behind it, for these kinds of finding. The first three are mechanical:

- **Bug**: a wrong result, crash, data loss, or security hole on a reachable path. Name the input or state that triggers it. A bug that hinges on intent only the author knows is a judgment finding instead.
- **Standards**: a departure from a rule in `CODING_STANDARDS.md`. Quote the rule, because the finding rests on it.
- **Demo**: applies to the PR as a whole. The diff changes frontend UI (components, styles, templates, or user-facing copy), and neither the PR description nor the author's comments attach a demo, such as a screenshot, a recording, or a video link. The consequence is that the reviewer has to judge the UI change without seeing it. The comment asks for a short recording or before-and-after screenshots, and it goes in the review `body` because it belongs to no single line.

The rest are judgment findings:

- **Design**: an anti-pattern or smell whose cost shows up later, such as logic in the wrong layer, a leaky abstraction, a second source of truth, an API that is hard to evolve, or a migration with no backfill or rollback path. Name what gets harder, and for whom.
- **Convention**: a departure from how this codebase already solves the same problem, where no written standard covers it. Cite the existing example (`path:line`), because the finding rests on it.

The bar: every finding names its **consequence**, meaning what breaks or what gets harder later. If you can't name a consequence, it's a nitpick, so drop it. Style, naming, and formatting that a linter or a later edit fixes cheaply fall below the bar, unless a written standard requires them.

Before keeping a finding, re-read the code around it in the worktree, and confirm the trigger and the consequence hold. Check whether a test already covers it. A false finding costs the reviewer more than a missed nitpick, and a false mechanical finding reaches the author under the user's name. A finding already raised in another reviewer's open thread stays in the brief marked _already raised by @login_, and is left out of every review.

On a re-review, a mechanical finding the author disputed in a reply, instead of fixing, turns into a judgment finding. If their argument holds, drop the finding. If it doesn't, keep it in the brief marked _disputed by @author_, so the user settles it.

Done when every decision from step 3 has been checked for every kind, the PR has been checked for a Demo finding, and every finding you kept carries a kind, a location, a consequence, and evidence.

## 5. Request mechanical fixes

When no mechanical finding stands, go to step 6.

Otherwise, post an auto review now, without asking the user. Judgment findings wait for the brief, so leave them out of it.

1. Re-read `headRefOid`. If the head moved since step 1, run step 1 again on the new head.
2. Draft each comment as step 7 describes. A finding still sitting in an open, unanswered thread from an earlier auto review gets no new comment; link it in the body instead.
3. Post the review as step 8 shows, with `"event": "REQUEST_CHANGES"`. The body is one line per finding that has no inline comment, ending with `<!-- pr-brief:auto -->` on its own line.
4. Remove the worktree as step 8 does, and start or relaunch monitoring as step 9 describes.

Tell the user in one line what you asked for and link the review, for example "Requested changes on react-frontend#9661 (2 bugs, missing demo): <url>. I'll brief it once the author responds." Then end your turn.

## 6. Write the brief

The user reads the brief instead of the code. Every sentence should carry a decision, a consequence, or a verdict, so cut anything else. Link every location to the head commit (`https://github.com/<owner>/<repo>/blob/<headRefOid>/<path>#L<line>`) so the user can jump to the code when they need to.

```md
## <PR title> · [<owner>/<repo>#<n>](url)

@<author> · app +<additions> −<deletions> · tests +<additions> −<deletions> · <changedFiles> files

**Recommendation: Approve | Request changes | Comment.** <One sentence: the reason, tied to findings by number.>

### Since your last review <!-- re-reviews only -->

<Your earlier threads, auto reviews included: addressed or still open, one line each. Then what the new commits changed.>

### What it does

<One or two plain-language sentences: the problem, and the outcome once this merges.>

**<Decision in a few words>** · [`path:line`](link)

<Visual of the decision.>

<One sentence, only for what the visual can't show.>

### Merge danger

**<One-way | Two-way> door** · <blast-radius surfaces, a few words each>. <Deploy order, or what a revert can't undo, when either applies.>

### Findings

1. **Design** · [`path:line`](link): <problem>, so <consequence>. _Fix:_ <smallest change that resolves it>.
```

Order the decisions most consequential first. Merge danger stays within two lines.

With no findings, the Findings section reads `None.` Recommend **Request changes** when a disputed mechanical finding, or a Design finding that shouldn't merge as-is, stands. Recommend **Comment** when the verdict hinges on something only the author can answer. Recommend **Approve** otherwise, including when the only findings are worth mentioning but not worth blocking on.

### Visuals

Show each decision as a visual, since the visual is what the user reads. Pick the smallest view that shows it, and include only the fields, calls, and files the decision touches.

| Decision                           | Visual                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------- |
| API or contract                    | `diff` of the contract before and after: signatures and fields, no bodies |
| Data model                         | `diff` of the schema, or a Mermaid `erDiagram` when relations change      |
| Flow across components or services | Mermaid `sequenceDiagram`, or a `diff` of the call tree                   |
| Module boundary or file ownership  | `diff` of a shallow file tree, with a one-line comment per entry          |
| New abstraction or pattern         | The interface as a short code block, plus one call site                   |
| UI structure                       | `diff` of the component tree                                              |
| Logic or an algorithm              | `diff` of pseudocode before and after                                     |

A contract diff at the right grain:

```diff
 type Listing {
   id: ID!
-  price: Float!
+  price: Money!          # new value object: { amountCents, currency }
+  priceHistory: [Money!]!
 }
```

A logic diff at the right grain:

```diff
 on cancel(reservation)
-  refund in full
+  if cancelled within 24h of start
+    refund 50%
+  else
+    refund in full
```

## 7. Ask what to post

Draft each finding's comment in the user's voice: a sentence or two naming the problem and its consequence, plus the fix. When the fix is a small, exact replacement of the commented lines, add a GitHub ` ```suggestion ` block.

Then make one AskUserQuestion call:

- **Findings**: multi-select questions, up to three findings each. Each option's label is `#<n> <short name>`, its description is the consequence, and its `preview` is the exact comment body. End every findings question with a `No comments` option, described as posting none of that question's findings, so the user can leave the PR without review comments. With more than nine findings, list them numbered in text and ask the user to reply with the numbers to post, or `none`.
- **Verdict**: Approve, Request changes, Comment only, or Hold (post nothing). Put your recommendation first, labeled `(Recommended)`.

When the user adds notes to an option, treat them as edits to that comment. With no findings, ask only the verdict question.

## 8. Post the review

Re-read `headRefOid` first. If the head moved while the user was deciding, say so, and re-brief the new commits instead of posting against stale lines.

Post one review that carries the chosen comments and the verdict:

```sh
gh api repos/<owner>/<repo>/pulls/<n>/reviews --input - <<'EOF'
{"commit_id": "<headRefOid>", "event": "APPROVE | REQUEST_CHANGES | COMMENT", "body": "<one or two sentences>",
 "comments": [{"path": "<path>", "line": <line>, "side": "RIGHT", "body": "<comment>"}]}
EOF
```

An inline comment has to land on a line inside the diff. When a chosen finding sits outside it, put it in the review `body` with its link.

Once the review is posted, or the user holds, remove the worktree with `git -C <base> worktree remove --force "$TMPDIR/pr-brief/<repo>-<n>"`. Done when you've reported the review URL, or reported that nothing was posted.

## 9. Monitor the author's response

Decide from the review you just posted:

- **Not monitored yet:** start monitoring when the review asks the author to act, meaning an auto review, a Request changes review, or a Comment review with findings. Read `MONITORING.md` now and run it. After an approval or a hold, the brief is complete.
- **Already monitored** (this run came from a monitor wake): an approval ends the monitoring with `python3 <this-skill-dir>/watch-response.py <PR-URL> --done`. For any other outcome, relaunch the monitor as `MONITORING.md` describes.

Done when the monitor is running, or you've reported that the brief is complete and no monitor is needed.
