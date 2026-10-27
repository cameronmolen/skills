---
name: html-prototype
description: Prototype a UI change as one clickable HTML file that copies the real product page from its code, with the change highlighted and every state one click away. Use when the user asks for a prototype or mockup of a feature, form, or screen in the product.
---

# HTML Prototype

The prototype is a faithful copy of a **host page** (the real product page as it ships today) with **the change** dropped in. Readers judge the change in context, so the host page has to be indistinguishable from production and the change has to be easy to find.

## 1. Settle the brief

Pin down:

- **The host page**: the route or screen. When it has variants (a header that changes by partner type, a logged-out view), pick the one most readers of this prototype will hit and say which you picked.
- **The change's states**: every distinct look it can take, typically empty or prompt, editing, error, and success. Each becomes a button on the prototype bar.

Done when you can name the host page variant and list every state.

## 2. Read the host page from code

Trace the route to the components it renders, then into the design tokens and the UI kit components the change will reuse (buttons, text fields, headings, dividers). Collect the logo, icons, and the current copy for every section.

Done when every color, font, radius, and spacing value you will write traces to a token or a kit component, and every string on the host page is today's copy. Where the code leaves a value open, match the nearest sibling element instead of inventing one.

## 3. Build

One `.html` file with inline CSS and JS. Link the product's own font files from its CDN, the same URLs the app uses; images and icons go inline as SVG or data URLs.

Page structure, top to bottom:

1. **Prototype bar**: a dark strip outside the host page with a `PROTOTYPE` tag, the title and ticket ID, a button per state, a Mobile / Desktop toggle, and a "Highlight the change" checkbox, on by default.
2. **Stage**: the host page with sample data. Mobile renders inside a 390px device frame; desktop renders at the page's real max width.
3. **The change**, in place on the host page. While the highlight is on, outline it with a dashed accent border and a small `NEW` pill so it reads as the only new thing.
4. **About this prototype**: a short notes list below the stage covering which parts are copied from where (name the route), what is new, the rules behind it, and how to trigger edge states ("enter the renter's own phone to see the error").

Interaction:

- Every state is reachable from the bar and by actually using the change: Save validates, Cancel and Remove go back.
- Validation is live, with realistic rules.
- The URL hash selects a view: `#<state>` and `#<state>-desktop`. It makes each view linkable and is how step 4 screenshots them.
- Wire buttons to click handlers inside a plain `div`; `html-upload` covers why.

Copy for the change is yours to write in the host page's voice. Flag it for Product review in your reply.

## 4. Check every view

Screenshot every state at both sizes with headless Chrome, then open each image:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --screenshot=shots/<state>-<size>.png --window-size=<640 or 1280>,2400 \
  "file://$PWD/prototype.html#<state>[-desktop]"
```

Done when you have viewed every state × size and each one shows the change aligned with its neighbors, no clipped or overflowing content, and spacing that matches the host page's own sections.

## 5. Share

Upload with the `html-upload` skill. Reply with the link, the states and their hash links, which host page variant you used, the copy that needs review, and the local file path. Publish revisions to the same draft.
