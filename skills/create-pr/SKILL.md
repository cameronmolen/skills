---
name: create-pr
description: Create and monitor a pull request. Commits staged changes, pushes to remote, opens a PR with a concise title and description, then monitors it for CI failures, flaky checks, mergeability, and review comments until it is merged/closed, user help is required, or it reaches a clean handoff state. Use when the user wants to open a PR, push changes for review, says "create a PR", or asks to babysit, monitor, watch, shepherd, or keep an eye on a PR.
argument-hint: [ENG-xxx]
allowed-tools: Bash, Read, Edit, MultiEdit, Glob, Grep, AskUserQuestion
---

Create a pull request for the current changes, then monitor it until the PR is ready for handoff or needs user direction. Follow these steps exactly:

## 1. Determine the branch

- Arguments provided: `$ARGUMENTS`
- Check if an `ENG-xxx` task ID was provided in the arguments.
- Check the current branch with `git branch --show-current`.
- If already on a feature branch (i.e., not `main`, `master`, or `staging`), stay on it.
- If on `main`/`master`/`staging`, create and check out a new branch:
  - Examine the staged/unstaged changes with `git diff --stat` and `git diff --cached --stat` and come up with a brief, descriptive kebab-case branch name based on the code changes (e.g., `add-user-endpoint`, `fix-search-pagination`).

## 2. Commit changes

- Check if there are uncommitted changes with `git status --porcelain`.
- If there are unstaged changes, stage them with `git add -A`.
- If there are staged changes to commit, create a commit with a clear, concise message describing the changes.
- If everything is already committed, skip this step.

## 3. Push to remote

- Push the branch to origin: `git push -u origin HEAD`.

## 4. Create the PR

Use `gh pr create` with the following:

### Title

- If an `ENG-xxx` task ID was provided in the arguments, prefix the title with it.
- Follow with a brief, title-case description of what the code change does.
- Examples: `ENG-1000 Create Get User Endpoint`, `Fix Search Results Pagination`, `ENG-452 Add Email Verification Flow`

### Description

- Use this format:

```md
<!-- Description -->

## Demo

TODO: Add screenshots and/or videos for frontend-facing changes.

**Related Notion ticket:** <!-- Link to Notion ticket -->

<details>
<summary>Design decisions and acceptance criteria</summary>

<!-- Include full breakdown of architectural and design decisions and acceptance criteria here -->
</details>
```

- Start with the description directly. Keep the description proportional to the change size:
  - For small/simple changes: 1-2 sentences.
  - For complex changes: up to 1 short paragraph.
  - If the PR touches several distinct features or bug fixes, include a short bulleted list of items.
- Include the `## Demo` section only for frontend-facing changes. Leave `TODO: Add screenshots and/or videos for frontend-facing changes.` in that section so the author can add a demo.
- Omit the `## Demo` section for backend-only, infra-only, docs-only, test-only, or other non-frontend-facing changes.
- In `**Related Notion ticket:**`, include the Notion ticket URL when one is provided or can be found from the branch name, commit messages, or task context.
- If an `ENG-xxx` task ID was provided but no Notion ticket URL was provided, find the Notion ticket related to that task ID and include its URL.
- If no Notion ticket is available after checking the provided URL, task ID, branch name, commit messages, and task context, write `N/A`.
- Include the collapsible `Design decisions and acceptance criteria` section when the implementation involved meaningful product, architecture, data model, API, UI, testing, migration, or compatibility decisions that reviewers should understand.
- Also include the collapsible section when acceptance criteria were provided by a ticket, plan, user request, design spec, or review thread and those criteria materially shaped the implementation.
- Omit the collapsible section for trivial PRs where there are no meaningful design decisions and no acceptance criteria beyond the summary, such as copy changes, one-line fixes, dependency bumps, or mechanical cleanup.
- When included, the collapsible section can describe in detail why certain choices were made in the implementation and list the acceptance criteria that guided the work.
- Do NOT include empty placeholder comments in the final PR body. Replace placeholders with real content or `N/A` as appropriate.

### Command

```
gh pr create --title "<title>" --body "<description>"
```

Capture the PR URL from `gh pr create` output. If the PR already exists, find it with `gh pr view --json url,state,number,headRefName,baseRefName` or an equivalent `gh pr status` check and use that PR as the monitoring target.

## 5. Monitor the PR

After the PR exists, babysit it until exactly one of these stop conditions occurs:

- The PR is merged or closed.
- User help is required.
- Handoff milestone: CI is green, the PR is mergeable, and there are no unresolved actionable review items.

Do not merge the PR. A green, mergeable, review-clean PR is a handoff milestone, not permission to merge.

### Core monitoring workflow

1. Prefer a project-specific PR watcher if the repository provides one. Use continuous mode with `--watch` unless intentionally doing a one-shot diagnostic snapshot. If the watcher streams JSON snapshots with an `actions` list, inspect that list before doing anything else.
2. If no watcher exists, poll with `gh` commands:
   - `gh pr view <PR> --json url,state,number,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision,isDraft,reviews,comments,statusCheckRollup`
   - `gh pr checks <PR> --watch --fail-fast` when waiting on checks.
   - `gh run list --branch <headRefName> --commit <headRefOid> --json databaseId,name,conclusion,status,url` when failed checks need run-level details.
3. On every loop, check for newly surfaced review feedback before acting on CI failures or mergeability state.
4. Verify mergeability and merge-conflict status alongside CI with `mergeable`, `mergeStateStatus`, `reviewDecision`, `state`, and `isDraft`.
5. After any push or CI rerun, immediately return to the monitoring loop on the updated SHA/state.

Maintain terminal/session ownership while monitoring is active. Keep consuming watcher output in the same turn. Do not leave a detached `--watch` process running and then end the turn as though monitoring were complete.

### Review feedback

When review feedback appears:

- Inspect the surfaced review items.
- If a review item is actionable and clearly correct, patch the code locally, run appropriate focused checks, commit, and push.
- After the fix is on GitHub, mark the associated review thread/comment as resolved.
- If there is any question about whether to implement the requested change, stop and ask the user first.
- If a human review item is non-actionable, already addressed, incorrect, or better handled with explanation, surface the item and your recommended response to the user.
- Do not post replies to human-authored review comments or review threads unless the user explicitly confirms the exact response text.

Use `gh pr view --json reviews,comments` for top-level feedback. If inline thread resolution matters, use `gh api graphql` to inspect unresolved review threads and resolve only threads that your pushed fix actually addressed.

If both actionable review feedback and failed checks are present, prioritize review feedback first. A new commit will retrigger CI, so avoid rerunning flaky checks on the old SHA unless intentionally deferring the review change.

### CI failures

When CI fails:

- Inspect failed run logs and classify the failure.
- If the failure is likely caused by the current branch, patch code locally, run relevant checks, commit, and push.
- Do not patch random flaky tests, CI infrastructure failures, dependency outages, runner issues, or failures unrelated to the branch.
- If the failure appears flaky or unrelated, rerun failed jobs with `gh run rerun <run-id> --failed` when possible.
- If the failure is ambiguous or the safe next action is unclear, stop and ask the user for help.

For flaky CI failures, rerun only the failed jobs when possible. Avoid broad reruns that hide useful signal unless the available tooling cannot retry failed jobs selectively.

### Mergeability

Check mergeability after reviews and CI are handled:

- If the PR has merge conflicts, attempt to resolve them when the resolution is straightforward and local context is sufficient.
- If conflict resolution requires product judgment, broad refactoring, or choosing between competing human-authored changes, stop and ask the user for help.
- If the PR is green, mergeable, and review-clean, report the handoff milestone and stop without merging.

### Committing and pushing monitoring fixes

When making fixes:

- Keep changes minimal and directly tied to CI, review, or mergeability issues surfaced on the PR.
- Do NOT use `--no-verify` when committing or pushing.
- Use clear commit messages that describe the CI or review fix.
- Push to the PR branch.
- If `--watch` was active before pausing to patch, commit, or push, relaunch `--watch` yourself immediately after pushing.

### User help required

Stop and ask the user before continuing when:

- No target PR can be found.
- A review item may or may not be desirable to implement.
- A response to a human review comment/thread is needed.
- CI failure classification is ambiguous and the next action could waste time or introduce risk.
- Merge conflicts require judgment about intended behavior.
- Required credentials, repository permissions, or tooling are missing.

When asking for help, include the current PR URL, the blocker, what you inspected, and the smallest useful decision you need from the user.

## Important

- Do NOT use `--no-verify` when committing or pushing.
- If any step fails, report the error and stop — do not retry blindly.
