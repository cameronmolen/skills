# Reading the ticket graph

Everything here was verified against the live database on 2026-08-26, using PLN-3716 (`Listing ReArch - Callback writes`). Re-verify before assuming any of it still holds.

`Project Tasks` is `collection://9bde6985-9747-4684-b969-c8ecec481b63`. The [`create-project-tasks`](../create-project-tasks/SKILL.md) skill writes this same database. Read it for the create-side property shapes.

## The query

```sql
SELECT "userDefined:ID", "Name", "Status", "Blocked by", "Blocking",
       "PR(s)", "Pull Requests", "Tags", url
FROM "collection://9bde6985-9747-4684-b969-c8ecec481b63"
WHERE "Project" LIKE '%<project-page-id-no-dashes>%'
ORDER BY "Name"
```

Frontier = `Blocked by` empty-or-all-`Done` AND `Status` in (`Ready`, `Inbound`).

`Status` values: `Blocked`, `Inbound`, `Ready`, `In progress`, `In review`, `In verification`, `Abandoned`, `Done`.

A ticket already in `In progress`, `In review`, or `In verification` was picked up by a human outside the orchestrator. `frontier.mjs` reports those as `underway_elsewhere` and counts them against capacity, because they hold a compose stack too. Never launch a second worker on one.

## Field traps

Five of these will silently produce a wrong graph.

**`Blocked by` crosses project boundaries.** A blocker is frequently a ticket in a different project, which the project-scoped query above never returns. Resolve blocker statuses with a second query keyed on the blocker URLs, never by looking them up in the first result set. On PLN-3716, ticket 5's two blockers both live in PLN-3561.

**`Blocking` is not a reciprocal you can rely on.** Within a project-scoped result set it reads `null` on rows that block nothing, while the out-of-project blockers that do point at them are absent entirely. Treat `Blocked by` as the sole authoritative direction and derive the reverse edges yourself.

**Page URLs differ in form by access path.** SQL returns `https://app.notion.com/<32hex>`. `notion-fetch` page properties return `https://app.notion.com/p/<32hex>`. Normalize both to the bare 32-hex id before joining, or every cross-reference misses.

**`userDefined:ID` differs in type by access path.** SQL returns the integer `17368`. `notion-fetch` returns the string `"ENG-17368"`. Canonicalize to `ENG-<n>` in the ledger.

**`Create Branch` is unreadable, so do not plan around it.** It sits in the data source's `notAvailableInQuerySql`, `notion-fetch` returns an opaque `formulaResult://…` handle rather than a value, and fetching its `formulaCode://` URL is rejected by the API with `URL type formulaCode not currently supported`. The same holds for `Blocked By Open Ticket`, `StatusFormula`, and `Needs Attention`. Every formula column on this database is opaque to every tool available.

So the orchestrator mints the branch name and records it in the ledger. That minted name is the branch-to-ticket join key, and it is the only one that exists. `scripts/bootstrap-ledger.mjs` mints `t3code/eng-<id>-<slug>`, matching the convention already in use under `~/.t3/worktrees/rails-api/`.

## Gates

Some tickets are blocked on a human decision rather than on another ticket. Nothing in `Blocked by` can express that, and a worker thread cannot resolve "order-first or preferred-first?". It will pick one and write a day of code on a coin flip.

Detect a gate from all four of these sources. On PLN-3716 the tag was absent and the other three all fired, so the tag alone would have launched a worker straight into an unanswered product question.

1. The `need product input` or `need design` tag on the ticket.
2. A decision node in the project page's Mermaid graph, a `{...}` diamond rather than a `[...]` box. PLN-3716 draws `D5{Invariant direction:<br/>order-first or preferred-first?} --> T5`.
3. Project-page prose: "gated on a product decision", "Open question", "Settle this before pointing any tickets".
4. A ticket-body heading naming a decision. PLN-3716's ticket 5 carries `## THIS NEEDS A DECISION BEFORE IMPLEMENTATION`.

Mark each as `status: "gated"` with `gate.reason` quoting the evidence verbatim. **Surface gates to the operator and refuse to launch them.** A gate clears only when the operator names the ticket and states the decision. Write that decision into `gate.decision` and the ledger before the ticket becomes launchable.

## The Mermaid graph is advisory

The `## Ticket Dependency Graph` block on the project page goes stale, and it diverges from `Blocked by` in both directions.

- It omits real edges. PLN-3716's Mermaid shows no ticket-to-ticket edges at all, while ticket 5 has two genuine (Done) blockers.
- It adds information the relation cannot hold. The `D5` decision node is the project's real gate.

Its prose contradicts its own tables too. On PLN-3716 the `Sites` table is labelled "verified against the code" while carrying a row for a callback that no longer exists.

**Diff it against `Blocked by`, report every divergence, and reconcile nothing silently.** The divergence is usually the most useful thing bootstrap produces.

## Status writeback

Writing `Status` and `PR(s)` back to Notion rides along on a tick a model is already awake for. Never give the poller a Notion token. It has no reason to hold one.

Claiming is part of this. The moment a ticket launches, set `Status` to `In progress`, `Assignee` to `Cameron Molen`, and `Sprint` to the current active Host sprint, so the ticket stops looking available to a human browsing the board. See [`WORKER.md`](WORKER.md#claim-before-launch).

Merge writeback is also part of reconciliation. For every ledger ticket whose orchestrator `status` is `merged` and whose `notion_status` is not `Done`, set the Notion `Status` to `Done`, fetch the ticket to verify it, then update `notion_status` in the ledger. Leave `notion_status` unchanged after a failed write so the next tick retries it.
