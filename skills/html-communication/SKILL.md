---
name: html-communication
description: When the user asks for an HTML writeup of work (NOT as part of the codebase) — a plan, spec, write-up, findings, report, comparison, or diagram — use this skill to write it well.
---

# HTML Communication

## When to Use

Use this skill for any request to produce a readable HTML artifact for a human — whether it is called a plan, a spec, a write-up, findings, a summary, a report, a comparison, or a set of UI mocks. The word "plan" is often absent. What the requests share is: a document to read outside the terminal, and a link to open it.

Do **not** use it for HTML that is part of the product being built (app templates, components, marketing pages). This skill is for documents about work, not shipped UI.

## Writing the HTML

### Settle the brief first

Before writing any markup, know:

- **Audience and job** — who reads this, and what should they understand or decide by the end?
- **Form** — a linear document, a comparison, a report with a recommendation, or something presentation-like?
- **Register** — most of what this skill produces is _workmanlike_: quiet hierarchy, exact spacing, restrained color, direct language. Reach for something more _editorial_ (stronger composition, one memorable visual move) only when the artifact needs to travel further than one reader's inbox.
- **Fidelity** — stay close to the user's own language and structure, especially for plans; don't invent a bigger program than what they gave you.

### Design before you write CSS

Pick, in one pass: the visual premise in one sentence, the hierarchy/layout it implies, which colors carry meaning (and why), and the type roles. The number of colors, columns, and components should follow that idea, not fill a quota.

Avoid the template reflex — a card grid with a new accent color is not a design decision. Cards, pills, gradients, and big numerals are legitimate only when they express real structure in _this_ document. Neutrals count as part of the palette; keep any semantic/status colors distinct from decorative ones.

### Diagrams

When relationships, sequence, topology, state, or hierarchy are the main content rather than prose, read [`references/diagrams.md`](references/diagrams.md) before building. It covers picking the right grammar, progressive disclosure (a stable overview, detail revealed on demand instead of one dense picture), and legibility.

### Build it

- One self-contained `.html` file: inline all CSS and JS, no external requests, no build step — it must still work after upload with nothing else present.
- Favor plain HTML and CSS. Reach for JS only if the content genuinely needs interactivity (tabs, filtering, collapsible sections) — most write-ups don't.
- Semantic structure (`h1`/`h2`/`h3`, `p`, `ul`/`ol`, `table`) so the document has a real outline, not one giant div.
- Real content only — no placeholder copy, decorative stats, or controls that do nothing.
- Keep prose in a readable measure (~65–80ch); let tables, timelines, and code use the full width instead of being squeezed into the same column.
- For reports and findings, keep observation, interpretation, recommendation, and uncertainty visually distinguishable — don't let a guess read with the same weight as a fact.
- For comparisons, align the same attributes across items so the eye doesn't have to remember values while scanning.
- Legible type (system fonts are fine), adequate line-height and spacing between sections, accessible contrast, and a `<meta name="viewport" content="width=device-width, initial-scale=1">` so it reads well on mobile.
- No accidental horizontal overflow — if something is deliberately wide (a table, a timeline), contain it in its own scrolling region rather than blowing out the page.
- Motion only when it explains or gives feedback; if removing an animation loses no meaning, leave it out.

### Before you share it

Reread it as the intended reader, not as its author: does the opening orient them — what this is, why it matters, what needs attention? Check for leftover placeholder text, unfinished sections, or clipped/overflowing content. Then use the `html-upload` skill to upload it and get a shareable link.
