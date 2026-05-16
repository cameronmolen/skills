---
name: create-project-tasks
description: Break down a Notion project into implementable tasks in the Project Tasks database. Creates tasks with descriptions, acceptance criteria, Figma links, and code location suggestions.
disable-model-invocation: true
argument-hint: <notion-project-url> [figma-url]
---

# Create Project Tasks

Break down a Notion project page into well-defined, implementable tasks and create them in the Project Tasks database.

**Arguments:**
- `$ARGUMENTS` — first argument is the Notion project page URL (required), second is a Figma URL (optional)

Parse the arguments: extract the Notion project URL and optional Figma URL from `$ARGUMENTS`.

---

## Phase 1 — Gather Context

1. **Fetch the Notion project page** using the Notion MCP's fetch tool with the provided URL.
   - Extract: project title, abstract/problem statement, team, any linked Figma files or embedded design references.

2. **Fetch Figma designs** if a Figma URL was provided as an argument OR found on the project page:
   - Use the Figma MCP tools to get design context, screenshots, and metadata for the relevant design nodes.
   - If the design has multiple pages/sections, fetch the structure first, then get screenshots for key sections.
   - If Figma MCP tools are not available, skip this step and note to the user that designs could not be fetched.

3. **Explore the codebase** (if working in a codebase):
   - Use the Explore agent to find relevant existing components, patterns, utilities, and types.
   - Identify reusable code that tasks should reference.

---

## Phase 2 — Ask Clarifying Questions

4. Use `AskUserQuestion` to clarify before defining tasks. Ask when:
   - Feature behavior is ambiguous or missing from the design
   - There's no clear acceptance criteria for a section
   - The design references interactions/flows not fully specified
   - The team isn't clear from the project page
   - Multiple valid implementation approaches exist

5. Confirm **granularity preference**:
   - Feature-level (~6-8 tasks) — each task covers a major feature area
   - Component-level (~10-12 tasks) — each task covers individual components

6. Confirm whether **all designs are final** or if any sections are still in flux.

---

## Phase 3 — Define Tasks

7. Break the project into implementable tasks at the chosen granularity.

8. For each task, draft content following the template in `task-template.md` (located in this skill's directory). Each task must include:
   - **Description**: what needs to be built, key implementation details, existing code to reuse (with file paths)
   - **Design reference (optional)**: include only when a real Figma URL or other concrete design artifact exists and is relevant to the task
   - **Acceptance Criteria**: checkbox list of verifiable outcomes
   - **Code suggestions**: file paths, component names, utilities to reuse

   Additional rules:
   - Do not include a design section for backend, API, infra, data, or other non-UI tasks unless there is an actual design artifact relevant to the work.
   - Do not use the Notion project page URL as a substitute for a design link.
   - If no design artifact exists, omit the design section entirely rather than adding placeholder text like "No Figma was provided."

9. **Assign points** using this scale:

   | Points | Effort |
   |--------|--------|
   | 1 | Half day |
   | 2 | 1 day |
   | 3 | 1.5–3 days |
   | 5 | 3–4 days |
   | 8 | 5–6 days |

   **IMPORTANT — Keep tasks small.** The vast majority of tasks should be 1, 2, or 3 points. If a task feels like a 5 or 8, that's a strong signal it should be split into smaller, more focused tasks. Only use 5 points when the work is truly indivisible (e.g., a single complex algorithm or a tightly coupled migration). 8-point tasks should be extremely rare — essentially never used unless the user explicitly approves after you explain why it can't be split.

   **Before assigning 5+ points**, always attempt to split the task first. Ask yourself:
   - Can the UI and the data/logic layers be separate tasks?
   - Can different sections or components be their own tasks?
   - Can the happy path be one task and edge cases/polish be another?
   - Can the form, validation, and submission be separate tasks?

   If you end up with any 5+ point tasks, flag them in the review summary with a note explaining why they can't be further decomposed.

10. **Build a task dependency graph.** After defining all tasks, create a mermaid flowchart that shows how tasks depend on each other, plus a recommended implementation order.

    - **Flowchart**: Use `flowchart TD` with short node labels (task names or abbreviations). Draw an edge `A --> B` when task B requires task A to be completed first.
    - **Recommended order**: Below the graph, list a numbered sequence of steps. Group tasks that can be worked in parallel on the same step.

    Example format (from a real project):

    ````
    ## Ticket Dependency Graph

    ```mermaid
    flowchart TD
        A[Service foundation and request client]
        B[get_locations]
        C[get_location]
        D[create_reservation]

        A --> B
        A --> D
        B --> C
    ```

    Recommended order:
    1. Service foundation
    2. `get_locations` (depends on foundation)
    3. `get_location` and `create_reservation` (can be parallel)
    ````

    Tips:
    - Every task should appear as a node. Isolated tasks (no dependencies) are fine — they just won't have edges.
    - Keep node labels short but recognizable — use the task name or a clear abbreviation.
    - The recommended order should call out which tasks can be parallelized at each step.

11. **Present the full task list** to the user for review before creating anything. Show:
    - Task name
    - Points
    - Brief summary (1 sentence)
    - Total points across all tasks
    - The dependency graph and recommended order

    Wait for explicit approval before proceeding to Phase 4.

---

## Phase 4 — Create Tasks in Notion

12. **Create all tasks** using the Notion MCP's create-pages tool with:
    - **Parent**: `{"data_source_id": "9bde6985-9747-4684-b969-c8ecec481b63"}` (this is the "Project Tasks" database in Notion — if task creation fails, verify this ID still matches)
    - **Properties for each task**:
      - `Name` — task title (title property)
      - `Status` — `"Inbound"`
      - `Team` — team from the project page (select)
      - `Points/Effort/Complexity` — points as string: `"1"`, `"2"`, `"3"`, `"5"`, or `"8"`
    - **Content**: formatted per `task-template.md`

13. **Link each task to the project** by fetching the Project Tasks database to find the Project relation property, then updating each created task via the Notion MCP's update-page tool to set the Project relation to the source project page.

14. **Add the dependency graph to the project page** using the Notion MCP's update-page tool. Append the mermaid flowchart and recommended order under a `## Ticket Dependency Graph` heading on the project page.

15. **Report back** with a summary table:

    | # | Task Name | Points | Notion URL |
    |---|-----------|--------|------------|
    | 1 | ... | ... | [link](url) |

    Include the total points at the bottom.

---

## Reference

- See `task-template.md` in this skill directory for the content template.
- See `examples/example-task.md` for a concrete example of a well-formatted task.

