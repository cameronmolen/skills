# skills

The agent skills I use every day. Several rely on [T3 Code](https://t3.codes)
features, like launching threads and watching PRs, and a few assume a Notion
workspace.

## Install

Install every skill globally:

```sh
npx skills add cameronmolen/skills -g --skill '*'
```

Or one at a time:

```sh
npx skills add cameronmolen/skills --skill create-pr
```

## Skills

| Skill | Say | What it does |
|---|---|---|
| `create-pr` | "open a PR" | Opens a PR for the current changes, links its Notion ticket, and babysits it through CI and review until it merges. |
| `create-project-tasks` | `/create-project-tasks` | Grills you on a Notion project's design, then creates its tasks with acceptance criteria, Figma links, code locations, and a dependency graph. |
| `create-ticket` | "create a ticket" | Asks for the details only you know, then files one ticket in a Notion tasks database. |
| `html-communication` | "write this up in HTML" | Writes a report, dashboard, plan, spec, or diagram as one HTML page, and uploads it for sharing. |
| `html-prototype` | "prototype this" | Copies the real product page from its code into one clickable HTML file, highlights the change, and puts every state one click away. |
| `html-upload` | "share this HTML" | Uploads an HTML file to postplan.dev for a shareable link, revises an existing draft, or reads one from a link. |
| `leaving-pr-comments` | (automatic) | Formats comments that an agent posts on your behalf. |
| `orchestrate-project` | `/orchestrate-project` | Drives a Notion project's tickets to merged as one stacked PR chain, one worker thread per ticket, unattended once you approve the plan. |
| `pr-brief` | "review this PR" | Audits someone else's PR with subagents, requests changes on clear problems, then briefs you on risk and blast radius with a recommended verdict and posts the review you pick. |
| `retro` | `/retro` | Reads this repo's past agent sessions for friction, and suggests fixes to docs, checks, and tooling. |
| `watch-review-requests` | `/watch-review-requests` | Watches GitHub for PRs that request your review, and launches a T3 Code thread that briefs each one. |
| `writing-for-agents` | (automatic) | Style guide for anything an agent reads: skills, `AGENTS.md`, and `CLAUDE.md`. |

Some skills call others. Install the ones they need too:

- `create-pr` uses `create-ticket` and `leaving-pr-comments`.
- `html-communication` and `html-prototype` use `html-upload`.
- `orchestrate-project` uses `create-pr`, and runs tickets that `create-project-tasks` writes.
- `pr-brief` uses `leaving-pr-comments`.
- `retro` uses `writing-for-agents`.
- `watch-review-requests` uses `pr-brief`.

## Requirements

- An authenticated [GitHub CLI](https://cli.github.com) (`gh`) for the PR skills.
- A Notion MCP server for `create-pr`, `create-ticket`, `create-project-tasks`,
  and `orchestrate-project`. `create-project-tasks` also reads Figma designs
  through the Figma MCP server when it is connected.
- [T3 Code](https://t3.codes) for `watch-review-requests` and
  `orchestrate-project`, which launch threads.
- `python3` for `watch-review-requests` and `html-communication`, and Node.js
  for `orchestrate-project` and `html-upload`.
