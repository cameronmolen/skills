#!/usr/bin/env node
/**
 * Recompute the frontier from the ledger. Pure: no network, no writes.
 *
 *   node frontier.mjs <PLN> [--table]
 */
import { paths, readJson, frontier, baseBranchFor, stackView } from "./lib.mjs"

const [pln, ...rest] = process.argv.slice(2)
const ledger = readJson(paths(pln).ledger)
if (!ledger) {
  console.error(`no ledger for ${pln}. Run bootstrap first.`)
  process.exit(1)
}

const f = frontier(ledger)
// Launchable is already in chain order, and a launch stacks on the tip, so each
// one's base is only knowable after the one before it. Report the first as planned
// and the rest as "stacks on whatever is above by then".
const ready = f.launchable.slice(0, f.capacity).map((id, i) => ({
  id,
  name: ledger.tickets[id].name,
  branch: ledger.tickets[id].branch,
  base_branch:
    i === 0
      ? baseBranchFor(ledger, id)
      : ledger.tickets[f.launchable[i - 1]].branch,
}))

const stack = stackView(ledger)
const out = {
  capacity: f.capacity,
  stack,
  merge_next: stack.find((s) => s.mergeable_now)?.id ?? null,
  launch_now: ready,
  queued_behind_capacity: f.launchable.slice(f.capacity),
  held_blockers_not_stacked: f.held,
  gated: f.gated.map((id) => ({
    id,
    name: ledger.tickets[id].name,
    reason: ledger.tickets[id].gate?.reason,
  })),
  running: f.running,
  open: f.open,
  underway_elsewhere: f.underway_elsewhere,
  zombie: f.zombie,
  merged: f.merged,
  blocked: f.blocked,
}

if (rest.includes("--table")) {
  const row = (k, v) => console.log(`${String(k).padEnd(24)} ${v}`)
  console.log("stack (bottom to top)")
  for (const s of stack)
    console.log(
      `  ${String(s.position).padStart(2)}  ${s.id.padEnd(10)} ${String(s.pr_number ?? "-").padStart(6)}  ${s.branch} <- ${s.base_branch}${s.mergeable_now ? "   <== merge this one next" : ""}`,
    )
  if (!stack.length) console.log("  (empty)")
  console.log("")
  row("capacity", f.capacity)
  row("launch now", ready.map((t) => t.id).join(", ") || "-")
  row("held (blockers)", f.held.map((t) => t.id).join(", ") || "-")
  row("gated", out.gated.map((t) => t.id).join(", ") || "-")
  row("running", f.running.join(", ") || "-")
  row("underway elsewhere", f.underway_elsewhere.join(", ") || "-")
  row("open (awaiting merge)", f.open.join(", ") || "-")
  row("zombie", f.zombie.join(", ") || "-")
  row("merged", f.merged.join(", ") || "-")
} else {
  console.log(JSON.stringify(out, null, 2))
}
