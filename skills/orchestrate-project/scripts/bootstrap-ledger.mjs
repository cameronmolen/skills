#!/usr/bin/env node
/**
 * Freeze a project's ticket graph into a ledger.
 *
 *   node bootstrap-ledger.mjs <PLN> < tickets.json
 *
 * stdin is the array the model built from Notion (see ../NOTION-GRAPH.md):
 *   [{ id, name, notion_id, notion_status, blocked_by: [ids], gate: {reason}|null,
 *      pr_url: string|null }]
 *
 * Mints branch names, resolves base branches, rejects cycles, writes ledger.json
 * and dag.json. Refuses to clobber an existing ledger.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import {
  paths,
  writeJson,
  branchFor,
  baseBranchFor,
  chainOrder,
  frontier,
  stackView,
  DONE,
  MAX_CONCURRENCY,
} from "./lib.mjs"

const [pln, ...rest] = process.argv.slice(2)
if (!pln) {
  console.error(
    "usage: bootstrap-ledger.mjs <PLN> [--repo r] [--checkout p] [--base b] [--force] < tickets.json",
  )
  process.exit(2)
}

const arg = (flag, dflt) => {
  const i = rest.indexOf(flag)
  return i === -1 ? dflt : rest[i + 1]
}
const p = paths(pln)
if (existsSync(p.ledger) && !rest.includes("--force")) {
  console.error(
    `ledger already exists at ${p.ledger}. Run tick, or pass --force to rebuild`,
  )
  process.exit(1)
}

const tickets = JSON.parse(readFileSync(0, "utf8"))
if (!Array.isArray(tickets) || tickets.length === 0) {
  console.error("stdin must be a non-empty JSON array")
  process.exit(2)
}
if (!rest.includes("--project-id") && !rest.includes("--no-project-id")) {
  console.error(
    "pass --project-id <id> from orchestrator_capabilities.projects, or --no-project-id if the build predates cross-project launch",
  )
  process.exit(2)
}

const ledger = {
  project: {
    pln,
    notion_url: arg("--url", null),
    repo: arg("--repo", "neiybor/rails-api"),
    // Target project for t3_thread_start. From orchestrator_capabilities.projects.
    project_id: arg("--project-id", null),
    checkout: arg("--checkout", `${process.env.HOME}/neighbor/rails-api`),
    base_branch: arg("--base", "staging"),
    // Intended launch order (topological). `stack` is the real bottom-to-top PR
    // stack, appended to as workers actually launch.
    chain: [],
    stack: [],
    max_concurrency: Number(arg("--cap", MAX_CONCURRENCY)),
    auto_launch: rest.includes("--auto-launch"),
    frozen_at: new Date().toISOString(),
  },
  tickets: {},
}

for (const t of tickets) {
  if (!t.id || !t.name) {
    console.error(`ticket missing id or name: ${JSON.stringify(t)}`)
    process.exit(2)
  }
  const done = DONE.has(t.notion_status)
  ledger.tickets[t.id] = {
    name: t.name,
    notion_id: t.notion_id ?? null,
    notion_status: t.notion_status ?? "Inbound",
    status: done ? "merged" : t.gate ? "gated" : "queued",
    blocked_by: t.blocked_by ?? [],
    gate: t.gate ?? null,
    thread_id: null,
    worktree_path: null,
    branch: branchFor(t.id, t.name),
    base_branch: null,
    stack_index: null,
    pr_base: null,
    // An in-flight relayed operator request: {token, request, sent_at}. Cleared
    // when the worker replies with the token.
    relay: null,
    pr_number: t.pr_url
      ? Number(String(t.pr_url).match(/\/(\d+)\s*$/)?.[1]) || null
      : null,
    last_checked: null,
    launched_at: null,
    last_read_position: 0,
  }
}

// Unknown blockers are out-of-project tickets. Record them as
// already-merged stubs only when the caller resolved them as Done; otherwise
// they are a real wait and must be present.
const missing = []
for (const [id, t] of Object.entries(ledger.tickets)) {
  for (const b of t.blocked_by)
    if (!ledger.tickets[b]) missing.push(`${id} -> ${b}`)
}
if (missing.length) {
  console.error(
    "unresolved blockers (resolve each out-of-project blocker and include it):\n  " +
      missing.join("\n  "),
  )
  process.exit(2)
}

// Cycle check (DFS with colours).
const colour = {}
const stack = []
const walk = (id) => {
  if (colour[id] === 2) return
  if (colour[id] === 1) {
    console.error(`cycle: ${[...stack, id].join(" -> ")}`)
    process.exit(2)
  }
  colour[id] = 1
  stack.push(id)
  for (const b of ledger.tickets[id].blocked_by) walk(b)
  stack.pop()
  colour[id] = 2
}
for (const id of Object.keys(ledger.tickets)) walk(id)

ledger.project.chain = chainOrder(ledger.tickets)
if (!ledger.project.chain) {
  console.error("chainOrder found a cycle the DFS missed")
  process.exit(2)
}

// Nothing is launched yet, so every ticket's base is the stack floor. Each one is
// rewritten to its real parent branch at launch, when the stack tip is known.
for (const id of Object.keys(ledger.tickets))
  ledger.tickets[id].base_branch = baseBranchFor(ledger, id)

mkdirSync(p.root, { recursive: true })
writeJson(p.ledger, ledger)
writeJson(
  p.dag,
  Object.fromEntries(
    Object.entries(ledger.tickets).map(([id, t]) => [id, t.blocked_by]),
  ),
)
console.log(
  JSON.stringify(
    {
      ledger: p.ledger,
      chain: ledger.project.chain,
      stack: stackView(ledger),
      frontier: frontier(ledger),
    },
    null,
    2,
  ),
)
