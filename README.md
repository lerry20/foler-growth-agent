# FOLĒR Growth Agent

Internal tool for FOLĒR (early-stage hair & scalp tracking startup). It finds Reddit posts from people struggling to *measure or track* hair changes, qualifies them with an LLM (Claude, with a deterministic heuristic fallback), and manages a strict help-first workflow: qualify → proposed action → Telegram/dashboard approval → Reddit reply (or manual mode) → FOLĒR permission workflow → waitlist attribution.

## Help-first principles

- A helpful reply that never mentions FOLĒR is a success.
- The first reply in any thread is never about FOLĒR (`INTRODUCE_FOLER` / `WAITLIST_INVITE` / `DM` are gated down to `HELP` when we have no prior outbound reply in that thread).
- FOLĒR may only be introduced after an explicit permission ask is granted by the person (`PERMISSION_REQUESTED` → `PERMISSION_GRANTED`), and the waitlist link only after they express interest (`INTEREST_DETECTED` → `WAITLIST_INVITED`).
- Approval is human-gated: nothing posts without an explicit approve (Telegram button or dashboard). Preflight blocks (do-not-contact, duplicate contact, paused account, stale conversation) refuse approval.

## Setup

1. **Node** v24 (via nvm), `npm install`.
2. **Postgres**: create `foler_growth_agent` (and `foler_growth_agent_test` for tests) as the `foler` user, then `npx prisma db push` (`npm run test:db` handles the test DB).
3. **`.env`** (see `.env.example`):
   - `DATABASE_URL` — required.
   - `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` — optional; without a key the heuristic analyzer runs (clearly labelled in output).
   - `TELEGRAM_BOT_TOKEN` — create a bot via BotFather; `TELEGRAM_CHAT_ID` — send `/start` to the bot and it replies with the chat id; `TELEGRAM_MODE` (`polling` default, or `webhook` + `TELEGRAM_WEBHOOK_SECRET`).
   - `REDDIT_PROVIDER` — `mock` (built-in demo dataset), `public_web` (read-only scraping of public JSON/RSS, polite 2s spacing, no posting → manual mode), or `official_api` (OAuth script app; needs `REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD`). `REDDIT_USER_AGENT`, `REDDIT_OUR_USERNAME`.
   - `APP_BASE_URL`, `ATTRIBUTION_WEBHOOK_SECRET`.
   - `TEST_DATABASE_URL` — optional; defaults to `DATABASE_URL` with the name swapped for `foler_growth_agent_test`.
4. `npm run db:seed`-equivalent: `npx prisma db seed` — seeds search categories, communities, account health, knowledge-base defaults, and (non-production) ingests 6 labelled `[MOCK]` demo conversations and qualifies them.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server on :3000 (starts Telegram poller via instrumentation hook) |
| `npx prisma db seed` | Seed config + mock conversations |
| `npm run discover` | Run one discovery sweep (searches → ingest → qualify → copilot actions) |
| `npm test` | Vitest against the test DB (`pretest` syncs its schema) |
| `npm run test:db` | Push schema to the test DB |
| `npm run lint` / `npm run typecheck` / `npm run build` | Usual checks |

## End-to-end workflow

1. **Discovery** searches enabled `SearchCategory` terms across enabled `CommunityConfig` subreddits (provider-respecting; rate limits pause outbound automatically).
2. **Ingest** dedupes posts/comments into Lead/Conversation/Message; each new conversation is qualified (score breakdown, category HOT/WARM/COLD/IGNORE, recommended action).
3. **Copilot** (`generateActionsForCandidates` / "Generate action") creates a PROPOSED `Action` and sends a Telegram approval card (Approve / Edit / Reject / Snooze / open dashboard). Edited replies become `finalResponse`.
4. **Approval** is stale-guarded (conversation version) and preflight-guarded (do-not-contact, pending action, recent outbound, paused account).
5. **Execution** posts via the provider, or becomes `MANUAL_REQUIRED` with a copy-paste panel + "Mark as Posted" for `public_web`.
6. **Monitoring** refreshes active conversations (`refreshAll`); new inbound replies trigger `USER_REPLIED` → re-analysis → new proposed action. When Reddit is unreachable, "Import reply manually" feeds the same path.
7. **Attribution**: waitlist invites embed `source/subreddit/lead_id/conversation_id/campaign`; optionally routed through `/api/waitlist/go` (records click → 302 redirect) when setting `attribution.useRedirect` is `"true"`. Signups arrive via `POST /api/waitlist/signup` (header `x-webhook-secret` = `ATTRIBUTION_WEBHOOK_SECRET`) or self-reported replies → `Conversion.signedUpAt` + `WAITLIST_SIGNUP` stage.

## Deploy (Vercel + Neon)

1. **Neon**: create a Postgres project → `DATABASE_URL`. From a laptop: `npx prisma db push` then `npx prisma db seed` (set `SEED_MOCK=` empty to skip demo data).
2. **Vercel**: import the GitHub repo. Env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_MODE=webhook`, `TELEGRAM_WEBHOOK_SECRET`, `APP_BASE_URL` (your https domain), `CRON_SECRET`, `DASHBOARD_PASSWORD` (HTTP Basic on the dashboard), `ATTRIBUTION_WEBHOOK_SECRET`, `REDDIT_OUR_USERNAME`, `REDDIT_USER_AGENT`.
3. **Telegram**: `npm run telegram:webhook` (registers `${APP_BASE_URL}/api/telegram/webhook`; `--delete` to switch back to polling).
4. **Scheduling**: GitHub Actions `.github/workflows/scheduler.yml` hits `POST /api/cron/run` every 30 min — add repo secrets `CRON_SECRET` + `APP_BASE_URL`. `vercel.json` also registers a daily fallback cron. Locally, `SCHEDULER_INTERVAL_MINUTES>0` runs the same cycle in-process. Each cycle: reply monitoring → discovery → copilot actions.

## Mock data

All demo content is clearly labelled: authors prefixed `mock_`, post titles prefixed `[MOCK] `, leads flagged `isMock` (amber "MOCK DATA" badge in the UI).

## Deliberately not built

- No Reddit anti-abuse bypass: no proxies, cookies, header spoofing, account rotation, or retry-on-403. `public_web` enforces ≥2s between requests and stops on 429.
- No auto-posting: every outbound message requires human approval.
- No medical claims: prohibited-claim list is enforced via prompt + gates; nothing diagnoses or evaluates treatments.
