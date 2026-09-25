---
name: run-rails-console
description: Rails console against real staging or production rails-api data, run headlessly. Use when you need to query live records, read a kill switch, feature flag or other Redis state, or write a production data fix for the user to run.
allowed-tools: Bash, Read, Write, Glob, Grep, AskUserQuestion
---

# Rails console against rails-api

`pod-run.sh`, in this skill folder, execs a deployed rails-api pod and feeds it a Ruby program on stdin.

```bash
cd ~/neighbor/ai-skills/cameron/run-rails-console

./pod-run.sh staging snippet.rb 2>&1 | grep -vE '^[IWDEF], \[|level-experimental|dotenv|SecretsManager|WAREHOUSE|needed in Prod|Google credentials|instance profile'
echo 'puts Organization.count' | ./pod-run.sh production
```

Keep the filter — Rails and AWS bury your output in INFO lines.

You get the real database and **real Redis**.

You get the **deployed image**, not the working tree, so you will not be able to exercise uncommitted code.

## Preflight: the aws-vault session

Every AWS profile requires MFA on `neiybor`. On macOS aws-vault prompts through a **GUI dialog**, so any call that touches credentials **hangs forever** rather than erroring. Read the cached session instead, which touches nothing:

```bash
aws-vault list    # column 3 is the TTL; a negative value like -200h48m40s means expired
```

`pod-run.sh` runs that check itself and refuses to start on a dead session. When it does, stop and ask the user to run this in their own terminal — you cannot answer the prompt:

```bash
aws-vault exec neiybor -- aws sts get-caller-identity
```

## Production is read-only

**Reads against production are yours to run. Writes are the user's.**

A production mutation — `update!`, `create!`, `destroy`, `delete_all`, `update_all`, `upsert_all`, a rake task that writes, anything that changes a row — goes to the user, in your reply, for them to paste into their own console. Write it with the `rails-console-snippet` skill: its `dry_run:` wrapper and `puts` conventions are what let them preview the change before committing it. Then say plainly that you have not run it.

This holds when the user asks you to run it, when the change is one row, when it is obviously correct, and when they approved the plan already. Approval means they run it.

Staging is yours to write to. `bin/rails runner` has no dry-run mode and no undo, so in production the guardrail is the hand-off.

## One call, every question

Each invocation is a full Rails boot in the pod, 20-40s. The marginal query is free; the marginal call is not. Batch every question into one file — before you run it, you should be able to name what you will still not know afterwards.

## Silent failures

These return a plausible answer instead of an error, so they read as findings.

**`select_all` returns Postgres arrays as strings.** An `array_agg` column arrives as the literal `"{0,6}"`, and `Array("{}")` is `["{}"]`, which `.map(&:to_i)` turns into `[0]`. Parse explicitly:

```ruby
def pgarr(v)
  return v.map(&:to_i).uniq.sort if v.is_a?(Array)
  v.to_s.delete('{}').split(',').reject(&:empty?).map(&:to_i).uniq.sort
end
```

**`Rails.env` is `production` in staging pods.** Tell them apart by database name: `neighbor_db_staging` vs `neighbor_db_production`.

## If you hand-roll kubectl

`pod-run.sh` handles these; a bare `kubectl` call does not.

- The image has no `bash` — use `sh`. `bash -lc '…'` fails with `executable file not found in $PATH`.
- The production profile is `prod`. `prodreadonly` fails kubectl auth with `exec: executable aws failed with exit code 254`.
- The selector is `app.kubernetes.io/instance=rails-api` in namespace `rails-api`. `app=rails-api` matches nothing and returns an empty string rather than erroring.

## Writing the snippet

Follow the `rails-console-snippet` skill. Two differences for scripted runs:

- `puts` everything you want to see — `rails runner` does not echo return values.
- Cap what you print. A snippet that dumps 4,000 rows costs more to read than it is worth. Print counts and divergences; list rows only when the list is short, or when you are showing exceptions.
