# FOLĒR Pulse

**Listen to how people describe health problems in the wild. Help them honestly. Map unmet needs at population scale.**

Every day thousands of people describe health struggles in public — what isn't working, what they can't tell, what they're afraid of — long before they see a clinician. FOLĒR Pulse turns that signal into two things:

1. **Population intelligence** — a live, evidence-linked map of what people are actually struggling with: top problems, unmet needs, treatment confusion, how recent it is, where it's coming from.
2. **Honest, human-approved help** — for the highest-signal conversations, an AI drafts a genuinely useful reply; a human approves or edits every word before anything is said. FOLĒR itself is only mentioned when the person asks.

Today it listens to hair & scalp communities (FOLĒR's domain). The pipeline is **domain-neutral**: the taxonomy, prompts and dashboards can be pointed at diabetes, PCOS, vitamin D deficiency, mental health or any other condition without changing the architecture.

> Principle: **Help first. Sell rarely.** A reply that never mentions FOLĒR is a success.

---

## What it does

```
public conversations ──▶ discover ──▶ AI analyze ──▶ Insights (population map)
                                          │
                                          └──▶ rank ──▶ draft reply ──▶ HUMAN approves/edits
                                                                              │
                                                              you post it ◀───┘
                                                                  │
                                                   monitor replies ──▶ re-analyze ──▶ follow-up (approval again)
                                                                  │
                                            person asks about FOLĒR? ──▶ introduce ──▶ waitlist ──▶ attribution
```

### 1. Listen — Insights
`/insights` aggregates every analyzed conversation (not just leads) into a judge-ready view:
- **Top problems people are trying to solve**, clustered into a 13-item domain-neutral taxonomy, each bar expandable to the real posts behind it.
- **Struggles × treatments**, unmet needs, weekly signal, and an AI "population synthesis" brief.
- **Data & method panel**: which communities, how many posts and comments, how far back, the search terms, and exactly how each % is computed (`share = tagged / analyzed`). Sample size is labelled honestly (`early signal` → `emerging` → `established`).

### 2. Help — Outreach
`/outreach` is the operating cockpit, four columns wide:

| Needs your approval | Ready to post | Posted · waiting | They replied |
|---|---|---|---|
| Approve · Edit · Reject · Snooze | Copy · Open thread · "I posted it" | Check for replies | Draft follow-up (→ approval again) |

Nothing is ever posted by the software. You approve, you copy, you paste from your own account, you confirm. The same loop is available from your phone via Telegram cards.

### 3. Guardrails (non-negotiable)
- **Human in the loop** on every outbound message; stale or conflicting approvals are refused.
- **Help first**: the first reply in a thread can never mention FOLĒR (`INTRODUCE_FOLER` / `WAITLIST_INVITE` are gated down to `HELP`).
- **Consent before product**: FOLĒR is introduced only after `PERMISSION_REQUESTED → PERMISSION_GRANTED`; a waitlist link only after `INTEREST_DETECTED`.
- **Never engage minors**: self-reported under-18s are auto-marked do-not-contact.
- **No medical claims**: prohibited-claim list enforced in prompts and gates; nothing diagnoses or evaluates treatments.
- **No platform abuse**: no proxies, cookie/header spoofing, account rotation, retry-on-403, or auto-posting. Public-web reading is polite and stops on rate limits.
- **Full audit trail**: every event (discovered, qualified, approved, posted, replied, introduced, invited, signed up) is recorded.

---

## Why this matters beyond hair

Clinical data systems know what happens *inside* the health system. FOLĒR Pulse captures the layer before that: what people say when they're confused, scared, or self-treating. For health leaders and prevention programmes this is an early-warning and unmet-needs map; for a company it is the most honest form of product discovery. Swap the search terms and taxonomy and the same engine listens to a different condition — in any language the underlying LLM understands.

---

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind · Prisma 6 + PostgreSQL (Supabase) · Anthropic Claude (with deterministic heuristic fallback) · Telegram Bot API · Vitest · Vercel.

Reddit access is behind a provider abstraction: `mock` (labelled demo data), `public_web` (read-only RSS/JSON, no posting), `official_api` (OAuth script app, optional), `manual` (paste replies by hand).

---

## Run it locally

1. Node 24 (`nvm use`), `npm install`.
2. Postgres: create `foler_growth_agent` (and `foler_growth_agent_test`), then `npx prisma db push`.
3. `.env` (see `.env.example`):
   - `DATABASE_URL` — required.
   - `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` — optional; without a key the labelled heuristic analyzer runs.
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (send `/start` to your bot, it replies with the id), `TELEGRAM_MODE` (`polling` | `webhook` + `TELEGRAM_WEBHOOK_SECRET`).
   - `REDDIT_PROVIDER` (`mock` | `public_web` | `official_api`), `REDDIT_USER_AGENT`, `REDDIT_OUR_USERNAME`.
   - `APP_BASE_URL`, `DASHBOARD_PASSWORD`, `ATTRIBUTION_WEBHOOK_SECRET`, `CRON_SECRET`.
4. `npx prisma db seed` — search categories, communities, knowledge base, and (non-production) 6 labelled `[MOCK]` conversations.
5. `npm run dev` → http://localhost:3000

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (starts Telegram poller) |
| `npm run discover` | One discovery sweep: search → ingest → analyze → draft actions |
| `npm test` | Vitest against the test DB |
| `npm run lint` / `npm run typecheck` / `npm run build` | Checks |
| `npm run telegram:webhook` | Register/delete the Telegram webhook |

## Deploy

Vercel + Supabase Postgres. Set the env vars above in Vercel (use the Supabase **transaction pooler** URL with `?pgbouncer=true&connection_limit=1`), set `vercel.json` `regions` to the region of your database, run `npx prisma db push` once from a laptop, then `npm run telegram:webhook`. `POST /api/cron/run` (header `x-cron-secret`) runs one cycle: monitor replies → discover → draft actions; `vercel.json` registers a daily cron and `.github/workflows/scheduler.yml` can call it every 30 min.

Note: Reddit blocks anonymous reads from most cloud IPs, so `public_web` discovery generally has to run from a laptop (`npm run discover` pointed at the production `DATABASE_URL`) or via the official API.

## Attribution

Waitlist invites carry `source / subreddit / lead_id / conversation_id / campaign`, optionally via `/api/waitlist/go` (records click → redirect). Signups arrive at `POST /api/waitlist/signup` (header `x-webhook-secret`) and close the loop to `WAITLIST_SIGNUP`.

## Mock data

Demo content is unmistakable: authors prefixed `mock_`, titles prefixed `[MOCK]`, leads flagged `isMock` with an amber badge in the UI.
