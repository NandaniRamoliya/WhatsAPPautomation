# Replix <sub>by Indrix</sub>

**Replix** is a ready-to-deliver WhatsApp Cloud API platform for any local business.** Product website: https://replix.pages.dev/ · made by [Indrix](https://nandaniramoliya.github.io/Indrix/).
 You enter the client's details in a
friendly dashboard and the bot is ready: **orders, appointments, enquiries, reminders, payments, follow-ups,
reviews, recalls and a shared inbox.** One server runs as many client businesses as you like.

```
Customer: Hi
Bot:      Namaste! 🙏 *Pearl Dental* mein aapka swagat hai.          [☰ Menu kholein]
Customer: (taps) 📅 Appointment → Toothache → Upper → Swelling → Kal → 10:30 AM → ✅ Confirm
Bot:      ✅ Booking ho gayi! Toothache – Dr. Mehta · 📅 Sat, 21 Nov, 10:30 AM · 📍 Pearl Plaza …
          (day before)  ⏰ Reminder… [✅ Main aaunga] [🔄 Time badlein] [❌ Cancel]
          (after visit) Prescription & aftercare · (day 3) "Ab kaisa mehsoos kar rahe hain?" → 😊 → Google review link
          (6 months)    "Aapki *Cleaning & Scaling* ka time ho gaya hai" [📅 Abhi book karein]
```

## What's inside

| | |
|---|---|
| 🛒 **Ordering** | Catalogue with categories & search, cart, delivery or pickup, address or 📍 location, notes, **COD / UPI QR page / Razorpay / Stripe card checkout / any payment link (PayPal.me…)**, order status updates, reorder, abandoned-cart nudge, prescription photos, native WhatsApp catalogue orders |
| 📅 **Appointments** | Services & staff calendars, triage questions, race-safe slot booking, holidays/leave, **24h + 2h reminders** with confirm/reschedule/cancel buttons, aftercare & prescription message, **day-3 check-in → Google review or team alert**, recalls (6-month cleaning, monthly haircut…) |
| ❓ **Enquiries** | FAQ menu + automatic answers to typed questions (keywords), lead form with your own questions |
| 🤖 **AI assistant (RAG)** | **Claude, OpenAI GPT or Google Gemini** – chosen per client, with the client's own key. Answers any question from the business's own documents, website pages, price lists, catalogue and FAQs – in the customer's language; understands typed orders ("2 kilo aata aur 1 maggi") and booking requests; chat memory; owner instructions & tone; "Try a question" box |
| 🧩 **Menu & quick replies** | No-code custom menu buttons and keyword triggers that reply with text, link buttons, images, PDFs (price lists), map locations or jump into any flow |
| 🌐 **Languages** | English, Hinglish, **Hindi** and **Gujarati** built in; each customer can pick their language – reminders and updates follow it; every text editable per language |
| 🔌 **Integrations** | Google Sheets (copy-paste Apps Script), HubSpot, Airtable and signed webhooks for n8n / Make / Zapier / any CRM – with retries and a delivery log |
| 💬 **Inbox** | Every chat, human handoff ("talk to us"), staff replies with automatic bot pause, attachments |
| 📣 **Growth** | Broadcasts to opted-in customers, one-click Meta template creation, QR code & short link, CSV import of existing customers with automatic recalls |
| 🧭 **No-code dashboard** | Setup wizard with **12 business presets**, every bot message editable (English + Hinglish), settings in plain language, live sound alerts, mobile friendly, dark mode |
| 📘 **Help Centre** | Built into the dashboard: searchable step-by-step guides, troubleshooting, glossary, FAQ, User Guide PDF download and one-tap WhatsApp / email support (your agency's contacts from `.env`) |
| 📱 **Simulator** | Test the whole bot in the browser – no Meta account needed – with "fast-forward time" for reminders |
| 🏢 **Agency mode** | Many clients on one server, each with its own number, data and logins; super-admin console |
| 📲 **Same number as the phone app** | Supports Meta's WhatsApp Business app + API coexistence: when the owner replies from the phone, the bot steps back for that chat |
| 🔒 **Production-grade** | Webhook signature check, de-duplication, per-customer ordering, 24h-window & template fallback, encrypted secrets, roles, audit log, backups, 42 automated tests |

Works for **100+ business types** – see [docs/USE_CASES.md](docs/USE_CASES.md).

## Quick start

Requires **Node.js 22.13+** – nothing else (the database is built into Node).

```bash
git clone https://github.com/NandaniRamoliya/WhatsAPPautomation.git
cd WhatsAPPautomation
npm install
npm run setup     # creates .env (admin login, secrets)
npm run demo      # optional: Kirana, Dental clinic and Salon demo businesses
npm start         # open http://localhost:3000
```

Log in → **Test the bot** → say "Hi". Demo logins: `kirana@demo.test`, `dental@demo.test`, `salon@demo.test`
(password `demo12345`).

## Deliver to a client in 1 day

1. **All businesses → + New client business** (pick a preset, owner login).
2. **Setup wizard**: details, hours, payments / booking rules.
3. Import products (CSV) or add services & staff; replace FAQs; tweak **Bot messages**.
4. Demo with **Test the bot** on screen-share.
5. Connect the WhatsApp number (Settings → WhatsApp), **Templates → Submit all to Meta**.
6. Print the QR code. Done.

Full checklist + client requirements form: [docs/CLIENT_ONBOARDING.md](docs/CLIENT_ONBOARDING.md).

## What the client must buy / provide

| Item | Why | Typical cost |
|---|---|---|
| **A phone number (new SIM)** that is not on personal WhatsApp | Becomes the bot's WhatsApp number (or their existing WhatsApp Business app number via coexistence) | SIM ₹0–200 + recharge |
| **Meta Business account** (free) | Connects the number to the official WhatsApp Cloud API | Free; Meta charges per template message sent after 24 h |
| **VPS server** (1 vCPU / 1 GB, Ubuntu) – e.g. Hostinger, DigitalOcean, Hetzner, AWS Lightsail | Runs the bot 24/7: receives messages, sends replies and reminders, holds the database | ~₹400–800 / month |
| **Domain** (optional, recommended) | Fixed https address for the bot, e.g. `bot.clientname.com` | ~₹800 / year |
| **AI key** (optional) – Claude, OpenAI or Gemini | Only if the AI assistant is switched on | ~₹0.5–2 per AI reply |
| **Payment gateway** (optional) – Razorpay / Stripe | Online payments that confirm automatically | Gateway fee per payment |

> Cloudflare Pages (free) only hosts the **Replix website**. The bot itself needs the VPS (or a PC that is always on), with Cloudflare Tunnel or nginx giving it https.


## Deploy free with Cloudflare (like PinPage)

Replix has two parts:

| Part | Where | Cost |
|---|---|---|
| **Product website** (`product-site/`) – the marketing page | **Cloudflare Pages** → `https://replix.pages.dev/` | Free |
| **Bot + dashboard** (Node.js server: webhooks, database, reminders) | Your PC / a VPS / Render, made reachable with **Cloudflare Tunnel** | Free tunnel; server from ₹0 (your PC) |

```bash
npm run site:build     # preview: open product-site/dist/index.html
npm run site:publish   # needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in .env
npm run tunnel         # free https://xxxx.trycloudflare.com address for the bot (keep npm start running)
```

Step by step (token permissions, named tunnel on your own domain, Meta webhook): [Developer Guide §20](docs/DEVELOPER_GUIDE.md#20-deployment--operations).

## Documentation

| Guide | For |
|---|---|
| 📕 [docs/Developer-Guide.pdf](docs/Developer-Guide.pdf) | **PDF, 50 pages** – from zero to delivering clients: how the code works, every file, new-client playbook, "if this happens, do this", recipes with code, future scope |
| 📗 [docs/User-Guide.pdf](docs/User-Guide.pdf) | **PDF, 49 pages** – for owners & staff, with screenshots: every screen, playbooks for clinics, marts, cafes, pharmacies, salons, gyms, coaching, services |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Business owners & staff (non-technical) – every screen explained |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | Developers – architecture, data model, engine, API reference, extending, security, testing |
| [docs/CLIENT_ONBOARDING.md](docs/CLIENT_ONBOARDING.md) | Agencies – requirements form, delivery checklist, pricing ideas |
| [docs/META_WHATSAPP_SETUP.md](docs/META_WHATSAPP_SETUP.md) | Meta app, permanent token, webhook, templates, going live, error codes |
| [docs/USE_CASES.md](docs/USE_CASES.md) | 100 business types mapped to presets and settings |

## Project layout

```
src/            server, WhatsApp client, conversation engine + flows, services, routes, presets
public/         dashboard (Preact + htm, no build step)
product-site/   Replix marketing website (published to Cloudflare Pages)
test/           automated tests (npm test)
scripts/        setup, demo data, create-admin, backup, publish-site, tunnel
deploy/         nginx config, cron example
docs/           guides
```

## Tech

Node.js 22 · Express 5 · SQLite (`node:sqlite`, WAL) · WhatsApp Cloud API (Graph) · Preact + htm · optional
AI with Claude, OpenAI GPT or Google Gemini (structured outputs) · SQLite FTS5 for knowledge search · unpdf for PDF text. No native modules, no frontend build, no external database.

## Testing

```bash
npm test   # 42 tests: ordering, booking, AI/RAG (Claude, OpenAI, Gemini), quick replies, languages, integrations, payments, webhooks – no network needed
```

## Important

Use only the **official WhatsApp Cloud API** (this kit) – unofficial automation gets numbers banned. Send
business-initiated messages only to customers who agreed, honour STOP (automatic), and check Meta's current
pricing and policies before quoting clients.
