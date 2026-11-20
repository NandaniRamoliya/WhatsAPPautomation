# Developer Guide

Everything a developer needs to run, understand, customise, extend and deploy **Replix by Indrix** (WhatsApp automation).
For the non-technical client manual see [USER_GUIDE.md](USER_GUIDE.md). For delivering to a new client fast see [CLIENT_ONBOARDING.md](CLIENT_ONBOARDING.md).

---

## Contents

1. [What this is](#1-what-this-is)
2. [Quick start (5 minutes)](#2-quick-start-5-minutes)
3. [Architecture](#3-architecture)
4. [Folder structure](#4-folder-structure)
5. [Configuration (.env)](#5-configuration-env)
6. [Data model](#6-data-model)
7. [The conversation engine](#7-the-conversation-engine)
8. [The three modules: ordering, booking, enquiry](#8-the-three-modules)
9. [Sending messages: the 24-hour window, templates, limits](#9-sending-messages)
10. [Scheduler & background jobs](#10-scheduler--background-jobs)
11. [Payments](#11-payments)
12. [AI assistant, knowledge base and the new no-code features](#12-ai-assistant-knowledge-base-and-the-new-no-code-features)
13. [Multi-tenant (agency) model](#13-multi-tenant-agency-model)
14. [Dashboard (frontend)](#14-dashboard-frontend)
15. [REST API reference](#15-rest-api-reference)
16. [Customising for a client](#16-customising-for-a-client)
17. [Extending: add a new flow / preset / text / job](#17-extending)
18. [Security](#18-security)
19. [Testing](#19-testing)
20. [Deployment & operations](#20-deployment--operations)
21. [Troubleshooting](#21-troubleshooting)
22. [Scaling & roadmap](#22-scaling--roadmap)

---

## 1. What this is

A production-ready, **multi-business** WhatsApp Cloud API platform. One deployment serves many clients; each client
("business") has its own WhatsApp number, catalogue/services, bot texts, settings, dashboard logins and data.

Out of the box it handles:

| Module | What the customer can do on WhatsApp | What the business gets |
|---|---|---|
| **Ordering** | Browse categories → items → quantity → cart → delivery/pickup → address (typed or 📍 location) → notes → pay (Cash, UPI page with QR, Razorpay link) → confirmation; search by typing; "My orders"; one-tap reorder; native WhatsApp-catalogue orders; prescription photo upload | Live order board with sound alerts, one-tap status updates that message the customer, mark-paid, CSV import/export, abandoned-cart nudges |
| **Booking** | Service → staff (or "any") → triage questions → day → time → name → confirm; my appointments; reschedule; cancel; reminder replies; post-visit check-in | Day/week calendar, phone/walk-in booking, double-booking protection, 24h/2h reminders, aftercare/prescription message, day-N check-in → Google review or team alert, recalls (e.g. 6-month cleaning), holidays/leave |
| **Enquiry** | FAQ menu and auto-answers to typed questions, lead form with custom questions | Enquiries list with status/notes, owner alerts |
| **Always on** | Human handoff ("talk to us"), STOP/START opt-out, closed-hours note, media handling, Hinglish/English | Shared inbox with staff replies, bot pause/resume, broadcasts to opted-in customers, template manager, simulator, setup wizard, agency admin |

Design goals: **zero native dependencies** (Node's built-in SQLite), **no build step** for the frontend, **everything
configurable from the dashboard**, safe defaults, and code small enough to read in an afternoon.

## 2. Quick start (5 minutes)

Requirements: **Node.js 22.13+** (Node 24 LTS recommended). Nothing else.

```bash
git clone https://github.com/NandaniRamoliya/WhatsAPPautomation.git
cd WhatsAPPautomation
npm install
npm run setup        # interactive: writes .env (or copy .env.example to .env yourself)
npm run demo         # optional: 3 demo businesses with logins
npm start            # http://localhost:3000
```

Log in with the admin email/password printed by `setup` (or shown in the console on first start), open
**Test the bot** and chat. No Meta account is needed for the simulator.

To receive real WhatsApp messages locally:

```bash
ngrok http 3000      # copy the https URL into PUBLIC_URL in .env, restart
```

Then follow [META_WHATSAPP_SETUP.md](META_WHATSAPP_SETUP.md).

Useful commands:

| Command | Purpose |
|---|---|
| `npm start` | Run the server (dashboard + webhook + scheduler) |
| `npm run dev` | Same, restarts on file changes |
| `npm test` | Full test suite (42 tests: engine, booking, API, webhook, AI, knowledge, integrations, languages, payments) – no network needed |
| `node docs/guides/build-pdf.cjs` | Rebuild the PDF guides (needs Playwright) |
| `npm run demo` | Seed demo businesses (idempotent) |
| `npm run create-admin -- you@x.com "Passw0rd!"` | Create a super-admin or reset any login's password |
| `npm run users` | List all dashboard logins (which database, which business) |
| `npm run backup` | Consistent online DB backup to `data/backups/` (keeps 14) |

## 3. Architecture

```
 Customer's WhatsApp ──► Meta Cloud API ──(HTTPS webhook)──► /webhook ──► engine ──► flows ──► services ──► SQLite
          ▲                                                       │                                  │
          └──────────────── Graph API /messages ◄── sender.js ◄───┘◄──────────── scheduler (jobs) ◄──┘
                                                                         ▲
 Dashboard (Preact SPA) ──► /api/* (cookie session, business-scoped) ────┘
 Simulator ──────────────► /api/sim/* ──► same engine, phone "sim<userId>", messages stored but not sent
```

Request lifecycle for an inbound message:

1. Meta `POST /webhook`. We verify `X-Hub-Signature-256` against the **raw body**, answer `200` immediately.
2. Each message id is inserted into `processed_events` – duplicates (Meta retries) are dropped.
3. The business is found by `metadata.phone_number_id`.
4. Messages are queued **per customer** (`enqueue(biz:phone)`) so two quick taps are processed in order.
5. `engine.handleIncoming()` upserts the customer (opens the 24h window), logs the message, loads the session from DB,
   normalises the input and routes it (see §7). The session is saved at the end – restarts never lose a conversation.
6. Replies go through `whatsapp/sender.js`, which applies the 24h rule, template fallback, logging and error hints.

Tech choices:

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 22+, ES modules | Built-in `fetch`, `node:sqlite`, `node:test`, `--env-file` |
| HTTP | Express 5 | Async error handling, familiar |
| DB | SQLite (WAL) via `node:sqlite` | Zero setup, one file, fast; fine for hundreds of businesses on one VPS. See §22 for Postgres |
| Frontend | Preact + htm via import map | No bundler, no build, ~15 KB, served from `node_modules` |
| Crypto | Node `crypto` (scrypt, AES-256-GCM, HMAC) | No native deps |
| AI | `@anthropic-ai/sdk` (optional) | Structured outputs, validated by code |

## 4. Folder structure

```
src/
  server.js              Express app, static dashboard, error handler, boot (migrate, admin, scheduler)
  config.js              .env loading + auto-generated secrets (data/secrets.json)
  db/
    index.js             node:sqlite wrapper: all/get/run/insert/update/tx/migrate
    migrations/*.sql     Schema; add 002_xxx.sql for changes (applied once, in order)
  lib/
    crypto.js            encrypt/decrypt, scrypt passwords, signed tokens, HMAC helpers
    time.js              timezone math with Intl (zonedToUtc, tzParts, isOpenAt, nextOpening…)
    util.js              money, phone normalisation, CSV, deepMerge, HttpError
    logger.js            JSON line logger
  whatsapp/
    builders.js          text/buttons/list/cta/image/template builders + limits + summarize()
    cloudApi.js          Graph API client (send, markRead, phoneInfo, templates, media) + error hints
    sender.js            THE outbound gateway (24h window, template fallback, simulator, logging)
  engine/
    index.js             normalise → router → main menu → handoff
    conversation.js      Conversation context passed to flows (t(), say(), buttons(), pagedList()…)
    session.js           load/save session, pause/resume bot
    texts.js             All bot texts (en + hinglish) + per-business overrides
    flows/ordering.js    Ordering flow
    flows/booking.js     Booking flow
    flows/enquiry.js     FAQ + lead flow
    flows/custom.js      owner-made menu buttons & keyword quick replies
    texts-indic.js       Hindi + Gujarati language packs
  services/
    business.js          Tenant loading/caching, DEFAULT_SETTINGS, credentials
    setup.js             create business/user, presets, first super-admin
    customers.js         upsert/tag customers
    catalog.js           categories, products, search
    orders.js            totals, createOrder, confirmPayment (idempotent), setOrderStatus
    payments.js          UPI page + QR, Razorpay links + signature check
    appointments.js      slots, book (race-safe), reschedule, complete, reminder/check-in/recall jobs
    templates.js         template "slots" + Meta create-template definitions
    notify.js            owner/staff alerts (template fallback)
    jobs.js              durable job queue
    scheduler.js         loop: jobs, cart nudges, auto-complete, housekeeping
    broadcasts.js        template campaigns in throttled batches
    ai.js                optional Claude brain: understand() -> question / order / booking / human (RAG)
    knowledge.js         knowledge base: chunking, PDF/URL/file import (SSRF-safe), FTS5 search
    integrations.js      events -> webhook (n8n/Make/Zapier), Google Sheets, HubSpot, Airtable + retries/log
  presets/index.js       12 business presets with sample data
  routes/
    webhook.js           GET/POST /webhook
    public.js            /health, /pay/:token, /webhooks/razorpay/:bizId, /q/:slug (+ qr.png)
    middleware.js        auth cookie, CSRF header, business scoping, roles, rate limit, audit
    api.js               dashboard REST API
public/
  index.html             import map + mount point
  app/main.js            shell, login, navigation, live alerts, router
  app/lib.js, ui.js      helpers + reusable components (forms, tables, modals, editors)
  app/pages/*.js         one file per screen (help.js = searchable Help Centre: HOWTO, TROUBLE, FAQ, GLOSSARY)
scripts/                 setup, demo seed, create-admin, backup, publish-site (Cloudflare Pages), tunnel (Cloudflare Tunnel)
product-site/            Replix product website (npm run site:publish)
test/                    node:test suites + helpers (in-memory DB, simulated customers)
deploy/                  nginx config, cron example
docs/                    this guide and friends
```

## 5. Configuration (.env)

Only **server-level** settings live in `.env`. Everything business-specific is in the dashboard (stored in DB).

| Variable | Default | Notes |
|---|---|---|
| `PORT` | 3000 | |
| `PUBLIC_URL` | `http://localhost:PORT` | **Must be https** for Meta webhooks. Used for webhook URL, pay links, QR links |
| `NODE_ENV` | development | `production` → unsigned webhooks rejected, generic 500 errors, secure cookies (if https) |
| `DATA_DIR` | `./data` | DB file `app.db`, `secrets.json`, `backups/` |
| `SESSION_SECRET` | auto | Signs login cookies. Auto-generated into `data/secrets.json` if empty |
| `ENCRYPTION_KEY` | auto | Encrypts WhatsApp tokens / Razorpay secrets. **Back it up** – losing it means re-entering tokens |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | admin@example.com / random | First super-admin, created only when the users table is empty |
| `GRAPH_VERSION` | v24.0 | Meta Graph API version – one-line upgrade |
| `WA_VERIFY_TOKEN` | auto | Typed in Meta's webhook config. Shown in Settings → WhatsApp |
| `META_APP_SECRET` | – | App secret for signature checks (per-business override possible) |
| `ANTHROPIC_API_KEY` / `AI_MODEL` | – / `claude-opus-5-5` | Server key + default model for the Claude engine |
| `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL` | – / `gpt-5-mini` / `https://api.openai.com/v1` | OpenAI engine (base URL lets you use any OpenAI-compatible API) |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | – / `gemini-2.5-flash` | Google Gemini engine |
| `DEFAULT_TIMEZONE` / `DEFAULT_COUNTRY_CODE` / `DEFAULT_CURRENCY` | Asia/Kolkata / 91 / INR | Defaults for new businesses and phone normalisation |
| `SCHEDULER_INTERVAL_MS` | 30000 | Job loop interval |
| `SCHEDULER_ENABLED` | true | Disable on extra replicas (only one process should run jobs) |
| `LOG_LEVEL` | info | debug / info / warn / error |
| `DB_FILE` | app.db | `:memory:` is used by tests |
| `BRAND_NAME` / `BRAND_COMPANY` / `BRAND_COMPANY_URL` | Replix / Indrix / Indrix site | Name shown on login, sidebar wordmark, Help Centre, product website (`GET /api/about`) |
| `PRODUCT_SITE_URL` | `https://replix.pages.dev/` | Product website address |
| `SUPPORT_WHATSAPP` / `SUPPORT_EMAIL` / `SUPPORT_HOURS` | – | Turn on the support buttons in every Help Centre and the "Get a demo" buttons on the website |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `SITE_PROJECT` | – / – / replix | `npm run site:publish` only (token: Account › Cloudflare Pages › Edit) |

## 6. Data model

All tables (see `src/db/migrations/001_init.sql`) carry `business_id` except `users` (nullable for super-admins),
`processed_events` and `schema_migrations`. **Money is integer minor units** (paise). **Times are UTC ISO strings**;
conversion to business local time happens only for display and slot generation.

| Table | Purpose / key columns |
|---|---|
| `businesses` | Tenant. `modules` JSON array, `settings` JSON (merged over `DEFAULT_SETTINGS`), `texts` JSON (overrides), WhatsApp ids + encrypted token, `language`, `timezone`, `setup_done`, `active` |
| `users` | Dashboard logins. `role`: `superadmin` (agency, no business) / `owner` / `staff` |
| `customers` | One per (business, phone). `tags` JSON, `opted_in` (service msgs), `marketing_opt_in` (broadcasts), `last_inbound_at` (24h window) |
| `sessions` | Conversation state per (business, phone): `state`, `cart` JSON, `ctx` JSON, `bot_paused_until`, `needs_attention` |
| `products` | Catalogue. `price`, `category`, `unit`, `in_stock`, `active`, `sku`, `image_url` |
| `orders` | `order_no` (per business, starts 1001), `items` JSON snapshot, totals, `fulfilment`, `payment_mode` (cod/upi/online), `payment_status`, `status`, `pay_token` |
| `services` | `duration_min`, `price`, `aftercare`, `recall_days` |
| `staff` | `service_ids` JSON (empty = all), `hours` JSON (null = business hours), `phone` for alerts |
| `time_off` | Holidays (staff_id NULL = whole business) |
| `appointments` | `start_at`/`end_at` UTC, `status`, `intake` JSON (triage answers). **Partial unique index** on `(staff_id, start_at)` for active bookings |
| `faqs`, `leads` | Enquiry module |
| `messages` | Every in/out message: human summary (`body`), raw `payload`, `wamid`, delivery `status`, `error` |
| `jobs` | Durable queue: `type`, `run_at`, `payload`, `ref` (e.g. `appt:12`) for cancellation, retries |
| `broadcasts` | Template campaigns with progress counters |
| `processed_events` | De-duplication of webhook message ids and payment events (7-day retention) |
| `audit_log` | Who changed what in the dashboard |

Schema changes: add `src/db/migrations/002_description.sql`. It runs once inside a transaction on next start.

### Settings JSON

`DEFAULT_SETTINGS` in `src/services/business.js` is the single source of truth (documented inline). Reads always
go through `getBusiness()`, which deep-merges stored settings over defaults – so adding a new setting with a default
never needs a data migration.

## 7. The conversation engine

`src/engine/index.js` → `handleIncoming(biz, { from, profileName, message })`.

**Normalisation** turns any Cloud API message into one of:
`text` · `choice` (button/list reply, or template quick-reply payload) · `location` · `media` · `order` (native catalogue) · `form` (WhatsApp Flows) · `other`.

**Routing order** (first match wins):

1. `STOP`/`unsubscribe` → opt out (policy requirement); `START` → opt back in.
2. **Bot paused** (human handoff active) → stay silent, flag `needs_attention`, unless the customer types `menu`.
3. **Global commands**: greetings (`hi`, `hello`, `namaste`, `menu`, `help`…) → main menu; `human`/`agent`/`talk to someone` → handoff; `cancel`/`back` → cancel current flow.
4. **Closed hours** with `closed_behavior = handoff` → collect message, reply once per day.
5. **Choices** → dispatched by id prefix to the owning flow (`ord:`, `bk:`, `enq:`).
6. **Native catalogue order** → ordering.
7. **Location / media / text inside an active step** → the flow that owns the current `state`.
8. **Free text in the menu** → owner quick-reply keywords → FAQ keyword match → **AI brain** (if enabled: answer / typed order / booking / handoff) → product search.
9. Nothing matched → polite main menu (never stuck, never silent).

**IDs are the API between messages and code.** Every button/list row id is `prefix:action:arg…`, e.g.
`ord:p:42` (product 42), `bk:t:20261121T050000Z` (slot), `bk:ci:good:17` (check-in answer for appointment 17).
Template quick-reply buttons carry the same ids as payloads, so a reminder tapped 3 days later still routes correctly.

**State** lives in `sessions` (`state`, `cart`, `ctx`). Flows call `c.setState('BK_DATE', {...})` and `c.reset()`.
`ctx` keys are flow-private (`bk`, `lead`, `pending`, `fulfil`, `address`…).

**The `Conversation` object** (`engine/conversation.js`):

| Member | Use |
|---|---|
| `c.biz`, `c.customer`, `c.session`, `c.input`, `c.phone` | Context |
| `c.t(key, vars)` | Localised text with `{name}`, `{name_sp}`, `{business}` pre-filled |
| `c.say(text)`, `c.buttons(body, [{id,title}])`, `c.send(builderMsg)`, `c.cta(body,label,url)` | Reply |
| `c.pagedList(body, buttonLabel, rows, page, pageId)` | List with automatic "More options" pagination |
| `c.setState(state, ctxPatch)`, `c.reset()` | State |
| `c.pause()`, `c.needsAttention()`, `c.notifyOwner(text)` | Handoff & alerts |

## 8. The three modules

A module = an entry in `businesses.modules` + a flow object registered in `FLOWS` (`engine/index.js`):

```js
export const myFlow = {
  module: 'mymodule',            // name in businesses.modules
  prefix: 'my',                  // button ids start with "my:"
  states: ['MY_STEP1'],          // states this flow owns (for typed text/location)
  menuItems(c) { return [{ id: 'my:start', title: c.t('menu_my'), description: '…' }]; },
  async onChoice(c, [action, arg1, arg2]) { … return false if not handled },
  async onText(c) { … },         // optional
  async onLocation(c) { … },     // optional
  async onMedia(c) { … },        // optional (return false to fall through)
  async onFreeText(c) { … },     // optional: free text in the main menu
};
```

### Ordering (`flows/ordering.js`)
States: `ORD_BROWSE → ORD_QTY → ORD_CART → ORD_FULFIL → ORD_ADDRESS → ORD_NOTES → ORD_PAY`.
Key rules: cart is **re-priced from DB** before showing and before placing (`refreshCart`) – out-of-stock items are
removed with a message; quantities merge per product; minimum order enforced; only payment modes that are configured
(UPI needs `upi_id`, online needs Razorpay keys) are offered; with a single mode the question is skipped.
`createOrder` assigns `order_no` inside a transaction. COD → `CONFIRMED` immediately; UPI/online → `NEW` until paid.

### Booking (`flows/booking.js` + `services/appointments.js`)
States: `BK_STAFF → BK_INTAKE → BK_DATE → BK_TIME → BK_NAME → BK_CONFIRM`.
**Slot generation** (`slotsFor`): for each candidate staff member: skip if on leave; take their weekly hours (or the
business hours); step through each range by `slot_interval`, keep slots where `start ≥ now + min_notice` and the
`[start, start+duration)` interval doesn't overlap any active appointment. "Any available" = union across staff.
If a business has **no staff**, the business itself is one calendar.
**Booking** (`book`) runs in `BEGIN IMMEDIATE`, re-checks overlap for each candidate and inserts; the partial unique
index is the last line of defence. A lost race returns `SlotTakenError` → the customer sees fresh times.
After booking: reminders scheduled (`appt.reminder` per configured offset), owner + staff alerted.
**Completion** (dashboard "Visit done" or `auto_complete_hours`) sends aftercare (service text + note), schedules
`appt.checkin` after `checkin_days` and `appt.recall` after `recall_days`.
**Check-in**: 😊 → review link (only if positive – policy & reputation); 😐/😟 → bot paused + owner alert.

### Enquiry (`flows/enquiry.js`)
FAQ list (paginated) and keyword matching (`keywords` column scores 3 per hit, question words 1 each, threshold 2).
Lead form asks `settings.enquiry.lead_questions` one by one (buttons if ≤3 options, list if more, else free text),
saves a `leads` row and alerts the owner. A question with key `name` fills the lead's name.

## 9. Sending messages

**All outbound traffic goes through `whatsapp/sender.js → send(biz, phone, message, { fallbackTemplate, sentBy })`.**

* **24-hour customer-service window**: free-form messages are allowed only within 24h of the customer's last
  inbound message (`customers.last_inbound_at`). Outside it, `send` automatically switches to `fallbackTemplate`
  (an approved template) or records the message as `skipped` with a clear error shown in the inbox.
* **Simulator**: phones starting with `sim` are stored with status `simulated` and never sent.
* **Not connected**: businesses without credentials log `dry_run` (useful during setup).
* **Errors**: Graph error codes are mapped to plain-English hints (`ERROR_HINTS` in `cloudApi.js`).

**Template slots** (`services/templates.js`): `owner_alert`, `order_update`, `appointment_reminder`,
`appointment_checkin`, `appointment_recall`. Each has a recommended body, example values and quick-reply buttons.
The dashboard's **Templates → Submit all to Meta** creates them through the Graph API and stores the names in
`settings.templates`. Quick-reply buttons are sent with **dynamic payloads** (`bk:ok:17`), so taps route back into
the exact flow.

**Builders** (`whatsapp/builders.js`) enforce Meta limits so content from the dashboard can never break a message:
max 3 reply buttons (title ≤ 20), list ≤ 10 rows (title ≤ 24, description ≤ 72, button ≤ 20), body ≤ 1024.
Template parameters are sanitised (no newlines/tabs, no 4+ spaces).

## 10. Scheduler & background jobs

`services/scheduler.js` runs inside the web process every `SCHEDULER_INTERVAL_MS`:

* `runDueJobs()` – claims due `PENDING` jobs atomically (`UPDATE … WHERE status='PENDING'`), runs the registered
  handler, marks `DONE`; failures retry 3× with a 5-minute backoff then `FAILED` (visible in DB).
* `cartNudges()` – one reminder for carts idle `cart_nudge_minutes` (inside the 24h window only).
* every 10 ticks: `autoCompleteDue()` and housekeeping (old events/jobs cleanup, un-stick crashed jobs).

Job types: `appt.reminder`, `appt.checkin`, `appt.recall`, `service.recall` (imported customers), `broadcast.run`.
Register a new one with `registerJob('type', async (job) => { … })` and schedule with
`schedule(businessId, 'type', runAtDate, payload, ref)`. Cancel with `cancelJobs(ref[, type])`.
Every handler re-checks current state (appointment still active? customer still opted in?) before sending.

> Run **one** scheduler per database (`SCHEDULER_ENABLED=false` on extra instances).

## 11. Payments

| Mode | Flow | Confirmation |
|---|---|---|
| `cod` | Order confirmed immediately | Cash on delivery / at pickup |
| `upi` | Customer gets a **Pay now** button → `/pay/:token` page with `upi://pay` deep link + QR (https link because `upi://` isn't tappable in WhatsApp) | Owner checks bank app → **Payment received** in dashboard → `confirmPayment()` |
| `online` | Razorpay Payment Link created per order (`reference_id = bizId-orderId`) | Razorpay webhook `POST /webhooks/razorpay/:bizId` (`payment_link.paid`), HMAC verified, idempotent |

`confirmPayment()` only updates orders still in `NEW` – double webhooks / double clicks are no-ops. Pay tokens are
random (no order enumeration). **Never confirm based on a customer's screenshot.**
To add another gateway (Cashfree, PhonePe, Stripe): add `createXLink()` + a webhook route that calls `confirmPayment`.

## 12. AI assistant, knowledge base and the new no-code features

### 12.1 AI brain (`src/services/ai.js`)
**Three engines, one brain.** Each business chooses **Claude** (default), **OpenAI GPT** (or any OpenAI-compatible
API via `OPENAI_BASE_URL`: OpenRouter, Groq, Azure OpenAI, Ollama…) or **Google Gemini** on the AI assistant page,
optionally with its **own API key** (stored encrypted in `settings.ai.<engine>_key_enc`; falls back to the server
key in `.env`) and a model override. `engineFor(biz)` resolves engine, key and model; the prompt, the JSON schema,
the safety rules and all validation are identical for every engine (adapters in `CALL.claude / .openai / .gemini`):
Claude → `beta.messages.parse` + zod format + prompt caching; OpenAI → Chat Completions with
`response_format: json_schema (strict)`; Gemini → `generateContent` with `responseSchema`. Every engine's output is
re-validated with the same zod schema; refusals/safety blocks/HTTP errors → normal bot behaviour.

Enabled when the business turns on **AI assistant** and a key exists for its engine.
One structured call (`understand()`) classifies a free-text message and returns:

```js
{ intent: 'question'|'order'|'booking'|'human'|'greeting'|'other',
  answerable, answer, items: [{ id, qty }], unclear: [...], suggest: 'none'|'order'|'book'|'faq'|'human' }
```

The engine (`aiReply()` in `src/engine/index.js`) then routes into the **existing, tested flows**:
`order` → items added to cart (`addAiItems`) for the customer to confirm · `booking` → booking flow ·
`human` → handoff · answerable question → answer + next-step buttons (Book now / Order now / FAQs / Menu / Talk to us) ·
not answerable → product search, else "not sure – talk to us?".

Prompt design:
* **System prompt (stable, cached with `cache_control`)**: rules, tone, assistant name, owner instructions,
  business profile + hours, ordering rules, catalogue (≤600 items), services, staff, FAQs and – for small
  knowledge bases – the whole knowledge base. Same for every customer → cheap cache reads.
* **User message (per request)**: last 6 chat messages (memory), retrieved knowledge passages (large KBs),
  the customer's chosen language, the message.
* Structured output via `client.beta.messages.parse` + `betaZodOutputFormat`, `effort: 'low'`, server-side refusal
  fallback (`fallbacks: 'default'`), 25 s timeout, 1 retry. Model: `AI_MODEL` (default `claude-opus-5-5`;
  set a cheaper model for very high volume).
* **Code validates**: product ids must exist and be in stock, 0 < qty < 100, prices always from the DB, orders
  and bookings still need the customer's confirmation. Any AI failure silently falls back to the normal bot.

### 12.2 Knowledge base / RAG (`src/services/knowledge.js`, migration `002`)
Tables `kb_sources` (title, kind text/file/url, full text) and `kb_chunks` (≈900-char chunks, 150 overlap), with an
**FTS5** index `kb_fts` (BM25, `unicode61` tokenizer – Hindi/Gujarati work) kept in sync by triggers.
* Sources: pasted text, uploaded files (PDF via `unpdf`, TXT/CSV/MD/HTML; ≤10 MB), website pages (HTML → text).
* URL import is **SSRF-safe**: http(s) only, DNS-resolved addresses must be public (no 127/8, 10/8, 172.16/12,
  192.168/16, 169.254/16, 100.64/10, IPv6 local), redirects re-checked (max 3).
* `knowledgeFor()`: if active knowledge ≤ 60,000 chars → **full mode** (all text in the cached system prompt: best
  quality, language independent); else **search mode** (top 8 FTS passages in the user message).
* Limits: 400k chars per source, 2M per business. Dashboard: **AI assistant** page (add/edit/disable/delete,
  "Try a question").

### 12.3 Menu & quick replies (`src/engine/flows/custom.js`, table `quick_replies`)
Owner-made buttons and keyword triggers. `reply_type`: `text` · `link` (CTA URL button) · `image` · `document`
(e.g. price-list PDF) · `location` (lat/lng pin) · `flow` (jumps to any id: `ord:start`, `bk:start`, `enq:lead`,
`human`, `lang:pick`, `menu` via `c.dispatch(id)`). Keywords match whole words/phrases (Unicode aware, longest
wins) and run **before** FAQs and AI. Buttons appear in the main menu (before/after standard items:
`settings.custom_menu_position`); menus with >10 items are paginated (`menu:p:N`). Optional
`settings.welcome_image_url` is sent with the first welcome of the day.

### 12.4 Languages (`src/engine/texts.js`, `texts-indic.js`)
Packs: `en`, `hinglish`, `hi` (Devanagari), `gu` (Gujarati). `customers.language` stores each customer's choice
(`lang:<code>` buttons, typing "language/bhasha/ભાષા", or asked on first "Hi" when
`settings.language_choice.enabled` + `ask_first`). `text(biz, key, vars, lang)` resolves
per-language override → pack → English; `textFor(biz, phone, key)` is used by scheduled/dashboard messages
(reminders, order updates, aftercare…) so they follow the customer's language. Overrides for non-primary languages
live in `biz.texts['@<lang>']`; the Bot messages page has a language selector. Add a language: recipe in §17.

### 12.5 Integrations hub (`src/services/integrations.js`)
`emit(biz, event, data)` is called on: `customer.created`, `lead.created`, `order.created`, `order.updated`,
`appointment.booked`, `appointment.updated`, `handoff.requested`, `feedback.received`.
Targets (configured in `settings.integrations`, secrets encrypted): **webhook** (JSON + `X-WAK-Signature:
sha256=HMAC(secret, body)` → n8n / Make / Zapier / any CRM) · **Google Sheets** (copy-paste Apps Script web app;
tabs per event type; shared token) · **HubSpot** (contact search/create by phone + note associated with type 202) ·
**Airtable** (row with Time, Event, Name, Phone, Summary, Details). Delivery is immediate and non-blocking;
failures go to the job queue (`integration.retry`, 3 attempts); every attempt is in `integration_log`
(Integrations page). Simulator chats (`sim…`) are never sent. Payload: `{ id, event, at, business, contact,
summary, data, sheet, row }`.

### 12.6 Payments v2
New modes: **`stripe`** – Stripe Checkout Session (REST, form-encoded; `client_reference_id = bizId-orderId`;
zero-decimal currencies handled) + webhook `POST /webhooks/stripe/:bizId` verifying `Stripe-Signature`
(`t=…,v1=…`, HMAC of `t.rawBody`, 5-minute tolerance), events `checkout.session.completed` /
`async_payment_succeeded`, de-duplicated, then `confirmPayment()`; **`link`** – any payment URL template with
`{amount}`, `{order_no}`, `{currency}`, `{phone}` (manual confirmation like UPI). Return page: `/paid/:token`.

### 12.7 Same number on the phone app (coexistence)
Webhook `value.message_echoes` (owner replied from the WhatsApp Business app) → `recordEcho()` logs the message
(`sent_by = 'WhatsApp app'`) and pauses the bot for that customer, so the human leads the conversation.

## 13. Multi-tenant (agency) model

* One server, many businesses. Webhooks are routed by `phone_number_id`; each business stores its own token
  (encrypted). One Meta app can serve all clients (recommended), or a client can use their own app (per-business
  app secret).
* **Roles**: `superadmin` sees **All businesses**, creates clients, switches between them (header `X-Business-Id`);
  `owner` manages one business incl. settings and team; `staff` does daily work (orders, appointments, chats).
* Every query in `routes/api.js` is scoped with `req.biz.id`. Generic CRUD updates/deletes include `AND business_id = ?`.
* Pausing a business (`active = 0`) stops its webhook processing.

## 14. Dashboard (frontend)

No build step: `public/index.html` defines an import map pointing `preact`, `preact/hooks`, `htm` to files served
from `node_modules` (`/vendor/*.mjs`). Pages are plain ES modules under `public/app/pages/`.

* Router: hash based (`#/orders`), `ROUTES` map in `main.js`. Navigation hides modules a business doesn't use.
* Data: `useApi(path)` hook; mutations via `api()` + `act()` (toasts errors/success).
* Forms: schema-driven `FormFields` (`text`, `textarea`, `number`, `money` (rupees ↔ paise), `select`, `toggle`,
  `checks`, `custom`), `HoursEditor`, `QuestionsEditor`, generic `ResourceManager` (list + modal CRUD).
* Live alerts: `/api/pulse` polled every 8 s → beep + toast on new order/booking/enquiry/handoff.
* Light/dark theme via CSS variables, responsive down to 360 px, keyboard-accessible controls.

Add a page: create `public/app/pages/foo.js` exporting a component, add it to `ROUTES` and `nav()` in `main.js`.

## 15. REST API reference

All under `/api`, JSON, cookie session. Mutations require header `X-Requested-With: wak` (CSRF protection).
Super-admins add `X-Business-Id: <id>`.

| Method & path | Description |
|---|---|
| `POST /auth/login` `{email,password}` · `POST /auth/logout` · `POST /auth/password` | Session |
| `GET /me` | User + accessible businesses |
| `GET/POST/PUT/DELETE /admin/businesses[/:id]` | Agency: list (with usage), create (+ owner login), pause, delete (requires slug confirmation) |
| `GET /business` · `PUT /business` | Details, modules, settings (deep-merged), `secrets` (encrypted) |
| `POST /business/preset` · `POST /business/sample-data` | Apply preset / load or clear sample data |
| `PUT /business/whatsapp` · `POST /business/whatsapp/test` · `/subscribe` · `/test-message` | WhatsApp connection |
| `GET /links` · `GET /qr` | Webhook URL, verify token, wa.me link, QR |
| `GET /stats` · `GET /pulse` | Overview numbers, 7-day series, go-live checklist · live counters |
| `GET/POST/PUT/DELETE /products, /services, /staff, /faqs, /time-off` | CRUD |
| `POST /products/import` `{csv, replace}` · `GET /products/export.csv` | Catalogue CSV |
| `GET /orders?status=&q=&test=` · `GET /orders/:id` · `POST /orders/:id/status` `{status, reason}` · `POST /orders/:id/paid` · `GET /orders-export.csv` | Orders |
| `GET /appointments?date=&days=&staff_id=` · `GET /slots?service_id=&date=&staff_id=` · `POST /appointments` · `POST /appointments/:id/status` `{status, note, reason}` · `POST /appointments/:id/reschedule` `{start}` · `GET /appointments-export.csv` | Appointments |
| `GET /customers?q=&tag=` · `PUT/DELETE /customers/:id` · `POST /customers/import` · `GET /customers-export.csv` | Customers (delete = data erasure) |
| `GET /leads` · `PUT /leads/:id` · `GET /leads-export.csv` | Enquiries |
| `GET /chats` · `GET /chats/:phone/messages` · `POST /chats/:phone/send|pause|resume|done` · `GET /media/:id` | Inbox |
| `GET/PUT /texts?lang=` | Bot text overrides per language (`null` resets a key) |
| `GET /knowledge` · `GET/PUT/DELETE /knowledge/:id` · `POST /knowledge` (text) · `POST /knowledge/file` (`{filename, mime, base64}`) · `POST /knowledge/url` · `POST /knowledge/search` · `POST /ai/try` | Knowledge base + AI tester |
| `GET/POST/PUT/DELETE /quick-replies[/:id]` | Custom menu buttons & quick replies |
| `GET /integrations` · `POST /integrations/test` `{target}` | Integration config (masked), events, delivery log, Apps Script · test delivery |
| `GET /templates` · `POST /templates/create` | Template slots + Meta status, one-click creation |
| `GET /broadcasts` · `POST /broadcasts/preview` · `POST /broadcasts` | Campaigns |
| `GET/POST/PUT/DELETE /team[/:id]` | Business logins |
| `GET /sim/messages` · `POST /sim/message` · `POST /sim/reset` · `POST /sim/run-jobs` | Simulator |

Public: `GET/POST /webhook`, `GET /pay/:token`, `GET /paid/:token`, `POST /webhooks/razorpay/:bizId`, `POST /webhooks/stripe/:bizId`, `GET /q/:slug` (redirect to
wa.me), `GET /q/:slug/qr.png`, `GET /health`.

## 16. Customising for a client

90% of client requests need **no code**:

| Request | Where |
|---|---|
| Business type, sample data | Setup wizard / Settings → Features |
| Wording, language, emojis, button labels | Bot messages |
| Products, prices, stock, photos | Products (or CSV import) |
| Services, durations, doctors, hours, leave | Services & staff |
| Triage / lead questions | Settings → Appointments / Enquiry form |
| Delivery fee, minimum order, payment modes, UPI, Razorpay | Settings → Ordering & payments |
| Reminder times, check-in day, review link, recalls | Settings → Appointments, Services |
| Closed-hours behaviour, handoff duration, menu style | Settings → Opening hours / Features |

When code is needed, prefer these extension points (in order): a new **text key** → a new **setting** with a default
in `DEFAULT_SETTINGS` (shown in `settings.js`) → a new **preset** → a new **flow**.

## 17. Extending

### Add a new flow (example: "Track my courier")
1. `src/engine/flows/tracking.js` exporting `{ module: 'tracking', prefix: 'trk', states: ['TRK_ASK'], menuItems, onChoice, onText }`.
2. Register it in `FLOWS` in `src/engine/index.js`; add `'tracking'` to `MODULES` in `services/business.js`.
3. Add its texts to `en` (and `hinglish`) in `engine/texts.js` – they appear automatically in the Bot messages editor.
4. Add a toggle in `public/app/pages/settings.js` (Features tab) and, if needed, a page + nav entry.
5. Write a test in `test/` using the `customer()` helper.

### Add a preset
Copy an entry in `src/presets/index.js` (`label`, `icon`, `description`, `examples`, `modules`, `settings`, `sample`).
It shows up in the wizard and agency "new business" form immediately.

### Add a setting
Add it with a default to `DEFAULT_SETTINGS`; read it via `biz.settings.x.y`; expose it with a field definition in
`public/app/pages/settings.js` (`orderingFields`, `bookingFields`…). No migration needed.

### Add a scheduled job
`registerJob('my.job', handler)` (import the module from `scheduler.js` so it registers), then `schedule(...)`.

### Add a WhatsApp Flow (native form)
Inbound `nfm_reply` is already normalised to `{ kind: 'form', data }`. Send a Flow with a custom builder in
`builders.js` and handle `c.input.kind === 'form'` in your flow's `onText`-like handler.

## 18. Security

* Webhook **signature verification** on the raw body (`X-Hub-Signature-256`); unsigned requests rejected in production.
* **Idempotency**: `processed_events` for messages and payment events; `confirmPayment` only acts on `NEW` orders.
* **Secrets at rest**: tokens and Razorpay secrets AES-256-GCM encrypted; API never returns them (masked `••••1234`).
* **Passwords**: scrypt (N=16384) with per-user salt; login rate limit (10 / 10 min / IP).
* **Sessions**: HMAC-signed, httpOnly, SameSite=Lax cookie (Secure on https); 7-day expiry.
* **CSRF**: all API mutations require `X-Requested-With: wak` (cannot be sent cross-site without CORS).
* **Tenant isolation**: every query scoped by `business_id`; roles enforced server-side.
* **SQL**: parameterised statements only. Dynamic column names come from code allow-lists, never user input.
* **Privacy (DPDP / GDPR)**: STOP honoured, marketing consent separate from service messages, "Delete data" erases
  a customer's profile and chats, exports for record-keeping, audit log of dashboard actions.
* Pay pages use unguessable tokens; security headers (`nosniff`, `SAMEORIGIN`, `same-origin` referrer).

Production checklist: `NODE_ENV=production`, https `PUBLIC_URL`, `META_APP_SECRET` set, strong admin password,
back up `.env` + `data/`, firewall to 80/443/22 only.

## 19. Testing

```bash
npm test
```

`test/helpers.js` boots an in-memory database, creates businesses from presets with 24×7 hours, and gives you a
`customer(biz)` that can `text()`, `tap()`, `pick()`, `location()`, `media()` and returns the bot's replies.

| Suite | Covers |
|---|---|
| `ordering.test.js` | Full COD order, UPI pay link + idempotent confirm, search, min order, stock changes, WhatsApp limits & pagination, reorder, location, handoff, STOP, Hinglish + overrides |
| `booking.test.js` | Triage → booking, double-booking guard, any-staff assignment, holidays, reminders → confirm, reschedule, cancel, aftercare, check-in branches, recall, template fallback after 24h, FAQ + lead, media |
| `api.test.js` | Webhook verify, signature, de-dup, mark-read, auth, CSRF, roles, secret masking, CSV import/export, simulator + pay page + order status, inbox pause/resume |
| `ai.test.js` | AI brain: request shape (model, cached system prompt, structured output, fallbacks, effort, chat memory), typed orders, KB answers with next-step buttons, booking/human intents, large-KB search mode |
| `ai-engines.test.js` | OpenAI and Gemini engines against local mocks: own vs server key, strict JSON schema / responseSchema, model override, invalid output / safety block / API error → safe fallback, no key → AI not used |
| `features.test.js` | Knowledge base (chunking, Unicode FTS incl. Gujarati, update/delete, file/HTML extraction, SSRF guard), quick replies (document/text/link/flow, menu pagination), language picker + Gujarati reminders + per-language overrides, integrations (signed webhook, Sheets, HubSpot, Airtable failure → retry + log, simulator excluded), Stripe checkout + signature, payment links, coexistence echo |

Manual end-to-end: **Test the bot** page + "⏩ Fast-forward time" to fire reminders/check-ins immediately.

## 20. Deployment & operations

See [DEPLOYMENT.md](DEPLOYMENT.md) for **free Cloudflare** (product website on Cloudflare Pages via `npm run site:publish`, bot exposed with Cloudflare Tunnel via `npm run tunnel`), VPS (PM2 + nginx + certbot), Docker, Render, backups and upgrades.
Operational must-haves: uptime monitor on `/health`, daily `npm run backup` (+ off-server copy), watch logs for
`send failed` and `job failed`, keep `GRAPH_VERSION` current.

## 21. Troubleshooting

| Symptom | Cause → fix |
|---|---|
| Webhook won't verify | Wrong verify token / URL not https / server not reachable. Check `/health` from outside; token in Settings → WhatsApp |
| No messages arrive | Not subscribed to **messages** field, or app not subscribed to WABA → Settings → WhatsApp → **Subscribe webhooks** |
| `401` on POST /webhook | `META_APP_SECRET` (or business app secret) wrong, or a proxy altered the body |
| `message for unknown phone_number_id` in logs | Phone Number ID not saved on any business / business paused |
| 131030 | Test mode – recipient not in Meta's allowed list |
| 131047 / message `skipped` | Outside 24h window – configure templates (Templates page) |
| 132000 / 132001 | Template params/name/language mismatch – re-create with the one-click button |
| 190 | Token expired – use a System User permanent token |
| Buttons rejected | Can't happen through builders; if you hand-craft messages respect §9 limits |
| Reminders not sent | Scheduler disabled? Job `FAILED` in `jobs` table? Template not approved? |
| Times off by hours | Business timezone wrong (Settings → Business) |
| "Decrypt" returns empty token | `ENCRYPTION_KEY` changed – re-enter tokens |

## 22. Scaling & roadmap

* **Capacity**: SQLite in WAL mode on a 1 vCPU VPS comfortably handles hundreds of businesses and many messages per
  second; WhatsApp's own throughput limits arrive first. Keep one process per data folder.
* **Postgres**: all SQL is in `db/index.js` callers using `?` placeholders and standard SQL; switching means
  replacing `db/index.js` with a `pg` pool (async) and adding `await` at call sites (services are already async-ready).
* **Horizontal scale**: move the scheduler to its own process, put a queue (Redis/BullMQ) behind `enqueue`, run
  stateless web replicas on Postgres.
* Ideas: WhatsApp Flows for address/slot forms, multi-product catalogue messages, Embedded Signup for self-serve
  client onboarding, invoices (PDF) on delivery, loyalty points, Google Calendar sync, more payment gateways.
