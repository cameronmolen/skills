---
name: platform-partner-status-update
description: Build a Platform Partner project status update from the Platform Partner Projects database on Notion's Host Team Overview page, then draft it in Slack #platform-partners.
disable-model-invocation: true
argument-hint: [slack | notion-only]
---

# Platform Partner Status Update

Produce a concise, exec-readable status update for Neighbor's platform partner integrations, sourced from Notion, and draft it in Slack `#platform-partners`.

Default behavior: gather from Notion, show the formatted update in chat, then create the Slack **draft** (never send — see Slack rules). If `$ARGUMENTS` contains `notion-only`, stop after showing the update in chat.

## Source IDs

| Thing                                                               | ID                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| Host Team Overview page                                             | `11cf7e1af8c68057ada6ca6fb2fe5611`                  |
| Platform Partner Projects database                                  | `11cf7e1af8c680b1a2b9f205bc823ace`                  |
| Platform Partner Projects data source                               | `collection://38ff7e1a-f8c6-80f9-86d8-000b22a0a8be` |
| Its default view (Priority asc; hides `Pilot in progress` + `Live`) | `view://38ff7e1a-f8c6-8031-b658-000cbeb48d97`       |
| Projects data source (the linked `Project` relation)                | `collection://14c83111-278e-41d4-a805-b470712ca73e` |
| Status Updates data source (named "Status")                         | `collection://dc4ef495-3e7f-460e-8f11-b07fb11ef465` |
| Project Tasks data source                                           | `collection://9bde6985-9747-4684-b969-c8ecec481b63` |
| Slack `#platform-partners`                                          | `C0844P92UAU`                                       |

Never `notion-fetch` the Platform Partner Projects database root or a project page unless you need prose from it — the database fetch is ~105KB and blows the token limit. Use `notion-query-data-sources` in SQL mode instead.

## Step 1 — Pull the partner rows

```sql
SELECT "Priority", "Name", "Status", "Project", "Eng Owner"
FROM "collection://38ff7e1a-f8c6-80f9-86d8-000b22a0a8be"
ORDER BY "Priority" IS NULL, "Priority" ASC
```

The `Name`/`Status`/`Priority` on these rows is the reporting truth. The partner rows themselves are usually blank pages — all narrative lives in the linked `Project` and its status updates.

## Step 2 — Pull recent status updates

```sql
SELECT "Project", datetime("Created time") AS ct, "Eng Build Completion" AS pct, "Status", url
FROM "collection://dc4ef495-3e7f-460e-8f11-b07fb11ef465"
WHERE datetime("Created time") >= '<today minus 7 days> 00:00:00'
ORDER BY ct DESC LIMIT 100
```

The `Status` column **is** the update text. Match rows to partners via the `Project` URL (the partner row's `Project` relation). `@mention` names are stripped in SQL output — if a sentence reads like "\_\_\_ is calling the partner", `notion-fetch` that update's page to recover who owns the action, or infer from the Eng Owner / known team ownership.

For context beyond 7 days on a specific partner, re-run the same query filtered by `"Project" LIKE '%<project-page-id>%'` with no date bound.

## Step 3 — Check what was already posted last week

Before deciding content, pull the last 2–3 weekly posts already sent to `#platform-partners` so you know exactly what the channel has already seen:

```
slack_read_channel channel: C0844P92UAU
```

Find the messages whose first line is `**Platform Partner Projects Weekly Status Update**` and read their per-project bullets. For each partner still under consideration this week, note: what status/label was reported for it last time, and whether a milestone (went live, started a pilot) was already announced.

This is the source of truth for "did we already say this" — not just the 7-day Notion window in Step 2, since a partner can have no new Notion status update yet still be sitting on a stale Slack post, or vice versa.

## Step 4 — Decide who makes the list

Include a partner project when **either**:

1. Its `Priority` is 1, 2, or 3 (ties are fine — include all of them), **or**
2. It had a status update in the last 7 days that is _meaningful_.

Meaningful = new information: a partner reply, a decision, a scope or blocker change, a request of us, a launch/pilot movement. Not meaningful: "still waiting, nothing new", a restatement of last week, or an internal note with no bearing on partner state.

**Cross-check against Step 3 before writing any bullet:**

- If nothing has changed for a project since last week's post, don't invent new color — either drop it (if it doesn't meet rule 1) or repeat the same blocker/state described last time, unchanged, so "no update" stays accurate rather than reworded to look new.
- If last week's post already announced a project going live or starting a pilot, don't re-announce that milestone this week. Only keep the project on the list if something meaningful has happened _since_ that announcement (per the definition above), and lead the sub-bullet with that new development — not a restatement of "went live"/"started pilot".

Everything else is omitted. State the resulting inclusion logic in one line in chat (not in the Slack post) so the reader knows why a project dropped off.

Order the list by `Priority` ascending; unprioritized-but-recently-updated projects go last.

## Step 5 — Get what's actually needed next

For each included project, work out the concrete next action and who owns it. Useful sources, cheapest first:

- The latest 1–3 status updates (usually enough).
- Open tasks, when you need to know whether eng work remains:
  ```sql
  SELECT "Project", "Name", "Status", "Assignee", "Points/Effort/Complexity" AS pts
  FROM "collection://9bde6985-9747-4684-b969-c8ecec481b63"
  WHERE ("Project" LIKE '%<project-id>%' OR ...) AND "Status" NOT IN ('Done','Abandoned')
  ```
  Use these to _characterize_ state ("only verification remains", "build is paused"), never to report counts — see content rules.
- The Projects row, for roadmap/commitment context:
  ```sql
  SELECT "Title", "Status", "Roadmap", "Eng Commitment", "Status Updates", "userDefined:ID" AS id, url
  FROM "collection://14c83111-278e-41d4-a805-b470712ca73e"
  WHERE url LIKE '%<project-id>%'
  ```
- `notion-get-users` with `user_id: <uuid>` to resolve an Eng Owner or Assignee to a name.

## Step 6 — Resolve eng owners to Slack tags

Every main bullet ends with the @-tagged eng owner(s). Resolve them like this:

1. Take the `Eng Owner` UUIDs from the partner row (Step 1).
2. `notion-get-users` with `user_id: <uuid>` → name + `@neighbor.com` email.
3. `slack_search_users` with that **email**, not the name — emails are unambiguous → Slack user ID.
4. Emit `<@U…>` in the Slack message. Slack renders a real mention only from `<@U…>`; a literal `@Cameron Molen` stays plain text.

Known IDs — use directly; only run the lookup chain for owners not listed here:

| Person          | Notion UUID                            | Email                        | Slack ID      |
| --------------- | -------------------------------------- | ---------------------------- | ------------- |
| Cameron Molen   | `5f9adf97-4a7a-4715-884b-d5013e203f56` | cameron@neighbor.com         | `U02SGCZES05` |
| Garrett Bennett | `1e4d872b-594c-81e4-ae33-00029620cd20` | garrett.bennett@neighbor.com | `U08PXTWQ93Q` |

**Multiple owners:** comma-separate them inside one set of parens — `(<@U03JGVADHBM>, <@U02SGCZES05>)`.

**No `Eng Owner` on the partner row** (common — several rows are blank): fall back to the assignee on the project's open tasks, then to the Notion project's `Stakeholders`. If there's still nobody, omit the parens rather than guessing, and flag in chat which projects have no eng owner.

## Content rules

Hard-won from revisions. Follow these exactly.

- **Main bullet = emoji + partner name + status + @-tagged eng owner.** No other detail: `⛔ **_CubeSmart_ – Blocked by partner** (<@U02SGCZES05>)`.
- **1–2 sub-bullets per project. One sentence each.** Many projects need only one. Shorter is better.
- **Sub-bullets carry high-level state and the next action**, not history. Name who owes the next move (the partner, sales, us, a specific engineer).
- **Never report build percentages, completion %, or task counts.** "6 of 8 tasks blocked" and "90% build complete" are noise. Describe the state instead: "Build is paused until…", "Only verification remains before release."
- **Never say "no open tasks."** Say what the code is: "Code complete and fully tested, ready for the first partner to go live on this integration."
- **When a project is blocked, say what specifically is being waited on**, pulled from the status update — not just that it's blocked.
- **Never re-announce a milestone (went live, started a pilot) that a prior week's post already reported.** Check Step 3 first; if nothing meaningful has happened since that announcement, drop the project instead of restating it.
- Keep internal/unverified engineering caveats out of the Slack post; surface them in chat instead, and offer to add as a thread reply.

## Format

The draft tool takes **standard markdown**, so bold is `**double asterisks**` and italic is `_underscores_`. A single `*asterisk*` pair is **italic, not bold** — using it is what makes the header come out italicized. Always use `**` for bold.

Copy this structure exactly — no markdown lists anywhere, literal `•` characters instead:

```
**Platform Partner Projects Weekly Status Update**
⛔ **_CubeSmart_ – Blocked by partner** (<@U02SGCZES05>)
• One sentence on state and what's being waited on.
🟣 **_Premium Parking_ – QA** (<@U03JGVADHBM>, <@U02SGCZES05>)
• One sentence on the last step before release.
🟤 **_Storage360 FMS_ – Ready for pilot** (<@U02SGCZES05>)
• Code complete and fully tested, ready for the first partner to go live on this integration.
• Waiting on sales to connect with pilot partner Omar to launch.
```

### Why literal `•` and not `- ` (settled — do not re-litigate)

Slack's mrkdwn has **no list syntax**. Native Slack lists exist only as `rich_text_list` elements inside a Block Kit `rich_text` block, and neither `slack_send_message` nor `slack_send_message_draft` accepts a `blocks` parameter — both take a markdown string only. Verified by posting `- item` through the tool and reading the message back: it is stored as a literal `•` character in plain text, not as a list element.

**A flush `• ` renders as a proper native-looking Slack bullet.** No leading whitespace is needed or wanted — verified by posting two blocks, one with a leading space before the bullet and one without, and reading both back: they store byte-identically as `• text`. The leading space is silently stripped, so it buys nothing.

**Two leading spaces actively break it.** `  • text` is parsed as a list item and comes out as a literal hyphen (`- text`) instead of a bullet. Never indent a sub-bullet line.

**The draft composer previews this format plainly — that is expected, not a bug.** Slack's draft composer does not apply message-view bullet styling, so the sub-bullets look flat in the draft no matter what markup is used (verified: bullet char, hyphen, `‣`, and blank-line variants all preview without native bullets). The same text renders with proper bullets once the draft is sent. Do not "fix" the format based on how the draft looks in the composer — judge it only from a posted message.

So `- ` buys nothing and costs something. The markdown converter parses the hyphen line as a list item, then treats the **next** line (the following project's main point) as a _lazy continuation_ of that item and indents it. That is the "weird indenting" failure: the first project sits flush left and every project after it is pushed right. Writing `•` yourself means no list is ever created, so nothing can be indented.

### Line-by-line rules

- **The header is `**bold**`**, Title Case, on its own line at the top.
- **Every line starts in column 1.** No leading spaces or tabs on any line, ever.
- **Main-point lines start with the status emoji.** Never prefix them with `-` or `•`.
- **Sub-bullet lines start with a literal `•` followed by one space.** Never `- `, never `*`, never indented.
- **No blank lines anywhere** — not after the header, not between project blocks.
- The partner name is italic _inside_ the bold span (`**_Name_ – Status**`); the `(<@U…>)` owner tag sits outside the bold span at the end of the line.

Accept that wrapped sub-bullets return to column 1 with no hanging indent. That's a limitation of mrkdwn, not something to fix by indenting.

Before calling the draft tool, re-read the message you composed and confirm: every line begins with `**`, an emoji, or `• `; no line begins with a space; no blank lines; no `- ` list markers; and no `*single asterisk*` bold.

### Status → emoji + label

| Notion `Status`    | Emoji | Label in post      |
| ------------------ | ----- | ------------------ |
| Blocked by partner | ⛔    | Blocked by partner |
| Blocked internally | 🔒    | Blocked internally |
| Discovery          | 🔍    | Discovery          |
| Ready              | 🟢    | Ready to build     |
| In progress        | 🟡    | In progress        |
| QA                 | 🟣    | QA                 |
| Pending demo       | ▶️    | Pending demo       |
| Ready for pilot    | 🟤    | Ready for pilot    |
| Pilot in progress  | 🚀    | Pilot in progress  |
| Live               | ✅    | Live               |

`Ready` renders as "Ready to build" — the bare word "Ready" is ambiguous next to "Ready for pilot". `Inbound` has no assigned emoji; if it qualifies for inclusion, ask which to use rather than guessing.

## Slack

Use `slack_send_message_draft` against `C0844P92UAU`. **Draft only — do not send** unless the user explicitly says to post.

Only one attached draft per channel exists at a time; a second call returns `draft_already_exists`, and the user has to clear the old draft in Slack first. Report that plainly if it happens rather than retrying.

Report back with the draft link, the inclusion logic, and any caveat you kept out of the post.
