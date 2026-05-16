---
name: create-pr
description: Create a pull request. Commits staged changes, pushes to remote, and opens a PR with a concise title and description. Use when the user wants to open a PR, push changes for review, or says "create a PR".
argument-hint: [ENG-xxx]
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *)
---

Create a pull request for the current changes. Follow these steps exactly:

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

- Keep it brief and proportional to the change size.
- For small/simple changes: 1-2 sentences.
- For complex changes: up to 1 short paragraph.
- If the PR touches several distinct features or bug fixes, include a short bulleted list of items.
- Do NOT include verbose boilerplate, checklists, or headers. Just describe what changed and why.

### Command

```
gh pr create --title "<title>" --body "<description>"
```

## Important

- Do NOT use `--no-verify` when committing or pushing.
- If any step fails, report the error and stop — do not retry blindly.
