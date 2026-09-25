---
name: create-ticket
description: Create a single Notion ticket in Neighbor's Project Tasks database from a user-provided issue, bug report, request, Slack thread, support context, or brief description. Use this whenever the user asks to create, file, open, or write a Notion ticket/task, especially for a bug or product request.
disable-model-invocation: true
argument-hint: <issue-or-request-description>
---

# Create Ticket

Create one Notion ticket in the Project Tasks database from the request in `$ARGUMENTS`.

The goal is fast capture, not investigation. Preserve the user's context clearly enough that an engineer or PM can pick up the work later.

## Inputs

- `$ARGUMENTS` — the issue, bug report, feature request, links, screenshots, user impact, reproduction notes, or other context provided by the user.

If `$ARGUMENTS` is empty, ask the user for the ticket description before continuing.

## Hard Boundaries

- Do not inspect, search, or research the codebase to determine root cause, affected files, implementation details, or possible fixes.
- Do not create a debugging plan unless the user explicitly provided one as context to include.
- Do not invent missing facts. If a field is unclear and required to create a useful ticket, ask a concise clarifying question.
- Do not split the request into multiple tickets unless the user explicitly asks for multiple tickets.
- Only select Notion tags from the `Allowed Tags` list in this file. Do not create, infer, normalize, or substitute tags outside that list, even if Notion or the request suggests a plausible tag.

## Allowed Tags

- `rails api`
- `web`
- `admin`
- `payments`
- `ios`
- `android`
- `devops`

## Workflow

1. **Parse the supplied context.**
   - Identify whether the request is a bug, product request, operational task, investigation request, or cleanup.
   - Extract every provided URL and preserve it for the ticket body.
   - Capture concrete details the user supplied, such as affected user/account/listing IDs, expected behavior, actual behavior, reproduction steps, screenshots, Slack threads, support tickets, logs, dates, environments, or priority signals.

2. **Choose ticket properties.**
   - `Name`: concise action-oriented title in Title Case. Write it so a non-technical stakeholder (support, sales, ops) can understand what's wrong or wanted without knowing the codebase — name the user-facing symptom or outcome, not the internal mechanism.
   - `Status`: `Inbound`.
   - `Team`: `Host`, `Renter`, `Enablement`, or `SEO`. Infer from the request when obvious. If it is not clear, ask the user for the team before creating the ticket.
   - `Is Bug`: `Is Bug` when the request describes broken, incorrect, regressed, or unexpected behavior. Otherwise `Not Bug`.
   - `Tags`: choose useful tags only from `Allowed Tags`, based on the supplied context. Include tags only when that domain is clearly present in the provided context. If none of the allowed tags clearly apply, leave `Tags` empty.

3. **Draft the ticket body.**
   - Include a `## Description` and a `## Acceptance Criteria` section.
   - Summarize the problem or request in plain language so even a non-engineer could understand.
   - Include as much supplied context as possible without codebase research.
   - Include links under a clearly labeled line or list when links were provided.
   - For bugs, include provided expected behavior, actual behavior, reproduction steps, impact, and evidence when available.
   - For non-bugs, include the requested outcome, motivation, known constraints, and acceptance notes when available.
   - If important details are missing, include a short `Open questions` subsection in the body rather than inventing answers.

4. **Create the Notion page.**
   - Use the Notion MCP's create-page/create-pages tool.
   - Parent: `{"data_source_id": "9bde6985-9747-4684-b969-c8ecec481b63"}`.
   - Properties:
     - `Name` — ticket title
     - `Status` — `Inbound`
     - `Team` — `Host`, `Renter`, `Enablement`, or `SEO`
     - `Tags` — selected tags
     - `Is Bug` — `Is Bug` or `Not Bug`
   - Content: the drafted ticket body beginning with `## Description`.

5. **Report back.**
   - Provide the created ticket title.
   - Provide the Notion URL.
   - Mention the selected `Team`, `Tags`, and `Is Bug` values.

## Writing for Non-Technical Readers

The `Name` and the `## Description` summary are the two things a non-engineer (support, sales, ops, PM) will actually read. Both must describe the user-facing symptom or outcome in plain language — never the internal mechanism, class/method name, or implementation guess. Save technical specifics (endpoints, table names, stack traces) for the `Context` bullets underneath, where an engineer is the reader.

A quick test: if someone outside engineering wouldn't know what part of the product is affected or why they should care, rewrite it.

| Bad (internal/technical)                                              | Good (plain language)                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Derive reconcile_facility_listings Presence Set From Partner Response | Partner Sync Error Wrongly Removes Available Units                             |
| Extend ListingVariations::Delete with the Delete-audit Surface        | Update ListingVariation Delete Service to Record Delete History                |
| Refactor `OrgMembership` Query to Fix N+1                             | Host Dashboard Takes 10+ Seconds to Load for Organizations with Many Locations |

## Ticket Body Template

```markdown
## Description

[One-paragraph summary of the issue or request using only supplied context.]

Context:

- [Relevant detail provided by the user including hyperlinks]
- [Relevant IDs, screenshots, dates, environments, or impact]

Reproduction steps:

- [Only if provided]

Open questions:

- [Only include material unknowns that remain after parsing the request]

## Acceptance Criteria

- [ ] [Acceptance criteria item]
```

Omit empty subsections. Keep the final body concise but complete.
