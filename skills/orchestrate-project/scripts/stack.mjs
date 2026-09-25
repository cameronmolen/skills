#!/usr/bin/env node
/**
 * The PR stack: plan a launch, record it, and drive restacks. Pure ledger math
 * plus the exact git and gh commands to hand a worker. Never runs git itself.
 *
 *   node stack.mjs <PLN> view
 *   node stack.mjs <PLN> plan <ENG-####>
 *   node stack.mjs <PLN> push <ENG-####> --thread <thread-id> [--worktree <path>]
 *   node stack.mjs <PLN> restack [<ENG-####>]
 *
 * `plan` is read-only and answers "what branch, off what base". `push` appends the
 * ticket to the stack and freezes that answer. `restack` is what you run after a
 * merge: it recomputes every base above the hole and prints the per-worker command.
 */
import {
  paths,
  readJson,
  writeJson,
  baseBranchFor,
  stackParentId,
  dependentsAbove,
  stackView,
  liveStack,
  isDone,
} from "./lib.mjs"

const [pln, cmd, ...rest] = process.argv.slice(2)
const usage =
  "usage: stack.mjs <PLN> view|plan|push|restack [ENG-####] [--thread t] [--worktree p]"
if (!pln || !cmd) {
  console.error(usage)
  process.exit(2)
}

const p = paths(pln)
const ledger = readJson(p.ledger)
if (!ledger) {
  console.error(`no ledger for ${pln}. Run bootstrap first.`)
  process.exit(1)
}
ledger.project.stack ??= []

const arg = (flag) => {
  const i = rest.indexOf(flag)
  return i === -1 ? null : rest[i + 1]
}
const positional = []
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    i++
    continue
  }
  positional.push(rest[i])
}
const id = positional[0] ?? null
const need = (x) => {
  if (!x || !ledger.tickets[x]) {
    console.error(`unknown ticket: ${x}`)
    process.exit(2)
  }
  return x
}

/**
 * The floor is always a remote ref. A parent branch resolves to origin/ once its
 * worker has pushed (a PR number proves it) and to the local branch before that,
 * which only resolves because every worktree shares the one clone's refs.
 */
const baseRef = (base) => {
  if (base === ledger.project.base_branch) return `origin/${base}`
  const parent = Object.values(ledger.tickets).find((t) => t.branch === base)
  return parent?.pr_number ? `origin/${base}` : base
}

const out = (o) => console.log(JSON.stringify(o, null, 2))

if (cmd === "view") {
  out({ stack: stackView(ledger), floor: ledger.project.base_branch })
  process.exit(0)
}

if (cmd === "plan") {
  const t = ledger.tickets[need(id)]
  const base = baseBranchFor(ledger, id)
  out({
    id,
    branch: t.branch,
    base_branch: base,
    base_ref: baseRef(base),
    parent: stackParentId(ledger, id),
    // Only the stack floor has a remote to start from. A parent branch may be local only.
    start_from_origin: base === ledger.project.base_branch,
    pr_base: base,
    stack_index: ledger.project.stack.length,
  })
  process.exit(0)
}

if (cmd === "push") {
  const t = ledger.tickets[need(id)]
  if (ledger.project.stack.includes(id)) {
    console.error(
      `${id} is already on the stack at ${ledger.project.stack.indexOf(id)}`,
    )
    process.exit(1)
  }
  const thread = arg("--thread")
  if (!thread) {
    console.error("push needs --thread <thread-id> from t3_thread_start")
    process.exit(2)
  }

  t.base_branch = baseBranchFor(ledger, id)
  t.pr_base = t.base_branch
  t.stack_index = ledger.project.stack.length
  t.thread_id = thread
  t.worktree_path = arg("--worktree") ?? null
  t.status = "running"
  t.launched_at = new Date().toISOString()
  ledger.project.stack.push(id)

  writeJson(p.ledger, ledger)
  out({
    pushed: id,
    branch: t.branch,
    base_branch: t.base_branch,
    stack_index: t.stack_index,
    stack: stackView(ledger),
  })
  process.exit(0)
}

if (cmd === "restack") {
  // With no id, restack anything whose frozen base no longer matches the stack.
  const targets = id
    ? dependentsAbove(ledger, need(id))
    : liveStack(ledger).filter(
        (d) => ledger.tickets[d].base_branch !== baseBranchFor(ledger, d),
      )

  // A merge moves the branch beneath every entry above it, so the whole column
  // above the hole rebases, bottom-to-top, one worker at a time.
  const plan = targets.map((d) => {
    const t = ledger.tickets[d]
    const from = t.base_branch
    const to = baseBranchFor(ledger, d)
    const ref = baseRef(to)
    return {
      id: d,
      thread_id: t.thread_id,
      branch: t.branch,
      pr_number: t.pr_number,
      base_was: from,
      base_now: to,
      base_changed: from !== to,
      command: [
        "git fetch origin",
        `git rebase --onto ${ref} refs/stack-base/${t.branch} ${t.branch}`,
        `git update-ref refs/stack-base/${t.branch} ${ref}`,
        `git push --force-with-lease origin ${t.branch}`,
      ].join(" && "),
      retarget:
        from !== to && t.pr_number
          ? `gh pr edit ${t.pr_number} --repo ${ledger.project.repo} --base ${to}`
          : null,
    }
  })

  for (const step of plan) {
    ledger.tickets[step.id].base_branch = step.base_now
    if (ledger.tickets[step.id].pr_number)
      ledger.tickets[step.id].pr_base = step.base_now
  }
  writeJson(p.ledger, ledger)
  out({ merged: id ?? null, restack_in_order: plan, stack: stackView(ledger) })
  process.exit(0)
}

console.error(usage)
process.exit(2)
