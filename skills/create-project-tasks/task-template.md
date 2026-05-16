# Task Content Template

Use this template when formatting the content (body) of each Notion task page.

---

```
## Description
[2-4 sentences describing what needs to be built. Include key implementation details and context for why this task exists.]

[If applicable: list new components/files to create with proposed file names]

[Optional: include only if a real Figma URL or other design artifact exists and is relevant to the task]
**Design Reference:** [Link text](url)
[Brief note about which part of the design this task covers]

**Existing code to reuse:**
- `ComponentName` — [what it does] (`path/to/file.tsx`)
- `utilityFunction` — [what it does] (`path/to/util.ts`)

**Key implementation details:**
- [Detail 1]
- [Detail 2]

## Acceptance Criteria
- [ ] [Verifiable outcome 1]
- [ ] [Verifiable outcome 2]
- [ ] [Verifiable outcome 3]
```

---

## Guidelines

- **Description** should give an implementer enough context to start working without re-reading the full project spec. Include "what" and "why", not just "what".
- **New components** list is optional — only include when the task involves creating new files. Use proposed file names that follow existing codebase conventions.
- **Design reference** is optional. Include it only when a real Figma URL or other design artifact exists and is relevant to the task.
- If a design reference is included, it should point to the most specific node or artifact possible. If the task covers a broad section, link to the full page and add a note about which area to focus on.
- If no design artifact exists, omit the design section entirely. Do not include placeholder text like "No Figma was provided" and do not use the project page URL as a substitute.
- **Existing code to reuse** helps the implementer avoid reinventing the wheel. Include file paths so they can navigate directly to the code.
- **Key implementation details** captures non-obvious requirements, edge cases, or design decisions that affect implementation.
- **Acceptance Criteria** must be verifiable — each item should be testable by looking at the UI or running a test. Avoid vague criteria like "works correctly". Prefer specific outcomes like "clicking X shows Y" or "API returns Z".

