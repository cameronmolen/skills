# Audit lenses

Each **lens** is one angle a PR is audited from. A lens agent runs a single lens across the whole change, and the agent that runs `pr-brief` uses the bar and evidence rules below to verify what the lens agents return.

Audit with **mistrust**: assume the PR is wrong until the code shows otherwise. The description, the ticket, the tests, and the author's comments are claims to check against the code. A passing test proves only what it asserts, and "no behavior change" is a claim like any other. Read every changed file in full, beyond its hunks, and follow callers and callees through the worktree until you've confirmed or ruled out each problem.

## The bar

Every finding names its **consequence**: what breaks, or what gets harder later. A finding with no consequence is a **nitpick**. That covers style, naming, formatting, and anything a linter or a later edit fixes cheaply, unless a written standard requires it. Drop nitpicks.

A finding that clears the bar is one of two severities:

- **Blocking**: merging as-is ships a **bug** or a **security** problem, or the PR fails an objective check the author can fix without the reviewer weighing in. A bug is a wrong result, crash, data loss, regression, or broken consumer on a reachable path. That includes a missed acceptance criterion and a slow path that real data makes time out. A security problem is an exploitable hole or a weakened defense. The objective checks are a break of a written rule in `CODING_STANDARDS.md` or the agent docs (Standards) and a UI change with no demo (Completeness). Blocking findings go to the author automatically, under the user's name.
- **Note**: every other finding, including a departure from an unwritten convention. Notes wait in the brief for the user to post or not, each rated by how much it matters before merge:
  - **High**: shouldn't merge as-is, such as a weakened defense or a design cost that compounds as more code builds on it.
  - **Medium**: worth fixing before merge, though merging first costs little.
  - **Low**: worth a mention, and fine as a follow-up.

A false finding costs the reviewer more than a missed one, and a false blocking finding reaches the author under the user's name. Before you keep a finding, re-read the code around it, confirm its trigger and consequence hold, and check whether a test already covers it.

## Lenses

### Criteria

Check the code against every acceptance criterion you were given. A criterion the change misses, only partly meets, or contradicts is a finding, and so is behavior the description claims that the code doesn't deliver. Quote the criterion and name its source (description or ticket). Also report each criterion you found met, with its evidence, so the brief can show the criteria were checked.

### Completeness

Check that the change does the whole job. Look for every other place the same change is needed but missing: sibling call sites, the other platforms and layouts, error, empty, and loading states, a migration's backfill, config and env vars, docs the change makes wrong, and a `TODO` left in a path that ships. When the diff changes frontend UI (components, styles, templates, or user-facing copy) and neither the description nor the author's comments attach a demo (screenshot, recording, or video link), report a missing demo as a blocking finding on the PR as a whole, located at `PR` instead of `path:line`. Its consequence is that the reviewer has to judge the UI change without seeing it, and its fix is a short recording or before-and-after screenshots.

### Security

Read every path that touches input, auth, secrets, or personal data as an attacker would. An exploitable hole is a finding, so name the input that triggers it. So is a weakened defense with no concrete exploit yet: a broadened permission, a disabled check, a new unauthenticated surface, or sensitive data kept longer or in more places than it needs. Name what an attacker gains if something next to it fails.

### Performance

Look for work that grows with data or traffic: N+1 queries, unbounded queries or loops, missing pagination, a new query with no index behind it, heavy work on a hot path or in the request cycle, oversized payloads, extra renders, and memory that grows without a bound. Name the data size or load that triggers the cost, and say whether production hits it.

### Compatibility

Find every consumer of what the change alters, and check that each one keeps working, both after the deploy and during it. Consumers include API endpoints, GraphQL types, event and job payloads, shared tables, env vars, published packages, and exported signatures. During the deploy, old code runs against the new schema, queued jobs carry old arguments, and installed mobile or cached web clients send old requests. Grep the worktree for each consumer, and when a contract crosses the repo boundary, search the owner's other repos with `gh search code --owner <owner> '<name>'`. Cite an outside consumer as `<owner>/<repo>:path:line`. Report every consumer you found, broken or not, since the brief's blast radius starts from them.

### Tests

Check that each behavior the change adds or alters has a test that would fail if it broke. Report a test that passes without asserting what its name claims, a test that mocks away the code under test, an order- or time-dependent test, and a changed behavior with no test. When the gap hides a bug you can show, the finding is that bug.

### Standards

Check the change against every rule in the `CODING_STANDARDS.md` files and agent docs you were given. A departure is a blocking finding, so quote the rule it breaks. Also check how the codebase already solves the same problem. A departure with no written rule behind it is a finding only when you can cite the existing example as `path:line`, and it is always a note.

### Maintainability

Think past the merge: what gets harder when someone has to change, extend, or debug this code next year? Examples are logic in the wrong layer, a leaky abstraction, a second source of truth, duplication that will drift, hidden coupling, a name that misleads about what the code does, an API that is hard to evolve, and a migration with no rollback path. Name what gets harder, and for whom.

## Return format

Return one block per finding, most severe first:

```md
### <Lens> · <Blocking | High note | Medium note | Low note> · `path:line`

**Problem:** <what is wrong>
**Trigger:** <the input or state that causes it>
**Consequence:** <what breaks or gets harder, and for whom>
**Evidence:** <the code, test, rule, or example that proves it>
**Fix:** <the smallest change that resolves it>
```

Add the met criteria (Criteria lens) or the consumers (Compatibility lens) after the findings. With no findings, return `No findings.` plus anything those two lenses report. Done when every changed file has been read through your lens and every finding you return carries each field.
