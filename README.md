# WhatsApp Automation Kit

**A ready-to-deliver WhatsApp Cloud API platform for any local business.** You enter the client's details in a
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
| 🛒 **Ordering** | Catalogue with categories & search, cart, delivery or pickup, address or 📍 location, notes, **COD / UPI QR page / Razorpay links**, order status updates, reorder, abandoned-cart nudge, prescription photos, native WhatsApp catalogue orders |
| 📅 **Appointments** | Services & staff calendars, triage questions, race-safe slot booking, holidays/leave, **24h + 2h reminders** with confirm/reschedule/cancel buttons, aftercare & prescription message, **day-3 check-in → Google review or team alert**, recalls (6-month cleaning, monthly haircut…) |
| ❓ **Enquiries** | FAQ menu + automatic answers to typed questions (keywords), lead form with your own questions |
| 💬 **Inbox** | Every chat, human handoff ("talk to us"), staff replies with automatic bot pause, attachments |
| 📣 **Growth** | Broadcasts to opted-in customers, one-click Meta template creation, QR code & short link, CSV import of existing customers with automatic recalls |
| 🧭 **No-code dashboard** | Setup wizard with **12 business presets**, every bot message editable (English + Hinglish), settings in plain language, live sound alerts, mobile friendly, dark mode |
| 📱 **Simulator** | Test the whole bot in the browser – no Meta account needed – with "fast-forward time" for reminders |
| 🏢 **Agency mode** | Many clients on one server, each with its own number, data and logins; super-admin console |
| 🤖 **Optional AI** | Customers can type "2 kilo aata aur 1 maggi" or free questions; Claude proposes, code validates |
| 🔒 **Production-grade** | Webhook signature check, de-duplication, per-customer ordering, 24h-window & template fallback, encrypted secrets, roles, audit log, backups, 24 automated tests |

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

## Documentation

| Guide | For |
|---|---|
| 📕 [docs/Developer-Guide.pdf](docs/Developer-Guide.pdf) | **PDF, 46 pages** – from zero to delivering clients: how the code works, every file, new-client playbook, "if this happens, do this", recipes with code, future scope |
| 📗 [docs/User-Guide.pdf](docs/User-Guide.pdf) | **PDF, 40 pages** – for owners & staff, with screenshots: every screen, playbooks for clinics, marts, cafes, pharmacies, salons, gyms, coaching, services |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Business owners & staff (non-technical) – every screen explained |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | Developers – architecture, data model, engine, API reference, extending, security, testing |
| [docs/CLIENT_ONBOARDING.md](docs/CLIENT_ONBOARDING.md) | Agencies – requirements form, delivery checklist, pricing ideas |
| [docs/META_WHATSAPP_SETUP.md](docs/META_WHATSAPP_SETUP.md) | Meta app, permanent token, webhook, templates, going live, error codes |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | VPS (PM2 + nginx + https), Docker, Render, backups, updates |
| [docs/USE_CASES.md](docs/USE_CASES.md) | 100 business types mapped to presets and settings |

## Project layout

```
src/            server, WhatsApp client, conversation engine + flows, services, routes, presets
public/         dashboard (Preact + htm, no build step)
test/           automated tests (npm test)
scripts/        setup, demo data, create-admin, backup
deploy/         nginx config, cron example
docs/           guides
```

## Tech

Node.js 22 · Express 5 · SQLite (`node:sqlite`, WAL) · WhatsApp Cloud API (Graph) · Preact + htm · optional
Anthropic Claude for AI. No native modules, no frontend build, no external database.

## Testing

```bash
npm test   # 24 tests: ordering, booking, webhook security, API, simulator, AI – no network needed
```

## Important

Use only the **official WhatsApp Cloud API** (this kit) – unofficial automation gets numbers banned. Send
business-initiated messages only to customers who agreed, honour STOP (automatic), and check Meta's current
pricing and policies before quoting clients.
