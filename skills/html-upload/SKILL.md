---
name: html-upload
description: Upload a local HTML file to postplan.dev and return the shareable URL, publish a new revision of an existing draft in place, or fetch the HTML behind a postplan.dev URL a user supplies. Use when the user asks to share, upload, or revise an HTML file via Postplan, or gives a postplan.dev link to read.
---

# HTML Upload

## Upload

```bash
npx postplan upload <plan.html>                # new draft
npx postplan upload <plan.html> --draft <id>   # new version of an existing draft
```

Where `<plan.html>` is the path to the HTML file you want to upload. The command returns a URL — display it to the user.

Reach for `--draft` whenever the document already has a link the user has seen: revising a plan, publishing the next revision of a write-up, correcting anything already circulating. The bare form mints a separate draft every time, which leaves the link they are holding on stale content and both versions live — the CLI has no delete command, so the duplicate cannot be retired afterwards.

**The draft id is the link's subdomain**, so whatever the user pasted is enough to target it — `https://qi37drbp71nr.postplan.dev` or `https://postplan.dev/d/qi37drbp71nr/raw` both give `--draft qi37drbp71nr`.

## Read a Postplan URL

When a user supplies a `postplan.dev` URL, fetch the uploaded HTML immediately with the shell. Do not use web search or a browser to retrieve it.

1. Remove a trailing slash, then append `/raw` unless the URL already ends in `/raw`.
2. Run `curl --fail --silent --show-error --location --max-time 30 --output /tmp/postplan.html '<raw-url>'`.
3. Read `/tmp/postplan.html` as the user's artifact and continue the requested task.
4. When that task is to change the document, publish the edits back to the same link: `--draft <the id in the URL they gave you>`.

A web-search refusal is not evidence that Postplan rejected the request. If `curl` fails, report its actual status or network error; do not substitute search results.
