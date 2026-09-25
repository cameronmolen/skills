#!/usr/bin/env node
/**
 * Zero-token PR poller. One `gh pr list` call covers the whole project.
 *
 *   node poll-prs.mjs <PLN> [--quiet]
 *
 * Updates the ledger's PR fields, diffs against pr-snapshot.json, appends only
 * ACTIONABLE edges to events.jsonl, and touches WAKE (plus a macOS notification)
 * when at least one edge needs judgement. A merge with no dependents costs nothing.
 *
 * Runs under launchd. Never touches Notion; never spends a token.
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs"
import {
  paths,
  readJson,
  writeJson,
  frontier,
  dependentsAbove,
  baseBranchFor,
  liveStack,
  DONE,
} from "./lib.mjs"

const [pln, ...rest] = process.argv.slice(2)
const quiet = rest.includes("--quiet")
const p = paths(pln)
const ledger = readJson(p.ledger)
if (!ledger) {
  console.error(`no ledger for ${pln}`)
  process.exit(1)
}

const now = new Date().toISOString()

const gh = (args) =>
  JSON.parse(
    execFileSync("gh", ["pr", "list", "--repo", ledger.project.repo, ...args], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }),
  )

// Two bounded calls, not one unbounded one. Measured 2026-08-26 on neiybor/rails-api:
// `--state all --limit 200` with statusCheckRollup returns HTTP 504 from the GraphQL
// API. Open-with-rollup is ~3.3s and merged-without-rollup is ~0.7s.
let open, merged
try {
  open = gh([
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,headRefName,baseRefName,state,mergedAt,reviewDecision,statusCheckRollup,url",
  ])
  merged = gh([
    "--state",
    "merged",
    "--limit",
    "100",
    "--json",
    "number,headRefName,baseRefName,state,mergedAt,url",
  ])
} catch (e) {
  appendFileSync(
    p.events,
    JSON.stringify({
      at: now,
      kind: "poll_failed",
      detail: String(e.message).slice(0, 400),
    }) + "\n",
  )
  process.exit(1) // launchd logs it; a transient gh failure must not raise a wake
}

// A CheckRun reports `status` + `conclusion`; a StatusContext reports `state`.
// Verified 2026-08-26: an in-flight CheckRun returns conclusion:"" with
// status:"IN_PROGRESS", so keying on `conclusion || state` alone reads every
// running job as an empty string and can never resolve to green.
const FAILED = new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
])
const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"])

const rollup = (pr) => {
  const checks = pr.statusCheckRollup ?? []
  if (checks.length === 0) return "pending"
  const verdicts = checks.map((c) => {
    const status = String(c.status ?? "").toUpperCase()
    if (status && status !== "COMPLETED") return "pending"
    return String(c.conclusion || c.state || "").toUpperCase()
  })
  if (verdicts.some((v) => FAILED.has(v))) return "red"
  if (verdicts.every((v) => PASSED.has(v))) return "green"
  return "pending"
}

const byBranch = new Map([...merged, ...open].map((pr) => [pr.headRefName, pr]))
// A PR that has fallen out of both 100-row windows is looked up exactly. Only
// fires for the handful of tickets that are neither open nor recently merged.
for (const t of Object.values(ledger.tickets)) {
  if (!t.pr_number || byBranch.has(t.branch) || t.status === "merged") continue
  try {
    const one = JSON.parse(
      execFileSync(
        "gh",
        [
          "pr",
          "view",
          String(t.pr_number),
          "--repo",
          ledger.project.repo,
          "--json",
          "number,headRefName,baseRefName,state,mergedAt,reviewDecision,url",
        ],
        { encoding: "utf8" },
      ),
    )
    byBranch.set(one.headRefName, one)
  } catch {
    /* PR genuinely gone; the loop leaves the ticket untouched */
  }
}

const prev = readJson(p.snapshot, {})
const snapshot = {}
const events = []
const greens = []
const emit = (e) => events.push({ at: now, ...e })

for (const [id, t] of Object.entries(ledger.tickets)) {
  const pr = byBranch.get(t.branch)
  if (!pr) {
    t.last_checked = now
    continue
  }

  const state = {
    number: pr.number,
    state: pr.state,
    merged: !!pr.mergedAt,
    checks: rollup(pr),
    review: pr.reviewDecision ?? null,
    base: pr.baseRefName ?? null,
  }
  snapshot[id] = state
  const before = prev[id]

  t.pr_number = pr.number
  t.pr_base = pr.baseRefName ?? t.pr_base ?? null
  t.last_checked = now

  if (state.merged && t.status !== "merged") {
    t.status = "merged"
    // Merging pulls a branch out from under the column above it. Everything above
    // restacks, bottom-to-top, and the one directly above also retargets its PR.
    const above = dependentsAbove(ledger, id)
    if (above.length)
      emit({
        kind: "restack_required",
        id,
        pr: pr.number,
        restack_in_order: above,
        actionable: true,
      })
    else emit({ kind: "merged", id, pr: pr.number, actionable: false })
    continue
  }

  if (pr.state === "CLOSED" && !state.merged && before?.state !== "CLOSED")
    emit({ kind: "pr_closed_unmerged", id, pr: pr.number, actionable: true })

  if (t.status === "running" || t.status === "queued") {
    t.status = "open"
    emit({
      kind: "pr_opened",
      id,
      pr: pr.number,
      url: pr.url,
      actionable: false,
    })
  }

  if (before && before.checks !== "red" && state.checks === "red")
    emit({ kind: "ci_red", id, pr: pr.number, url: pr.url, actionable: true })

  if (
    before &&
    before.review !== state.review &&
    ["CHANGES_REQUESTED", "APPROVED"].includes(state.review)
  )
    emit({
      kind: "review",
      id,
      pr: pr.number,
      decision: state.review,
      url: pr.url,
      actionable: true,
    })

  // Held until every merge in this tick has landed, because both the stack floor
  // and each ticket's wanted base move as the loop records merges.
  if (
    state.checks === "green" &&
    state.state === "OPEN" &&
    before?.checks !== "green"
  )
    greens.push({ id, pr: pr.number, url: pr.url })
}

// The stack merges bottom-up into staging, so a green PR mid-stack is not a real
// ask: only the floor entry can actually be merged. The rest just wait their turn.
const bottom = liveStack(ledger)[0]
for (const g of greens) {
  if (bottom === g.id || !ledger.project.stack?.includes(g.id))
    emit({ kind: "ready_to_merge", ...g, actionable: true })
  else
    emit({ kind: "stack_green", ...g, waiting_on: bottom, actionable: false })
}

// A PR pointing at the wrong base is under review against the wrong diff. Only an
// alarm once the ledger itself considers the ticket settled: between a merge and
// its restack the two disagree by design, and restack_required already covers that.
const drifted = []
for (const [id, t] of Object.entries(ledger.tickets)) {
  if (t.status !== "open" || !t.pr_base) continue
  const want = baseBranchFor(ledger, id)
  if (t.pr_base === want || t.base_branch !== want) continue
  drifted.push(id)
  if (!prev.__drift?.includes(id))
    emit({
      kind: "pr_base_drift",
      id,
      pr: t.pr_number,
      pr_base: t.pr_base,
      want,
      actionable: true,
    })
}
snapshot.__drift = drifted

// Recompute the frontier locally. A newly launchable ticket needs a human under
// the default operator-gated mode, and a launch decision under --auto-launch.
const f = frontier(ledger)
const prevLaunchable = new Set(prev.__launchable ?? [])
const fresh = f.launchable.filter((id) => !prevLaunchable.has(id))
if (fresh.length && f.capacity > 0)
  emit({
    kind: "now_launchable",
    ids: fresh,
    capacity: f.capacity,
    actionable: true,
  })
snapshot.__launchable = f.launchable

// Staleness is measured from the ledger, not from GitHub. A running worker with
// no PR yet is invisible to gh.
const STALE_MS = 45 * 60 * 1000
for (const [id, t] of Object.entries(ledger.tickets)) {
  if (t.status !== "running" || !t.launched_at) continue
  if (
    Date.now() - Date.parse(t.launched_at) > STALE_MS &&
    !prev.__stale?.includes(id)
  )
    emit({
      kind: "possibly_stale",
      id,
      thread_id: t.thread_id,
      actionable: true,
    })
}
snapshot.__stale = Object.entries(ledger.tickets)
  .filter(([, t]) => t.status === "running")
  .map(([id]) => id)

writeJson(p.ledger, ledger)
writeJson(p.snapshot, snapshot)
for (const e of events) appendFileSync(p.events, JSON.stringify(e) + "\n")

const actionable = events.filter((e) => e.actionable)
if (actionable.length) {
  writeFileSync(
    p.wake,
    JSON.stringify({ at: now, edges: actionable }, null, 2) + "\n",
  )
  const summary = actionable
    .map((e) => `${e.kind}: ${e.id ?? (e.ids ?? []).join(",")}`)
    .join("; ")
    .slice(0, 200)
  try {
    execFileSync("osascript", [
      "-e",
      `display notification ${JSON.stringify(summary)} with title ${JSON.stringify(`${pln} needs you`)}`,
    ])
  } catch {
    /* notification is best-effort */
  }
} else if (existsSync(p.wake)) {
  // Leave a pre-existing WAKE alone: the operator has not ticked it yet.
}

if (!quiet)
  console.log(
    JSON.stringify(
      { events, actionable: actionable.length, capacity: f.capacity },
      null,
      2,
    ),
  )
