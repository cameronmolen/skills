# skills

AI skills that I actually use

## Skills

<!-- skills-table:start -->
| Skill | Description | Add |
| --- | --- | --- |
| [create-pr](skills/create-pr/) | Open a pull request for the current changes, then babysit it until it merges. Use when the user wants to open a PR, push changes for review, or babysit an existing PR. | `npx skills add cameronmolen/skills --skill create-pr` |
| [create-project-tasks](skills/create-project-tasks/) | Break down a Notion project into implementable tasks in the Project Tasks database. Grills the user on the design, then creates tasks with descriptions, acceptance criteria, Figma links, and code location suggestions. | `npx skills add cameronmolen/skills --skill create-project-tasks` |
| [create-ticket](skills/create-ticket/) | Create a single Notion ticket in Neighbor's Project Tasks database from a user-provided issue, bug report, request, Slack thread, support context, or brief description. Use this whenever the user asks to create, file, open, or write a Notion ticket/task, especially for a bug or product request. | `npx skills add cameronmolen/skills --skill create-ticket` |
| [html-communication](skills/html-communication/) | When the user asks for an HTML writeup of work (NOT as part of the codebase) — a plan, spec, write-up, findings, report, comparison, or diagram — use this skill to write it well. | `npx skills add cameronmolen/skills --skill html-communication` |
| [html-upload](skills/html-upload/) | Upload a local HTML file to postplan. dev and return the shareable URL, publish a new revision of an existing draft in place, or fetch the HTML behind a postplan. dev URL a user supplies. | `npx skills add cameronmolen/skills --skill html-upload` |
| [orchestrate-project](skills/orchestrate-project/) | Drive a Notion project's tickets to merged as one stacked PR chain. One worker thread per ticket, each branched off the one below it, polled and restacked as the bottom merges. | `npx skills add cameronmolen/skills --skill orchestrate-project` |
| [pr-brief](skills/pr-brief/) | Brief a pull request for its human reviewer. Explains the API, data, and architecture decisions it makes, flags bugs and design problems worth a comment, recommends a verdict, posts the comments the user picks, and re-briefs once the author responds. Use when the user wants to understand or review someone else's PR. | `npx skills add cameronmolen/skills --skill pr-brief` |
| [watch-review-requests](skills/watch-review-requests/) | Watch GitHub for PRs requesting your review and brief each one with pr-brief as it arrives. | `npx skills add cameronmolen/skills --skill watch-review-requests` |
<!-- skills-table:end -->
