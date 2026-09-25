// Shared ledger helpers. No network, no side effects beyond the ledger dir.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

export const MAX_CONCURRENCY = 4

export const root = (pln) => join(homedir(), ".orchestrate-project", pln)
export const paths = (pln) => {
  const r = root(pln)
  return {
    root: r,
    ledger: join(r, "ledger.json"),
    dag: join(r, "dag.json"),
    snapshot: join(r, "pr-snapshot.json"),
    events: join(r, "events.jsonl"),
    wake: join(r, "WAKE"),
  }
}

export const readJson = (p, fallback = null) =>
  existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback

export const writeJson = (p, data) => {
  mkdirSync(join(p, ".."), { recursive: true })
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n")
}

/** Notion page URLs arrive with and without /p/, dashed and undashed. */
export const notionId = (url) => {
  const hex = String(url ?? "")
    .replace(/-/g, "")
    .match(/[0-9a-f]{32}/i)
  return hex ? hex[0].toLowerCase() : null
}

/** SQL gives 17368; notion-fetch gives "ENG-17368". Canonicalize to ENG-17368. */
export const engId = (raw) => {
  const n = String(raw ?? "").match(/(\d+)/)
  return n ? `ENG-${n[1]}` : null
}

export const slug = (name) =>
  name
    .replace(/^\s*\d+[a-z]?[.)]\s*/i, "") // drop the "5. " ordering prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-")

export const branchFor = (id, name) =>
  `t3code/${id.toLowerCase()}-${slug(name)}`

/** The "5. " prefix Notion ticket names carry is the operator's intended order. */
export const orderKey = (name) => {
  const m = String(name ?? "").match(/^\s*(\d+)/)
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY
}

export const DONE = new Set(["Done", "Abandoned"])
export const LAUNCHABLE_NOTION = new Set(["Ready", "Inbound"])
/** A human picked this up outside the orchestrator. Never launch a second worker on it. */
export const UNDERWAY_NOTION = new Set([
  "In progress",
  "In review",
  "In verification",
])

/** Off the stack: merged, abandoned, or Done in Notion. Its branch is no longer a base. */
export const isDone = (tk) =>
  !tk ||
  tk.status === "merged" ||
  tk.status === "abandoned" ||
  DONE.has(tk.notion_status)

/**
 * Intended launch order: a topological sort of the blocker DAG, tie-broken so
 * already-merged work sorts to the bottom, gated work sorts as late as topology
 * allows (a gate in the middle of the stack stalls everything above it), and
 * peers fall back to the "5. " ordering prefix in the ticket name.
 *
 * Returns null on a cycle.
 */
export function chainOrder(tickets) {
  const ids = Object.keys(tickets)
  const indeg = Object.fromEntries(ids.map((id) => [id, 0]))
  const adj = Object.fromEntries(ids.map((id) => [id, []]))
  for (const id of ids)
    for (const b of tickets[id].blocked_by ?? []) {
      if (!tickets[b]) continue
      adj[b].push(id)
      indeg[id]++
    }

  const rank = (id) => (isDone(tickets[id]) ? 0 : tickets[id].gate ? 2 : 1)
  const cmp = (a, b) =>
    rank(a) - rank(b) ||
    orderKey(tickets[a].name) - orderKey(tickets[b].name) ||
    a.localeCompare(b)

  const ready = ids.filter((id) => indeg[id] === 0)
  const out = []
  while (ready.length) {
    ready.sort(cmp)
    const id = ready.shift()
    out.push(id)
    for (const n of adj[id]) if (--indeg[n] === 0) ready.push(n)
  }
  return out.length === ids.length ? out : null
}

/** Bottom-to-top stack entries whose branches are still live bases. */
export const liveStack = (ledger) =>
  (ledger.project.stack ?? []).filter((id) => !isDone(ledger.tickets[id]))

/**
 * The ticket this one branches off. For a ticket already on the stack, that is
 * the nearest live entry below it. For one not yet launched, it is the current
 * stack tip, because a new worker always stacks on top of everything in flight.
 * null means the stack floor, i.e. the project's base branch.
 */
export function stackParentId(ledger, id) {
  const stack = ledger.project.stack ?? []
  const i = stack.indexOf(id)
  const upto = i === -1 ? stack.length : i
  for (let j = upto - 1; j >= 0; j--)
    if (!isDone(ledger.tickets[stack[j]])) return stack[j]
  return null
}

/** Base branch: the parent's branch, or the project base when this sits on the floor. */
export function baseBranchFor(ledger, id) {
  const parent = stackParentId(ledger, id)
  return parent ? ledger.tickets[parent].branch : ledger.project.base_branch
}

/** Everything above `id` on the stack, bottom-to-top. These restack when `id` moves. */
export function dependentsAbove(ledger, id) {
  const stack = ledger.project.stack ?? []
  const i = stack.indexOf(id)
  if (i === -1) return []
  return stack.slice(i + 1).filter((d) => !isDone(ledger.tickets[d]))
}

/**
 * Launchable = not gated, not already started, Notion says it is ready, and every
 * blocker is either merged or already on the stack below it. That last clause is
 * what keeps the stack honest: a worker inherits exactly the branches beneath it,
 * so a blocker that has not been launched yet is not in its ancestry.
 */
export function frontier(ledger) {
  const t = ledger.tickets
  const inStack = new Set(ledger.project.stack ?? [])
  const out = {
    launchable: [],
    gated: [],
    blocked: [],
    held: [],
    running: [],
    open: [],
    merged: [],
    zombie: [],
    underway_elsewhere: [],
  }

  for (const [id, tk] of Object.entries(t)) {
    if (tk.status === "merged") {
      out.merged.push(id)
      continue
    }
    if (tk.status === "zombie") {
      out.zombie.push(id)
      continue
    }
    if (tk.status === "open") {
      out.open.push(id)
      continue
    }
    if (tk.status === "running") {
      out.running.push(id)
      continue
    }
    if (tk.status === "gated" && !tk.gate?.decision) {
      out.gated.push(id)
      continue
    }
    if (tk.status === "abandoned") continue

    const waiting = (tk.blocked_by ?? []).filter(
      (b) => t[b] && !isDone(t[b]) && !inStack.has(b),
    )
    if (waiting.length) out.held.push({ id, waiting_on: waiting })
    else if (LAUNCHABLE_NOTION.has(tk.notion_status)) out.launchable.push(id)
    else if (UNDERWAY_NOTION.has(tk.notion_status))
      out.underway_elsewhere.push(id)
    else
      out.blocked.push({
        id,
        waiting_on: [],
        note: `unexpected Notion status: ${tk.notion_status}`,
      })
  }

  // Launch in the intended chain order so the stack matches the DAG's shape.
  const chain = ledger.project.chain ?? []
  const rank = (id) => {
    const i = chain.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  out.launchable.sort((a, b) => rank(a) - rank(b))

  // Work a human started outside the orchestrator still consumes a compose stack.
  const inFlight =
    out.running.length + out.open.length + out.underway_elsewhere.length
  out.capacity = Math.max(
    0,
    (ledger.project.max_concurrency ?? MAX_CONCURRENCY) - inFlight,
  )
  return out
}

/** Bottom-to-top view of the live stack, for the report and for merge ordering. */
export function stackView(ledger) {
  return liveStack(ledger).map((id, i) => {
    const tk = ledger.tickets[id]
    return {
      position: i,
      id,
      name: tk.name,
      branch: tk.branch,
      base_branch: baseBranchFor(ledger, id),
      status: tk.status,
      pr_number: tk.pr_number,
      pr_base: tk.pr_base ?? null,
      mergeable_now: i === 0 && tk.status === "open",
    }
  })
}

/** Ledger base_branch and the PR's real baseRefName drift apart after a restack. */
export const baseDrift = (ledger, id) => {
  const tk = ledger.tickets[id]
  const want = baseBranchFor(ledger, id)
  return tk.pr_base && tk.pr_base !== want
    ? { id, pr_base: tk.pr_base, want }
    : null
}
