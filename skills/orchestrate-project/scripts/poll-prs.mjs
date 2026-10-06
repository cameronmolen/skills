#!/usr/bin/env node
/**
 * Zero-token PR poller. Two bounded `gh pr list` calls cover the whole project.
 *
 *   node poll-prs.mjs <PLN>                # one pass, prints its events
 *   node poll-prs.mjs <PLN> --wait <secs>  # a pass every <secs>; exits on the first actionable one
 *
 * Updates the ledger's PR fields, diffs against pr-snapshot.json, and appends
 * events to events.jsonl. Actionable means the orchestrator has work: a merge
 * (Notion, a freed slot, a restack), a PR opening (Notion), a PR closed unmerged,
 * a base drifted off the stack, a ticket newly launchable. CI and review belong to
 * the worker that owns the PR, so they are logged and never wake the orchestrator.
 *
 * `--wait` is the orchestrator's wake signal. It runs as a background task whose
 * exit re-invokes the orchestrator, and it stamps waiter.json on every pass so a
 * heartbeat can tell a live waiter from a dead one. Never touches Notion.
 */
import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import {
  paths,
  readJson,
  writeJson,
  frontier,
  dependentsAbove,
  baseBranchFor,
  liveStack,
} from "./lib.mjs"

const [pln, ...rest] = process.argv.slice(2)
const p = paths(pln)
const waitIdx = rest.indexOf("--wait")
const waitSecs = waitIdx === -1 ? null : Number(rest[waitIdx + 1] ?? 300)

if (!readJson(p.ledger)) {
  console.error(`no ledger for ${pln}`)
  process.exit(1)
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

/** One pass. Re-reads the ledger every time, since the orchestrator writes it between passes. */
function pass() {
  const ledger = readJson(p.ledger)
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
    // A transient gh failure is logged, never a wake.
    const ev = {
      at: now,
      kind: "poll_failed",
      detail: String(e.message).slice(0, 400),
    }
    appendFileSync(p.events, JSON.stringify(ev) + "\n")
    return { failed: true, events: [ev], actionable: [] }
  }

  const byBranch = new Map(
    [...merged, ...open].map((pr) => [pr.headRefName, pr]),
  )
  // A PR that has fallen out of both 100-row windows is looked up exactly. Only
  // fires for the handful of tickets that are neither open nor recently merged.
  for (const t of Object.values(ledger.tickets)) {
    if (!t.pr_number || byBranch.has(t.branch) || t.status === "merged")
      continue
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
      // restacks, bottom-to-top; pending_restack holds the merge until a tick plans it.
      const above = dependentsAbove(ledger, id)
      if (above.length)
        (ledger.project.pending_restack ??= []).push(id)
      emit({
        kind: "merged",
        id,
        pr: pr.number,
        restack_above: above,
        actionable: true,
      })
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
        actionable: true,
      })
    }

    if (before && before.checks !== "red" && state.checks === "red")
      emit({ kind: "ci_red", id, pr: pr.number, url: pr.url, actionable: false })

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
        actionable: false,
      })

    // Held until every merge in this pass has landed, because the stack floor
    // moves as the loop records merges.
    if (
      state.checks === "green" &&
      state.state === "OPEN" &&
      before?.checks !== "green"
    )
      greens.push({ id, pr: pr.number, url: pr.url })
  }

  // Only the floor entry can actually be merged; the rest wait their turn. Either
  // way the owning worker tells the operator, so neither wakes the orchestrator.
  const bottom = liveStack(ledger)[0]
  for (const g of greens) {
    if (bottom === g.id || !ledger.project.stack?.includes(g.id))
      emit({ kind: "ready_to_merge", ...g, actionable: false })
    else
      emit({ kind: "stack_green", ...g, waiting_on: bottom, actionable: false })
  }

  // A PR pointing at the wrong base is under review against the wrong diff. Only an
  // alarm once the ledger itself considers the ticket settled: between a merge and
  // its restack the two disagree by design, and pending_restack already covers that.
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

  // Recompute the frontier locally. A newly launchable ticket is a launch to make.
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

  writeJson(p.ledger, ledger)
  writeJson(p.snapshot, snapshot)
  for (const e of events) appendFileSync(p.events, JSON.stringify(e) + "\n")

  return {
    events,
    actionable: events.filter((e) => e.actionable),
    capacity: f.capacity,
  }
}

const print = (r) =>
  console.log(
    JSON.stringify(
      {
        events: r.events,
        actionable: r.actionable.length,
        capacity: r.capacity,
      },
      null,
      2,
    ),
  )

if (waitSecs === null) {
  const r = pass()
  print(r)
  process.exit(r.failed ? 1 : 0)
}

for (;;) {
  writeJson(p.waiter, {
    pid: process.pid,
    every_secs: waitSecs,
    last_poll: new Date().toISOString(),
  })
  const r = pass()
  if (r.actionable.length) {
    print(r)
    process.exit(0)
  }
  await new Promise((done) => setTimeout(done, waitSecs * 1000))
}
