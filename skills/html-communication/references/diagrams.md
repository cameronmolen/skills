# Diagrams

Read this when relationships, sequence, topology, state, or hierarchy are the main content — not for ordinary prose sections.

## Pick the grammar before the renderer

Name the question the reader should be able to answer, then choose the form:

| Question                                 | Grammar              |
| ---------------------------------------- | -------------------- |
| What exists, and how is it connected?    | Topology             |
| What happens over time, in order?        | Sequence or timeline |
| What decisions or transformations occur? | Process flow         |
| How can something change?                | State diagram        |
| What contains or owns what?              | Hierarchy            |
| How do alternatives compare?             | Matrix               |

Do not force more than one of these questions into a single overloaded picture. Use coordinated views or a layer toggle instead.

## Progressive disclosure

Keep a stable overview visible at all times; reveal detail only on demand rather than drawing every label and edge case into one dense picture.

- A node that exposes detail must make the affordance obvious, stay keyboard-reachable, and be dismissible without losing the overview underneath.
- Use filtering or layer toggles to cut complexity without hiding context the reader still needs.
- Add pan and zoom only when the information genuinely exceeds the viewport — a diagram that fits should not become a map application.

## Make the structure legible

Establish hierarchy with position, grouping, and whitespace before reaching for color. Route connectors around labels so direction stays unambiguous. Use boundaries to show real ownership, trust, or deployment lines, not decoration.

Avoid identical rounded-box-and-arrow "architecture wallpaper" — a queue, a store, and an actor do not need the same shape or visual weight just because they all appear in the same diagram.

## Choose the medium from the information

- **HTML/CSS** for labeled regions and aligned comparisons.
- **SVG** for crisp relational diagrams and custom connector paths.
- **Canvas** for dense or frequently-changing scenes where many DOM nodes would be wasteful.

## Verify

Check the default overview and every expanded or interactive state: label collisions, edge routing, keyboard operability, `prefers-reduced-motion` behavior, and a narrow-screen fallback.
