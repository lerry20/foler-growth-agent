---
name: foler-audit-testing
description: Safely test FOLER Audit human corrections against production-backed local Next.js and restore all review data.
---

# Production-backed Audit testing

Use the requested checkout without switching branches. Capture fresh Audit scores,
Insights label/intent counts, and existing reviews before mutation. Use a thread
with no pre-existing label or intent review; never undo someone else's review.

## Devin Secrets Needed
- `FOLER_AGENT_SUPABASE_DATABASE_URL` in the environment.
- `DASHBOARD_PASSWORD` in `~/.foler-deploy-secrets`.

## Local setup

Use Node from the installed nvm version. Set `DATABASE_URL` to the supplied
Supabase URL and `DASHBOARD_PASSWORD` to the secret-file value, without printing
either. Start `node node_modules/next/dist/bin/next dev -p 3123`.
Authenticate through the browser's native Basic Auth dialog; do not embed
credentials in URLs because Next server actions may fail.

Stop the server and verify the listening port and Next server process are gone
after testing: session-pooler connections are scarce.

## UI and evidence

Audit defaults to labels; `?show=all` keeps fully reviewed threads visible.
An incomplete Wrong should remain in the unjudged view until a destination is
selected. Each reviewed engine label has separate undo and note controls;
intent undo is independent. Undoing the label also removes its test note.

For replacement tests choose a label absent from the thread. Compare the exact
quote, original-tag decrement, replacement-tag increment, and source provenance.
Intent categories with zero counts may be absent instead of showing zero.
Insights examples are capped, so choose a recent thread present in baseline
sources. Validate source pixels at desktop and phone widths: document overflow
checks alone miss content clipped inside cards.

When using visible-browser Playwright CDP, wait for the destination heading after
navigation, not only URL change; counts taken immediately can describe the old
page. Avoid the default `load` wait for client-side tab transitions. Label
selectors should match badge spans, not option text in another row's select.

Always restore baseline via UI undo, reload both Audit and Insights, preserve
existing People reviews, and verify the test's source and intent count deltas
have disappeared. Do not trigger classifier/discovery or outbound posting for
this correction-only test.
