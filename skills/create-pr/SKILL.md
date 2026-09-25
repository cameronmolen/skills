---
name: create-pr
description: Open a pull request for the current changes, then babysit it until it merges. Use when the user wants to open a PR, push changes for review, or babysit an existing PR.
argument-hint: [ENG-xxx]
allowed-tools: Bash, Read, Edit, MultiEdit, Glob, Grep, AskUserQuestion, ToolSearch, mcp__notion__notion-fetch, mcp__notion__notion-search, mcp__notion__notion-update-page, mcp__claude_ai_Notion__notion-fetch, mcp__claude_ai_Notion__notion-search, mcp__claude_ai_Notion__notion-update-page
---

Work the steps in order.

Arguments: `$ARGUMENTS` — an `ENG-xxx` task ID when one is given.

## 1. Determine the branch

- Read the current branch with `git branch --show-current`.
- On a feature branch (anything but `main`, `master`, `staging`), stay on it.
- On `main`/`master`/`staging`, read the changes with `git diff --stat` and `git diff --cached --stat`, then create and check out a kebab-case branch named for them (e.g. `add-user-endpoint`, `fix-search-pagination`).

Done when `git branch --show-current` reports a feature branch.

## 2. Commit

`git status --porcelain` for what is outstanding, `git add -A` to stage it, then commit with a message describing the change.

Done when `git status --porcelain` comes back empty.

## 3. Push

`git push -u origin HEAD`

## 4. Create the PR

### Title

An `ENG-xxx` prefix when a task ID was given, then a brief title-case summary of what the change does: `ENG-1000 Create Get User Endpoint`, `Fix Search Results Pagination`.

Write the summary in plain language describing the user-facing symptom or outcome, not the internal mechanism, class/method name, or implementation detail — a non-engineer skimming the PR list should understand what changed and why it matters. Save the technical specifics for the description body.

| Bad (internal/technical)                                                | Good (plain language)                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Derive `reconcile_facility_listings` Presence Set From Partner Response | Partner Sync Error Wrongly Removes Available Units                             |
| Extend `ListingVariations::Delete` with the Delete-audit Surface        | Update ListingVariation Delete Service to Record Delete History                |
| Refactor `OrgMembership` Query to Fix N+1                               | Host Dashboard Takes 10+ Seconds to Load for Organizations with Many Locations |

### Description

```md
<!-- Summary -->

## Demo

TODO: Add screenshots and/or videos for frontend-facing changes.

**Related Notion ticket:** <!-- Link to Notion ticket -->

<details>
<summary>Design decisions and acceptance criteria</summary>

<!-- Include full breakdown of architectural and design decisions and acceptance criteria here -->
</details>
```

#### Summary

When writing the summary, pick the smallest view that makes the key point clear.

- Show logic or an algorithm as pseudocode:

  ```text
  on(save)
    if content is unchanged
      return cached result
    write new content
    return fresh result
  ```

- Show runtime control flow as a call tree:

  ```text
  submitForm
    createSession
      persistPrompt
      launchAgent
    navigateToSession
  ```

- Show UI structure as a component tree, including state and module boundaries that matter:

  ```tsx
  <SessionPage>(apps / example / src / routes / session.tsx);
  useSessionEvents() < SessionToolbar > <RunSkillButton>(packages / ui);
  ```

- Show file responsibility or a broad refactor as a shallow file tree:

  ```text
  src/
  ├── commands/       # parses user actions
  ├── sessions/       # owns session state
  └── transport/      # sends API requests
  ```

- Show component interaction, control flow, or data flow with Mermaid:

  ```mermaid
  sequenceDiagram
      participant User
      participant UI
      participant Daemon
      User->>UI: choose command
      UI->>Daemon: send expanded prompt
      Daemon-->>UI: stream result
  ```

- Use `diff` when the point is what changes and the surrounding shape already exists. Match the diff shape to the topic.

For a component change:

```diff
<SessionPage>
  useSessionEvents()
  <SessionToolbar>
+    <RunSkillButton />
  <SessionTimeline>
+    <SkillResultCard />
```

For a file-layout change:

```diff
src/
├── commands/
+│   └── show-me.ts       # expands the slash command
├── sessions/
-└── transport.ts
+└── transport/
+    ├── client.ts
+    └── stream.ts
```

For a call-tree or call-stack change:

```diff
submitForm
  createSession
    persistPrompt
+    expandSkillMention
    launchAgent
-  navigateToSession
+  navigateToSession
+    subscribeToEvents
```

For a state or control-flow change:

```diff
on(save)
-  write content
+  if content is unchanged
+    return cached result
+  write new content
+  invalidate cache
```

- Show the whole block when most of it is new, when omitted context would hide ownership or order, or when the user needs a copyable target shape:

```ts
function expandSkill(command: string): string {
  const skillName = command.slice(1)
  return `use the ${skillName} skill`
}
```

##### Guidance

- Place each visual next to the short text it supports. Keep only the calls, files, props, states, and boundaries needed to answer the user's current question or the options to resolve the current discussion point.
- You may use one of these, you may use several, it is unlikely you will use all of them. Use your judgement and don't overwhelm the user.

#### Other Description Sections

- `## Demo` belongs to frontend-facing changes only; leave its TODO line in place for the author's screenshots. Backend, infra, docs, and test-only PRs drop the section.
- `**Related Notion ticket:**` takes the ticket URL, found from the URL given, the `ENG-xxx` ID, the branch name, commit messages, or task context. `N/A` goes in only once all of those come up empty. Hold onto the page ID — step 5 writes back to it.
- The collapsible section carries the design decisions reviewers need (product, architecture, data model, API, UI, testing, migration, compatibility) and the acceptance criteria that shaped the work — this is where the technical specifics belong. Trivial PRs — copy changes, one-line fixes, dependency bumps, mechanical cleanup — drop the section.

### Command

```
gh pr create --title "<title>" --body "<description>"
```

When the PR already exists, `gh pr view --json url,state,number,headRefName,baseRefName` names the target instead.

Done when you hold a PR URL and every placeholder comment in the body has resolved to real content or `N/A`.

## 5. Append the PR to the Notion ticket

Skip when step 4 turned up no ticket.

`PR(s)` is a free-text property on the Project Tasks data source (`collection://9bde6985-9747-4684-b969-c8ecec481b63`). It is **append-only**: Notion's update replaces the whole value, so every write carries the entries already there.

1. Fetch the ticket and read `PR(s)` and `Status` from the `<properties>` block. When `PR(s)` reads back `<omitted />` or truncated, ask the user for its current contents — writing from an unconfirmed value loses whatever it held.
2. Build the `PR(s)` value. Blank field: the new URL alone. Existing entries: those entries verbatim and in order, then `, ` and the new URL. New URL already present: the ticket is already linked, so skip the `PR(s)` write, but still check `Status` below. Any non-URL text carries over verbatim.

   ```
   https://github.com/neiybor/rails-api/pull/11070, https://github.com/neiybor/rails-api/pull/11067
   ```

3. Decide on `Status`. `Status` values on this data source: `Blocked`, `Inbound`, `Ready`, `In progress`, `In review`, `In verification`, `Abandoned`, `Done`. Move it to `In review` only when the current value is `Blocked`, `Inbound`, `Ready`, or `In progress` — those are the states linking a PR should advance out of. Leave `In review`, `In verification`, `Abandoned`, and `Done` untouched; each is either already past this point or a state a human parked it in on purpose, and this step never moves a ticket backward.
4. Write with the Notion update-page tool: the page ID, `command: "update_properties"`, `properties` carrying `"PR(s)"` (when it changed) and `"Status": "In review"` (when step 3 called for it). Skip the call entirely when neither changed.

Done when a re-fetch shows `PR(s)` holding every pre-existing entry plus the new URL and `Status` reflecting step 3's decision; report both alongside the ticket URL. A failed write is reported with the values you meant to write, and step 6 continues.

## 6. Babysit the PR

Read `BABYSITTING.md` now and run it.

Done when the PR is merged or closed.

## Guardrails

- Commit and push through the hooks; `--no-verify` stays out of every command.
- A failing step stops the run and reports the error rather than retrying blindly. Step 5 is the exception: report and carry on to step 6.
