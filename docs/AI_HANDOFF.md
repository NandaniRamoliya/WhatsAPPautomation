# AI handoff prompt – paste this into a new chat to continue

You are continuing work on **Replix by Indrix**, a WhatsApp automation product. Act as an expert developer in WhatsApp
Cloud API automation. The owner is the founder of **Indrix** (Surat, India). They are not deeply technical, so
explain things simply and briefly, and do the work yourself.

## Repositories (GitHub user NandaniRamoliya, all on branch `main`)
1. **WhatsAPPautomation** – the Replix product (main project).
2. **Indrix** – company website (static HTML, GitHub Pages): https://nandaniramoliya.github.io/Indrix/
3. **portfolio** – the founder's portfolio (static HTML, GitHub Pages).
4. **websitemaker** – PinPage, the first Indrix product (AI website maker), https://pinpage-8no.pages.dev/ – used as the
   reference for branding and the Cloudflare Pages publishing method.

Commit and push to `main` after each finished change, with tests passing. Never commit `.env`, `data/`, `secrets.json`,
`*.db` or any API key / token.

## What Replix is
A ready-to-deliver, multi-client WhatsApp bot + no-code dashboard on Meta's **official WhatsApp Cloud API**. For a new
client you only enter their details in the dashboard (setup wizard + presets) and it works.

- **Modules:**
  - **Ordering:** catalogue, cart, delivery or pickup, and payment by cash on delivery, a UPI QR page, Razorpay, Stripe, or any payment link.
  - **Appointments:** staff calendars, triage questions, 24h and 2h reminders, reschedule/cancel, aftercare, a check-in leading to a Google review request, and recalls.
  - **Enquiries:** FAQs and a lead form.
- **AI assistant + RAG:** the engine is chosen per client (**Claude, OpenAI GPT or Google Gemini**, using the client's own key). It answers from a knowledge base (text, PDF, website pages; SQLite FTS5) and understands typed orders.
- **Other features:**
  - Custom menu buttons / quick replies
  - Languages: English, Hinglish, Hindi, Gujarati (per customer)
  - Integrations: Google Sheets (Apps Script), HubSpot, Airtable, signed webhooks (n8n / Make / Zapier)
  - Team inbox with human hand-off; coexistence with the WhatsApp Business app
  - Broadcasts and templates
  - Simulator ("Test the bot") with fast-forward time
  - Agency mode: many clients on one server, with roles superadmin / owner / staff
- **Help Centre** in the dashboard: search, "Start here", "How do I…" guides, troubleshooting, FAQ, glossary, PDF
  download, WhatsApp/email support buttons (from `SUPPORT_WHATSAPP` / `SUPPORT_EMAIL` in `.env`).
- **Branding:** "Replix by Indrix" is a plain gradient wordmark with **no icon before the name** (same rule as PinPage). The name is set by `BRAND_NAME` / `BRAND_COMPANY` (public `GET /api/about`).

## Tech
- **Runtime:** Node.js 22.13+ (ES modules), Express 5.
- **Database:** built-in `node:sqlite` (WAL) with migrations in `src/db/migrations/`.
- **Dashboard:** Preact + htm, no build step (`public/app/`).
- **Tests:** `npm test` runs 42 node:test tests, no network needed.
- **Stack choice:** the project is intentionally JavaScript, not Python.

Key folders:
- `src/engine/` – router and flows: ordering, booking, enquiry, custom
- `src/services/` – ai.js, knowledge.js, integrations.js, payments.js…
- `src/routes/` – webhook, public, api
- `src/presets/` – 12 business types
- `scripts/` – setup, demo, users, create-admin, backup, publish-site, tunnel
- `product-site/` – the marketing website
- `docs/` – README, DEVELOPER_GUIDE.md, USER_GUIDE.md, CLIENT_ONBOARDING.md, META_WHATSAPP_SETUP.md, USE_CASES.md, and two PDFs built from `docs/guides/*.html`

Commands:

| Command | What it does |
|---|---|
| `npm run setup` | Interactive setup |
| `npm run demo` | Demo logins `kirana@`, `dental@`, `salon@demo.test`, password `demo12345` |
| `npm start` | Runs the bot and dashboard |
| `npm run users` | Lists every login |
| `npm run create-admin -- email "pass"` | Creates an admin or resets a password |
| `npm run site:build` | Builds the product website |
| `npm run site:publish` | Uploads the product website to Cloudflare Pages |
| `npm run tunnel` | Opens a free Cloudflare Tunnel to the running bot |
| `node docs/guides/build-pdf.cjs` | Rebuilds the PDF guides (needs Playwright) |

## Deployment (decided)
- **Product website:** Cloudflare Pages project `replix`, live at **https://replix-cw3.pages.dev/**. To publish, put `CLOUDFLARE_API_TOKEN` (permission Account › Cloudflare Pages › Edit) and `CLOUDFLARE_ACCOUNT_ID` in `.env`, then run `npm run site:publish`. The owner runs this on Windows from `D:\WhatsAPPautomation` and it works.
- **The bot cannot run on Cloudflare Pages:** it needs an always-on server for webhooks, the database and the scheduler. It runs on a **VPS** (recommended for clients, ~₹400–800/month) or a PC that is always on. Cloudflare Tunnel (free) or nginx + certbot provides https. Steps are in Developer Guide section 20.
- **What each client must buy or provide:**
  - a new SIM / phone number for the bot
  - a Meta Business account (free; Meta charges per template message sent after 24 h)
  - a VPS
  - optionally: a domain, an AI API key, Razorpay or Stripe
- The Indrix website and the portfolio already show Replix (product card, work entry, project card + pop-up), linking to the live address.

## Already decided – don't redo
- The Fiverr gig material was removed from the repo on purpose.
- Focus is WhatsApp first. The engine is channel-ready (a new connector would add website chat, Telegram or Instagram later).
- Not yet tested against real accounts: live HubSpot, Airtable, Stripe, Google Sheets, OpenAI, Gemini, coexistence, and the
  tunnel. Mention this if relevant.

## Possible next steps
- First real client go-live: VPS setup, Meta app, templates, number connection.
- A website chat widget or Telegram connector.
- A custom domain for the product website.
- Showing pricing on the product site.
- Making the scheduler and database ready for very high volume.

Start by asking what the owner wants to do next. If you have repository access, read `README.md` and
`docs/DEVELOPER_GUIDE.md` first.
