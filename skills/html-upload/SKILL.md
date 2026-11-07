---
name: html-upload
description: Publish an HTML file for a shareable link, as a Claude artifact or on postplan.dev, or read one back from its link. Use when the user asks to share, upload, or revise an HTML file, or gives a postplan.dev or claude.ai artifact link.
---

# HTML Upload

## Pick the host

A revision stays on the host of the link the user already holds. A new upload goes to a **Claude artifact** when you have a tool that publishes them (Claude Code's `Artifact` tool), and to **Postplan** otherwise.

## Claude artifact

Publish the finished file as a page: `Artifact` with `file_path` and a one-word `icon`, then give the user the link. The HTML is already the deliverable, so publish it directly; skip the quickstart and the Artifact types, which would rebuild it as a Doc or Dashboard.

Load `artifact-design` as the tool requires. Its page contract applies in full: a two-to-four-word `<title>`, and every asset inline (scripts only from its allowed CDNs, stylesheets only from Google Fonts). On design, the writing skill's look wins, including a light-only page; `artifact-design` fills only what that skill leaves open.

Artifacts start private. Tell the user the link is private until they share it from claude.ai.

**Revise** by publishing to the same artifact: the same `file_path` within this session, or `url` from another one, after an `action: "read"` of it.

**Read** a `claude.ai/artifact/…` or `claude.ai/code/artifact/…` link with `Artifact` `action: "read"`, then continue the requested task.

## Postplan

### Upload

```bash
npx postplan upload <plan.html>                # new draft
npx postplan upload <plan.html> --draft <id>   # new version of an existing draft
```

Where `<plan.html>` is the path to the HTML file you want to upload. The command returns a URL — display it to the user.

Reach for `--draft` whenever the document already has a link the user has seen: revising a plan, publishing the next revision of a write-up, correcting anything already circulating. The bare form mints a separate draft every time, which leaves the link they are holding on stale content and both versions live — the CLI has no delete command, so the duplicate cannot be retired afterwards.

Postplan rejects files that contain a `<form>` tag. Group inputs in a `div` and handle submit with a button click handler.

**The draft id is the link's subdomain**, so whatever the user pasted is enough to target it — `https://qi37drbp71nr.postplan.dev` or `https://postplan.dev/d/qi37drbp71nr/raw` both give `--draft qi37drbp71nr`.

### Read a Postplan URL

When a user supplies a `postplan.dev` URL, fetch the uploaded HTML immediately with the shell. Do not use web search or a browser to retrieve it.

1. Remove a trailing slash, then append `/raw` unless the URL already ends in `/raw`.
2. Run `curl --fail --silent --show-error --location --max-time 30 --output /tmp/postplan.html '<raw-url>'`.
3. Read `/tmp/postplan.html` as the user's artifact and continue the requested task.
4. When that task is to change the document, publish the edits back to the same link: `--draft <the id in the URL they gave you>`.

A web-search refusal is not evidence that Postplan rejected the request. If `curl` fails, report its actual status or network error; do not substitute search results.
