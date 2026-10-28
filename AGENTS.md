# AGENTS.md

This repo contains personal AI skills.

## Working in This Repo

- Keep skill changes small, focused, and easy to review.
- Use the `/writing-for-agents` skill when creating or updating skills.
- Prefer updating or extending an existing skill when that is simpler than adding a new one.
- Use American English spelling (color, behavior, canceled), except for identifiers or values defined by external APIs.

## Skill Descriptions

A description is written for the agent, not a human reader: what the skill does in one short clause, then `Use when <trigger>`. The human-readable summary lives in the README instead.

## Adding or Changing a Skill

When creating a new skill, review the Claude Code skills documentation first: https://code.claude.com/docs/en/skills

The README is maintained by hand. Whenever a skill is added, removed, or renamed, or its behavior, dependencies, or requirements change, update the README's matching parts in the same change:

- **Skills table**: one row per skill, sorted alphabetically. `Say` is the phrase that triggers it, `/<name>` when it sets `disable-model-invocation: true`, or `(automatic)` when the agent applies it without being asked. `What it does` is a one-sentence, human-readable summary.
- **Dependency list**: add a line, sorted alphabetically, when a skill invokes another skill.
- **Requirements**: add any CLI, MCP server, runtime, or T3 Code feature the skill needs.
