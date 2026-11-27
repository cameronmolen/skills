---
name: drive-browser
description: Drive the user's Ardia browser, with their tabs and logins, from the shell.
disable-model-invocation: true
argument-hint: <task>
allowed-tools: Bash(ardia:*)
---

# Drive Browser

Do the task in `$ARGUMENTS` in the user's own Ardia browser through the `ardia` CLI. If `$ARGUMENTS` is empty, ask the user what to do in the browser.

## Load the guide

Ardia ships an agent guide that matches the installed CLI. It is the source of truth for every command, so load it before the first browser command:

```sh
ardia --skill
```

Skip this when an `ardia` skill is already in context. If `ardia` is not on `PATH`, tell the user to install Ardia and its CLI, then stop.

The guide names reference files such as `references/flows.md`. Print one with:

```sh
ardia skills get --full | awk -v f=references/flows.md '/^--- references\//{p = ($0 == "--- " f " ---"); next} p'
```

## Drive

Follow the guide: start with `ardia browse here` or `ardia browse open <url> --read`, and keep every call in this working directory so the session keeps its tab.

When a command exits 2, Ardia is unreachable. Ask the user to open Ardia and turn on Settings > "Let the ardia command control Ardia", then retry once.

The task is done when its result is checked against fresh `ardia browse` output (a `read`, `form`, or `query` taken after the last action), not assumed from the action that should have caused it. Report that result.
