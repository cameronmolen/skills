---
name: pr-brief
description: Brief a pull request for its human reviewer. Audits it through eight lenses with subagents, requests changes on bugs, security problems, coding-standards breaks, and missing demos without asking, then briefs the cleared PR with decision visuals, risk, blast radius, and a recommended verdict, writes a review guide for high-risk PRs, posts the comments and verdict the user picks, and re-briefs once the author responds. Use when the user wants to understand or review someone else's PR.
argument-hint: <PR URL or number>
allowed-tools: Bash, Read, Glob, Grep, Agent, AskUserQuestion, mcp__notion__notion-fetch, mcp__claude_ai_Notion__notion-fetch, mcp__t3-code__orchestrator_capabilities, mcp__t3-code__delegate_task, mcp__t3-code__task_status, mcp__t3-code__write_pull_request_guides, mcp__t3-code__read_pull_request_guide, mcp__t3-code__link_pull_request, mcp__t3-code__watch_pull_request, mcp__t3-code__unwatch_pull_request
---

A **brief** lets the reviewer decide a PR's future without reading its code. It is built from two things:

- A **decision** is a choice the codebase will live with after this PR merges. That covers a public API or contract (endpoints, GraphQL types, exported signatures, event payloads), the data model, a module boundary or dependency direction, a new abstraction or pattern, a rule in the logic (what gets validated, computed, or branched on), cross-cutting behavior, and config or infra. Everything else is **implementation detail**, and it stays out of the brief unless it carries a finding.
- A **finding** is a problem one of the audit **lenses** turns up. [`LENSES.md`](LENSES.md) defines the lenses, the bar a finding must clear, and its two severities: a **blocking** finding goes straight to the author in an **auto review**, and a **note** waits in the brief for the user.

Arguments: `$ARGUMENTS` is a PR URL or number. With neither, use the PR for the current branch.

Steps 1 through 6 run without asking the user anything. The run ends one of two ways: an auto review while a blocking finding stands (step 4), or, once none stands, the brief and a question about what to post (steps 6 and 7). Settle anything unclear by reading the worktree. When only the author can settle it, put it in the brief as a note whose consequence depends on the answer.

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

The **linked ticket**, when the PR has one, holds acceptance criteria the description may leave out. Look in the title and body for a Notion link or `ENG-xxx` ID (fetch it with the Notion fetch tool) and for a GitHub issue reference (`gh issue view <ref> --json title,body`). Together, the description and the ticket hold the **acceptance criteria** the PR is measured against. If you can't read a linked ticket, say so in the brief instead of guessing at its criteria.

This is a **re-review** when `reviews` holds one by the user. Two commits bound it: the **audit base** is the `commit.oid` of the user's latest review, and the **brief base** is the `commit.oid` of the user's latest review whose body lacks the `<!-- pr-brief:auto -->` marker, the last review the user made after reading a brief. The lenses audit the change since the audit base, and the brief covers the change since the brief base. When every review by the user is an auto review, the user hasn't acted on a brief yet, so brief the whole PR and leave out the brief's Since your last review section. If the author merged the base in since either commit, the delta also carries base changes, so leave those out. If either commit can't be fetched because it was force-pushed away, use the whole PR in its place.

Link the PR to the current thread (if the harness being used supports it).

## 2. Check out the head

Findings about how the PR fits the codebase need the codebase itself, beyond the diff. Build a detached worktree at the PR head, off a **base clone**:

- The base clone is the current directory when `gh repo view --json nameWithOwner` matches the PR's repo. Otherwise it's `~/.cache/pr-brief/<owner>/<repo>`, created on first use with `gh repo clone <owner>/<repo> <path> -- --filter=blob:none --no-checkout`.
- `git -C <base> fetch origin pull/<n>/head`, then `git -C <base> worktree add --detach "$TMPDIR/pr-brief/<repo>-<n>" FETCH_HEAD`. If a leftover worktree is already at that path, `git -C <base> worktree remove --force` it first. For a re-review, also fetch the audit base and the brief base: `git -C <base> fetch origin <oid>`.

The user's own working tree stays untouched. Read the repo's agent docs (`AGENTS.md`, `CLAUDE.md`, at the root and in the touched directories). They state the conventions that findings are measured against. Also read every `CODING_STANDARDS.md` that `git -C <worktree> ls-files '*CODING_STANDARDS.md'` lists at the root or above a touched file; its rules are what the Standards lens cites.

## 3. Audit through the lenses

Read [`LENSES.md`](LENSES.md) now. You verify every finding against it.

Save the diff beside the worktree with `gh pr diff <PR> > "$TMPDIR/pr-brief/<repo>-<n>.diff"`. Then dispatch eight subagents in parallel on GPT 6.1 Sol, one per lens: Criteria, Completeness, Security, Performance, Compatibility, Tests, Standards, and Maintainability. Look up Sol's provider instance and model id with `orchestrator_capabilities`, then, in one message, call `delegate_task` once per lens with that `target`, `mode: "async"`, and a `clientRequestId` of `pr-brief-<repo>-<n>-<head short sha>-<lens>`. Each lens's completion wakes you, so end your turn until all eight are back. When Sol is missing from the catalog, or `delegate_task` is unavailable outside T3, run the lenses as `Agent` subagents on Sonnet (`model: "sonnet"`) instead. A delegated subagent starts without this conversation, so give each one, in its prompt:

- its lens, and the path to `LENSES.md` with the instruction to read the shared sections and its own lens
- the PR URL, the worktree path, and the diff path. On a re-review, also the audit base, with the instruction to audit `git -C <worktree> diff <audit base> HEAD` while reading the full PR for context.
- the acceptance criteria, quoted with their sources, or the reason there are none
- the paths of the agent docs and `CODING_STANDARDS.md` files from step 2
- the existing review threads, so it skips findings already raised. You check the user's own earlier threads yourself, below.
- the instruction to return findings in the format `LENSES.md` gives and to edit nothing

Verify each finding the lenses return before you keep it: re-read the code in the worktree, and confirm the trigger, the consequence, and the severity against the bar. Merge duplicates that several lenses raise, and drop nitpicks and anything you can't confirm. A finding already raised in another reviewer's open thread stays as a note marked _already raised by @login_, and is left out of every review. When a lens agent fails, run that lens again once (a fresh `clientRequestId`, suffixed `-retry`), and if it fails a second time, run it yourself.

On a re-review, also check each blocking finding from the user's earlier auto reviews against the new head. A fixed one is gone. One the author left unfixed and unanswered still stands as blocking. One the author disputed in a reply, instead of fixing, is weighed on the argument: if it holds, drop the finding, and if it doesn't, keep it as a High note marked _disputed by @author_, so the user settles it.

Done when all eight lenses have returned, and every finding you kept carries a lens, a severity, a location, a consequence, and evidence.

## 4. Request fixes

When no blocking finding stands, go to step 5.

Otherwise, post an auto review now, without asking the user. Notes wait for the brief, so leave them out of it.

1. Re-read `headRefOid`. If the head moved since step 1, run steps 1 through 3 again on the new head.
2. Draft each blocking finding's comment in the user's voice: a sentence or two naming the problem and its consequence, plus the fix. When the fix is a small, exact replacement of the commented lines, add a GitHub ` ```suggestion ` block. A finding still sitting in an open, unanswered thread from an earlier auto review gets no new comment; link it in the body instead.
3. Post the review as step 8 shows, with `"event": "REQUEST_CHANGES"`. The body is one line per finding that has no inline comment, ending with `<!-- pr-brief:auto -->` on its own line.
4. Remove the worktree as step 8 does, and start monitoring as step 9 describes.

Tell the user in one line what you asked for and link the review, for example "Requested changes on react-frontend#9661 (2 bugs, 1 standards break, missing demo): <url>. I'll brief it once the author responds." Then end your turn.

## 5. Map the decisions

Read every changed file in the worktree in full, beyond its hunks, and sort each change into a decision or implementation detail. For each decision, pin down:

- what it was before and what it is now
- who depends on it: callers, clients, and consumers, starting from what the Compatibility lens found
- whether the PR description states it or the code makes it implicitly
- your **take**: whether it holds up as the codebase grows, and what it commits the team to

Then rate the PR's **risk**, meaning what it costs if the merge turns out wrong. Judge it from these three, never from size: a ten-line migration can be high risk and a thousand-line UI refactor low.

- **Blast radius**: everything the merge could affect if it's wrong. Consider every surface the change reaches, beyond the code it touches, such as layout shift, breakages for consumers (including those in other repos), and mobile responsiveness. The dependents you found for each decision are the starting point.
- **Door**: a **two-way door** can be walked back, because a revert restores the state from before the merge. A **one-way door** can't be. Destructive actions (dropped columns, deleted data, irreversible migrations) and hard-to-reverse decisions (a contract that clients pick up before a rollback, emails or payments already sent) are one-way doors.
- **Deploy order**: another PR or deploy that has to land first.

The risk level follows:

- **High**: a wrong call at review is expensive to undo, so the reviewer needs to walk the change itself, beyond the brief. The PR is a one-way door, reshapes the architecture (a new module boundary, dependency direction, service, or pattern the rest of the codebase will follow), changes a contract that clients or other services consume, touches money, auth, or data integrity, or needs a deploy order.
- **Medium**: a two-way door whose blast radius reaches past the code it touches, so users, other teams, or shared callers feel a bad merge before a revert lands.
- **Low**: a two-way door with a contained blast radius.

Done when every changed file is accounted for, either inside a named decision or as implementation detail, the blast radius names every surface it reaches, and the risk level names the reason that sets it.

## 6. Write the brief

When the risk is High, start the PR's **review guide** first, so it writes while you write the brief: a T3 Code walkthrough the user reads in the PR's Guide tab. On a re-review, call `read_pull_request_guide` and start one only when no guide exists or it is `stale`. Start it with `write_pull_request_guides({pullRequests: [{url: "<PR URL>"}]})`; it returns once the run is under way. When the tool is unavailable or the call fails (guides off, or no T3 project has the PR's repo), carry on with the brief and give the reason in its recommendation.

The user reads the brief instead of the code. Every sentence should carry a decision, a consequence, or a verdict, so cut anything else. Link every location to the head commit (`https://github.com/<owner>/<repo>/blob/<headRefOid>/<path>#L<line>`) so the user can jump to the code when they need to.

```md
## <PR title> · [<owner>/<repo>#<n>](url)

@<author> · app +<additions> −<deletions> · tests +<additions> −<deletions> · <changedFiles> files

### Since your last review <!-- only when a brief base exists -->

<Threads from your own reviews, never auto reviews: addressed or still open, one line each. Then what the commits since the brief base changed.>

### What it does

<One or two plain-language sentences: the problem, and the outcome once this merges.>

**Acceptance criteria** · <all met | missed or partly met: note numbers | none stated in the PR or ticket | ticket unreadable: reason>

**<Decision in a few words>** · [`path:line`](link)

<Visual of the decision.>

<One sentence, only for what the visual can't show.>

### Notes

1. **High** · Maintainability · [`path:line`](link): <problem>, so <consequence>. _Fix:_ <smallest change that resolves it>.

### Verdict

**Recommendation: Approve | Request changes | Comment | Read the review guide | Review the code yourself.** <One sentence: the reason, tied to notes by number.>

**Risk** · <Low | Medium | High>: <one sentence: the reason, naming the door and any deploy order>.

**Blast radius** · <one sentence: the surfaces it reaches, a few words each>.
```

Show only the decisions the user must understand to judge the PR, at most three, most consequential first. The rest stay out of the brief like implementation detail. Number the notes High first, then Medium, then Low. With no notes, the Notes section reads `None.`

When the risk is High, the user walks the change through its review guide instead of taking a verdict from the brief, so recommend **Read the review guide**, and give the guide's place in the PR's Guide tab in its sentence. When the guide couldn't be written, recommend **Review the code yourself** and give the reason. Otherwise, recommend **Request changes** when a High note stands, **Comment** when the verdict hinges on something only the author can answer, and **Approve** otherwise, including when the only notes are worth mentioning but not worth blocking on.

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
+  if canceled within 24h of start
+    refund 50%
+  else
+    refund in full
```

## 7. Ask what to post

Draft each note's comment as step 4 drafts one. Then, right after the brief, make one AskUserQuestion call:

- **Notes**: multi-select questions, up to three notes each, in note order. Each option's label is `#<n> <short name>`, its description is the severity and consequence, and its `preview` is the exact comment body. End every notes question with a `No comments` option, described as posting none of that question's notes, so the user can leave the PR without review comments. With more than nine notes, list them numbered in text and ask the user to reply with the numbers to post, or `none`.
- **Verdict**: Approve, Request changes, Comment only, or Hold (post nothing). Put your recommended verdict first, labeled `(Recommended)`. When you recommended reading the guide or the code, keep this order and label none.

When the user annotates an option, treat the annotation as an edit to that comment. A comment the user writes out in full posts as written. With no notes, ask only the verdict question.

## 8. Post the review

Re-read `headRefOid` first. If the head moved while the user was deciding, say so, and re-brief the new commits instead of posting against stale lines.

Post one review that carries the chosen comments and the verdict. Comments with no verdict post as a Comment review:

```sh
gh api repos/<owner>/<repo>/pulls/<n>/reviews --input - <<'EOF'
{"commit_id": "<headRefOid>", "event": "APPROVE | REQUEST_CHANGES | COMMENT", "body": "<one or two sentences>",
 "comments": [{"path": "<path>", "line": <line>, "side": "RIGHT", "body": "<comment>"}]}
EOF
```

An inline comment has to land on a line inside the diff. When a chosen finding sits outside it, put it in the review `body` with its link.

Once the review is posted, or the user holds, remove the worktree and diff with `git -C <base> worktree remove --force "$TMPDIR/pr-brief/<repo>-<n>"` and `rm -f "$TMPDIR/pr-brief/<repo>-<n>.diff"`. Done when you've reported the review URL, or reported that nothing was posted.

## 9. Monitor the author's response

Decide from the review you just posted:

- **Asks the author to act** (an auto review, a Request changes review, or a Comment review with comments): read `MONITORING.md` now and start the watch as it describes.
- **Approve**: end any monitoring. Call `unwatch_pull_request` with the PR URL, then `rm -f "${XDG_STATE_HOME:-$HOME/.local/state}/pr-brief-watch/<owner>__<repo>__<n>"`.
- **Hold**: leave monitoring as it is.

Done when the watch is running, or you've reported that the review is complete and no watch is needed.
