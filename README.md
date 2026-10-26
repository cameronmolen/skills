# skills

AI skills that I actually use. Many skills contain workflows that rely on tools available in [T3 Code](https://t3.codes).

## Install

Install every skill globally:

```sh
npx skills add cameronmolen/skills -g --skill '*'
```

## Skills

<!-- skills-table:start -->
| Skill | Description | Add |
| --- | --- | --- |
| [create-pr](skills/create-pr/) | Open a pull request for the current changes, then babysit it until it merges. Use when the user wants to open a PR, push changes for review, or babysit an existing PR. | `npx skills add cameronmolen/skills --skill create-pr` |
| [create-project-tasks](skills/create-project-tasks/) | Break down a Notion project into implementable tasks in the Project Tasks database. Grills the user on the design, then creates tasks with descriptions, acceptance criteria, Figma links, and code location suggestions. | `npx skills add cameronmolen/skills --skill create-project-tasks` |
| [create-ticket](skills/create-ticket/) | Create a single Notion ticket in Neighbor's Project Tasks database from a user-provided issue, bug report, request, Slack thread, support context, or brief description. Use this whenever the user asks to create, file, open, or write a Notion ticket/task, especially for a bug or product request. | `npx skills add cameronmolen/skills --skill create-ticket` |
| [html-communication](skills/html-communication/) | When the user asks for an HTML writeup of work (NOT as part of the codebase) — a plan, spec, write-up, findings, report, comparison, or diagram — use this skill to write it well. | `npx skills add cameronmolen/skills --skill html-communication` |
| [html-upload](skills/html-upload/) | Upload a local HTML file to postplan.dev and return the shareable URL, publish a new revision of an existing draft in place, or fetch the HTML behind a postplan.dev URL a user supplies. Use when the user asks to share, upload, or revise an HTML file via Postplan, or gives a postplan.dev link to read. | `npx skills add cameronmolen/skills --skill html-upload` |
| [leaving-pr-comments](skills/leaving-pr-comments/) | Use whenever leaving comments on GitHub. | `npx skills add cameronmolen/skills --skill leaving-pr-comments` |
| [orchestrate-project](skills/orchestrate-project/) | Drive a Notion project's tickets to merged as one stacked PR chain, unattended once the operator approves the plan. One worker thread per ticket, each branched off the one below it; the orchestrator launches, restacks as the bottom merges, and moves each ticket's Notion status through its lifecycle. | `npx skills add cameronmolen/skills --skill orchestrate-project` |
| [pr-brief](skills/pr-brief/) | Brief a pull request for its human reviewer. Audits it through eight lenses with subagents, requests changes on bugs, security problems, coding-standards breaks, and missing demos without asking, then briefs the cleared PR with decision visuals, risk, blast radius, and a recommended verdict, writes a review guide for high-risk PRs, posts the comments and verdict the user picks, and re-briefs once the author responds. Use when the user wants to understand or review someone else's PR. | `npx skills add cameronmolen/skills --skill pr-brief` |
| [retro](skills/retro/) | Conduct a retrospective on the current repo's coding sessions. | `npx skills add cameronmolen/skills --skill retro` |
| [watch-review-requests](skills/watch-review-requests/) | Watch GitHub for PRs requesting your review and launch a T3 Code thread that briefs each one with pr-brief. | `npx skills add cameronmolen/skills --skill watch-review-requests` |
| [writing-for-agents](skills/writing-for-agents/) | Writing documents for agents. Use when creating or editing skills, or modifying AGENTS.md or CLAUDE.md. | `npx skills add cameronmolen/skills --skill writing-for-agents` |
<!-- skills-table:end -->
