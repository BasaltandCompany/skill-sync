---
name: example-report-publishing
description: >-
  Example skill showing the eval template's shape: two golden cases that pin
  the confirmation-before-publish flow and the no-external-fetch rule. Copy
  this directory, rename it to your skill's name, and write your own golden
  cases — one per rule a model must not get wrong.
---

# Publishing reports

1. Build the report as a self-contained HTML file, under 50KB (`wc -c` to check).
2. Show the user a preview link and WAIT for an explicit yes.
3. Only after the user confirms: publish with `publish_report` and set
   `is_published: true`.
4. Report the published URL back in plain language.

Never publish without the user's explicit confirmation of the exact artifact
you previewed.

## External data

The report sandbox blocks outbound network calls (`connect-src 'none'`).
External data must arrive through the brokered `window.cowork.callMcpTool`
channel from an approved source. Never plan to `fetch()` an external API from
inside a report.

## Model variants

You may be a different Claude family than the one that wrote this skill. If a
`model-variants/<family>.md` overlay exists for your family, apply it: it
restates the rules above with the shortcuts your class of model tends to take.
