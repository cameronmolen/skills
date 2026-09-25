---
name: pr-brief
description: Brief a pull request for its human reviewer. Explains the API, data, and architecture decisions it makes, flags bugs and design problems worth a comment, recommends a verdict, posts the comments the user picks, and re-briefs once the author responds. Use when the user wants to understand or review someone else's PR.
argument-hint: <PR URL or number>
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
---

A **brief** lets the reviewer decide a PR's future without reading its code. It is built from two things:

- A **decision** is a choice the codebase will live with after this PR merges. That covers a public API or contract (endpoints, GraphQL types, exported signatures, event payloads), the data model, a module boundary or dependency direction, a new abstraction or pattern, cross-cutting behavior, and config or infra. Everything else is **implementation detail**, and it stays out of the brief unless it carries a finding.
- A **finding** is a problem worth a review comment (the kinds are in step 4).

Arguments: `$ARGUMENTS` is a PR URL or number. With neither, use the PR for the current branch.

## 1. Load the PR

```sh
gh pr view <PR> --json url,number,title,body,author,baseRefName,headRefOid,additions,deletions,changedFiles,files,reviews
gh pr diff <PR>
gh api user --jq .login
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

This is a **re-review** when `reviews` holds one by the user. In that case the brief covers the change since the `commit.oid` of the user's latest review, and reports which of the user's earlier threads the author addressed. If the author merged the base in since then, the delta also carries base changes, so leave those out. If that commit can't be fetched because it was force-pushed away, brief the whole PR.

## 2. Check out the head

Findings about how the PR fits the codebase need the codebase itself, beyond the diff. Build a detached worktree at the PR head, off a **base clone**:

- The base clone is the current directory when `gh repo view --json nameWithOwner` matches the PR's repo. Otherwise it's `~/.cache/pr-brief/<owner>/<repo>`, created on first use with `gh repo clone <owner>/<repo> <path> -- --filter=blob:none --no-checkout`.
- `git -C <base> fetch origin pull/<n>/head`, then `git -C <base> worktree add --detach "$TMPDIR/pr-brief/<repo>-<n>" FETCH_HEAD`. If a leftover worktree is already at that path, `git -C <base> worktree remove --force` it first. For a re-review, also fetch the last-reviewed commit: `git -C <base> fetch origin <oid>`.

The user's own working tree stays untouched. Read the repo's agent docs (`AGENTS.md`, `CLAUDE.md`, at the root and in the touched directories). They state the conventions that findings are measured against.

## 3. Map the decisions

Read every changed file in the worktree in full, beyond its hunks, and sort each change into a decision or implementation detail. For each decision, pin down:

- what it was before and what it is now
- who depends on it: callers, clients, and consumers, found by grepping the worktree
- whether the PR description states it or the code makes it implicitly
- your **take**: whether it holds up as the codebase grows, and what it commits the team to

The PR description gives the intended behavior. Where the code does something different, that mismatch is a finding.

Done when every changed file is accounted for, either inside a named decision or as implementation detail.

## 4. Hunt findings

Check every decision, and the implementation detail behind it, for three kinds of finding:

- **Bug**: a wrong result, crash, data loss, or security hole on a reachable path. Name the input or state that triggers it.
- **Design**: an anti-pattern or smell whose cost shows up later, such as logic in the wrong layer, a leaky abstraction, a second source of truth, an API that is hard to evolve, or a migration with no backfill or rollback path. Name what gets harder, and for whom.
- **Convention**: a departure from how this codebase already solves the same problem. Cite the existing example (`path:line`), because the finding rests on it.

The bar: every finding names its **consequence**, meaning what breaks or what gets harder later. If you can't name a consequence, it's a nitpick, so drop it. Style, naming, and formatting that a linter or a later edit fixes cheaply fall below the bar.

Before keeping a finding, re-read the code around it in the worktree, and confirm the trigger and the consequence hold. Check whether a test already covers it. A false finding costs the reviewer more than a missed nitpick. A finding already raised in another reviewer's open thread stays in the brief marked _already raised by @login_, and is left out of the comment options.

Done when every decision from step 3 has been checked for all three kinds, and every finding you kept carries a location, a consequence, and evidence.

## 5. Write the brief

The user reads the brief instead of the code. Every sentence should carry a decision, a consequence, or a verdict, so cut anything else. Link every location to the head commit (`https://github.com/<owner>/<repo>/blob/<headRefOid>/<path>#L<line>`) so the user can jump to the code when they need to.

```md
## <PR title> · [<owner>/<repo>#<n>](<url>)

@<author> · +<additions> −<deletions> across <changedFiles> files

**Recommendation: Approve | Request changes | Comment.** <One sentence: the reason, tied to findings by number.>

### What it does

<Two or three plain-language sentences: the problem, and the outcome once this merges.>

### Since your last review <!-- re-reviews only -->

<Your earlier threads: addressed or still open, one line each. Then what the new commits changed.>

### Decisions

#### 1. <The decision in a few words>

<What changed and who depends on it, in one or two sentences.> **Take:** <Sound for the long run, or what it commits the team to.>

<Visual, when one earns its place.>

### Findings

1. **Bug** · [`path:line`](<link>): <problem>, so <consequence>. _Fix:_ <smallest change that resolves it>.

### Implementation detail

<One line naming what else changed, e.g. "tests, fixture updates, and a rename in the billing helpers".>
```

With no findings, the Findings section reads `None.` Recommend **Request changes** when a Bug, or a Design finding that shouldn't merge as-is, stands. Recommend **Comment** when the verdict hinges on something only the author can answer. Recommend **Approve** otherwise, including when the only findings are worth mentioning but not worth blocking on.

### Visuals

Pick the smallest view that shows the decision. Include only the fields, calls, and files the decision touches. A decision that one sentence fully explains gets no visual.

| Decision                           | Visual                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------- |
| API or contract                    | `diff` of the contract before and after: signatures and fields, no bodies |
| Data model                         | `diff` of the schema, or a Mermaid `erDiagram` when relations change    |
| Flow across components or services | Mermaid `sequenceDiagram`, or a `diff` of the call tree                 |
| Module boundary or file ownership  | `diff` of a shallow file tree, with a one-line comment per entry        |
| New abstraction or pattern         | The interface as a short code block, plus one call site                 |
| UI structure                       | `diff` of the component tree                                            |
| Logic or an algorithm              | Pseudocode                                                              |

A contract diff at the right grain:

```diff
 type Listing {
   id: ID!
-  price: Float!
+  price: Money!          # new value object: { amountCents, currency }
+  priceHistory: [Money!]!
 }
```

## 6. Ask what to post

Draft each finding's comment in the user's voice: a sentence or two naming the problem and its consequence, plus the fix. When the fix is a small, exact replacement of the commented lines, add a GitHub ` ```suggestion ` block.

Then make one AskUserQuestion call:

- **Findings**: multi-select questions, up to four findings each. Each option's label is `#<n> <short name>`, its description is the consequence, and its `preview` is the exact comment body. With more than twelve findings, list them numbered in text and ask the user to reply with the numbers to post.
- **Verdict**: Approve, Request changes, Comment only, or Hold (post nothing). Put your recommendation first, labeled `(Recommended)`.

When the user adds notes to an option, treat them as edits to that comment. With no findings, ask only the verdict question.

## 7. Post the review

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

## 8. Monitor the author's response

Decide from the review you just posted:

- **Not monitored yet:** start monitoring when the review asks the author to act, meaning a Request changes review or a Comment review with findings. Read `MONITORING.md` now and run it. After an approval or a hold, the brief is complete.
- **Already monitored** (this brief came from a monitor wake): an approval ends the monitoring with `python3 <this-skill-dir>/watch-response.py <PR-URL> --done`. For any other outcome, relaunch the monitor as `MONITORING.md` describes.

Done when the monitor is running, or you've reported that the brief is complete and no monitor is needed.
