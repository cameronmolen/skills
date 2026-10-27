# Preferred style

The default look for write-ups: a warm neutral page, white cards, Inter with a GT-Ultra headline, and a short, conclusion-first structure. Light mode only; it ships one appearance on purpose.

## Start from the starter

Copy [`starter.html`](starter.html) to the working directory as the draft and fill it in. It carries the colors as CSS variables, the type roles, the skeleton below, the tooltip, and a `lineChart` helper. Every `{{…}}` is content to write or a section to delete. The draft is done when `grep -c '{{' draft.html` prints `0`.

## Skeleton

Keep this order, and only what carries the conclusion:

1. **Eyebrow**: `context · date`, e.g. `Checkout experiment · Follow-up · Oct 27, 2026`.
2. **Headline** in GT-Ultra that states the conclusion as a claim, not a topic.
3. **Lede**: one or two sentences, with the load-bearing words bolded.
4. **Stat row**, optional: three white stat cards, each `before → after`. Delete it when the story is not a before/after.
5. **Charts**: two or three at most, each in its own white card with an `h2` that says what it shows and a one-line `.sub`.
6. **What this means**: the tinted panel, three bullets, each opening with a bolded lead sentence.
7. **Footnote**: one muted paragraph for periods, definitions, exclusions, and source.

Secondary tables, extra breakdowns, and long caveat lists stay out; a caveat that changes the reading becomes one of the three bullets, the rest go in the footnote or nowhere.

## Type

- Inter for body and UI, the whole page except the `h1`.
- GT-Ultra bold for the `h1` only, `clamp(30px, 4.6vw, 42px)` at 1.15 leading. Section headings, stat values, and chart labels stay Inter.

## Surfaces and ink

- The page is `--page`, a warm neutral. Content sits in white cards with 16px radius, no border, no shadow; cards are the only container.
- The takeaway panel uses `--tint`, a pale cool blue.
- Ink by role: `--ink` for text, `--ink-2` for secondary text, `--muted` for ticks and the footnote, `--grid` for gridlines, `--axis` for the zero line and crosshair.

## Charts

The `dataviz` skill governs chart form and marks; this section only fixes its color inputs. The conventions: 2.5px lines, dots with a 2px white ring, recessive grid, direct labels in place of a legend lookup, a hover tooltip as a white card with `0 8px 24px rgba(0,0,0,.16)`.

Series colors:

- `--s1`, blue `#1767FF`: the primary series. One-series charts use only this.
- `--s2`, amber `#D3832B`: the second series. It passes the `dataviz` validator for CVD separation from `--s1` but sits at 2.98:1 on white, under the 3:1 floor for marks, so its values must be readable as text. Give every point a visible value label on slopegraphs, bars, and dot plots; on a dense line, label the endpoints and every point the prose cites, and let the tooltip carry the rest.
- A brighter amber such as `#FFB500` fails the validator's lightness band. Keep it off marks.
- No third series color is validated. Prefer cutting the chart to two series; when a third is unavoidable, run the candidate through the `dataviz` validator against both before using it.

## Fonts: the embed step

The draft references the fonts as `__INTER__` and `__GT__` placeholders inside `@font-face` `data:` URLs. Fill them as the last step before sharing, with the script in this skill's `scripts/` folder (beside `SKILL.md`):

```sh
uv run <skill-dir>/scripts/embed-fonts.py draft.html out.html
```

The script fetches both fonts once (cached in `~/.cache/html-communication-fonts`), subsets them to Latin plus common punctuation, pins Inter to weights 400–700, and inlines them. Both fonts together add about 60KB. Share `out.html`; keep editing `draft.html` and rerun.

Trade-offs:

- **Subset, the default.** The full look on every machine at about 60KB. A character outside the subset (CJK, emoji, rare symbols) renders in the system fallback font, glyph by glyph; nothing breaks.
- **Full fonts.** Running the script with plain `python3` and no fontTools embeds the fonts whole, about 490KB. Same look, eight times the weight; use it only when `uv` is unavailable.
- **GT-Ultra only**, body on system sans, is not worth it: subset Inter is about 30KB, and dropping it turns the body into SF Pro, Segoe, or Roboto depending on the reader's OS.
