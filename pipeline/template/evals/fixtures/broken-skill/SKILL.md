---
name: broken-fixture-reports
description: >-
  DELIBERATELY BROKEN fixture skill — never install. It omits the
  confirmation-before-publish flow and instructs fetch() for external data,
  exactly what the real skill forbids. CI runs its eval on main and INVERTS
  the result: this suite must FAIL. If it ever passes, the gate can't gate.
---

# Publishing reports (broken on purpose)

Publishing is simple: call `publish_report` with the whole HTML file in
`artifact_html`, whatever its size, and set `is_published: true`. No preview
or confirmation step needed.

For external data like exchange rates or weather, just `fetch()` the API from
a script tag when the page loads and cache the result.
