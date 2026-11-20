# Client Onboarding & Fast Delivery Playbook

How to go from "a new client said yes" to "live on WhatsApp" in **1 day of work** (plus Meta's approval waiting time).
Everything is already built – this is the checklist of the small things you fill in for each client.

---

## Part A – Requirements form (send to the client / fill on a call)

Copy this into a Google Form, or fill it with the client on a 20-minute call.

### 1. Business basics
| Question | Answer |
|---|---|
| Business name (exactly as on documents) | |
| Business type (shop, restaurant, pharmacy, clinic, salon, gym, coaching, service, real estate, other) | |
| Address + Google Maps link | |
| Owner name, owner WhatsApp number (for alerts), owner email (for dashboard login) | |
| Staff who need a login (name, email, role: owner/staff) | |
| Opening hours for each day, lunch break, weekly off | |
| Holidays in the next 3 months | |
| Language for customers: English / Hinglish / both (write some sample lines in their words) | |
| Google review link (Google Business Profile → "Ask for reviews") | |

### 2. WhatsApp number & Meta
| Question | Answer |
|---|---|
| Which number will the bot use? (must NOT be on the normal WhatsApp app – new SIM is easiest) | |
| Does the business have a Facebook / Meta Business account? (or create one on the call) | |
| Business documents for verification (GST / Udyam / shop licence / clinic registration) | |
| Display name to show on WhatsApp (must match the business name) | |
| Profile photo/logo, description, website for the WhatsApp profile | |

### 3. Ordering (if they sell products)
| Question | Answer |
|---|---|
| Product list (Excel: name, price, category, unit, description, in stock) – top 50–100 items is enough to start | |
| Home delivery? Delivery area? Delivery charge? Free delivery above? | |
| Pickup from shop? | |
| Minimum order value | |
| Payment: Cash on delivery / UPI (UPI ID + name) / Online (Razorpay account keys) | |
| Expected delivery time to tell customers | |
| Special instructions needed? (cake message, spice level) | |
| Pharmacy: accept prescription photos? | |

### 4. Appointments (if they take bookings)
| Question | Answer |
|---|---|
| Services: name, duration, price, aftercare instructions, repeat after how many days (recall) | |
| Staff/doctors: name, title, which services, their own hours if different, WhatsApp for alerts | |
| Slot gap (every 15 / 30 / 60 minutes) | |
| How many days ahead can customers book? Minimum notice? | |
| Can customers choose the doctor/stylist? | |
| Questions to ask before booking (e.g. "Which tooth?", "Since when?") with answer options | |
| Reminders: 1 day before? 2 hours before? | |
| Check-in after the visit? After how many days? | |
| Existing patient/customer list with last visit dates (for recalls) | |

### 5. FAQs & enquiries
| Question | Answer |
|---|---|
| 5–10 questions customers ask most, with answers (fees, timings, parking, location, delivery area…) | |
| Words customers use for each (in English and Hindi/local language) | |
| Enquiry form questions (e.g. Budget, Location, Requirement) | |

### 6. Extras
| Question | Answer |
|---|---|
| Who replies when a customer asks for a person? During which hours? | |
| What should happen when closed? (keep taking orders/bookings, or only collect messages) | |
| Offers/broadcast plans (needs customer consent) | |
| AI understanding of typed messages wanted? (needs ANTHROPIC_API_KEY on the server) | |

---

## Part B – Delivery checklist (developer / agency)

### Day 0 – before the call (10 min)
- [ ] Server is running (one server for all your clients – see [DEPLOYMENT.md](DEPLOYMENT.md)).
- [ ] Agency dashboard → **All businesses → + New client business** → choose preset, owner phone, owner login,
      "Add example data" ON (great for the demo).

### Day 1 – configuration (2–3 hours)
1. [ ] **Setup wizard** (opens automatically): business type → details → hours → payments/booking rules → finish.
2. [ ] **Products**: delete examples, import the client's Excel (save as CSV → *Import CSV*, tick "Replace").
       *or* **Services & staff**: enter services (with aftercare + recall days), staff, holidays.
3. [ ] **FAQs**: replace the examples with the client's 5–10 questions + keywords (add Hinglish words).
4. [ ] **Settings → Appointments / Enquiry form**: triage questions / lead questions.
5. [ ] **Bot messages**: adjust tone and words to the client's style (they love seeing their own phrases).
6. [ ] **Test the bot**: run every path – order with each payment mode, booking, reschedule, cancel,
       "⏩ Fast-forward time" for reminders, "Visit done" → check-in → review, FAQ, enquiry, *talk to someone*, STOP.
7. [ ] Demo to the client using **Test the bot** on screen-share. Collect changes. Fix them in 10 minutes.

### Day 1–3 – WhatsApp go-live (mostly waiting for Meta)
Follow [META_WHATSAPP_SETUP.md](META_WHATSAPP_SETUP.md):
- [ ] Add the client's number to your Meta Business (WhatsApp Manager → Add phone number), verify OTP,
      set display name, add payment method, start business verification.
- [ ] Dashboard → **Settings → WhatsApp**: Phone Number ID, WABA ID, permanent token → **Save** →
      **Test connection** → **Subscribe webhooks**.
- [ ] **Message templates → Submit all to Meta**; check back until all show **Approved**.
- [ ] Send "Hi" from your own phone to the client's number → full flow once more for real.
- [ ] Ask the owner to send "Hi" to the bot (opens their 24h window for free alerts) – and explain that alerts
      also work via the approved `owner_alert` template.

### Handover (30 min)
- [ ] Owner + staff logins work; give them [USER_GUIDE.md](USER_GUIDE.md) (export to PDF).
- [ ] Show: Home, Orders/Appointments, Chats (reply + hand back to bot), stock switch, Bot messages.
- [ ] Download the QR (Home → *Download big QR*), print for counter / bills / posters; share the chat link on
      Instagram, Google Business Profile, Facebook.
- [ ] Import existing customers/patients (Customers → Import CSV, with last_visit + service for recalls).
- [ ] Turn off example data leftovers. Mark setup complete.

### After launch
- [ ] Day 3: check chats together – where did customers get stuck? Improve FAQs/messages.
- [ ] Day 14: review numbers (orders/bookings, response time, no-shows, reviews). Use them as a case study.
- [ ] Monthly: backup check, Meta quality rating, template status, new FAQs.

---

## Part C – What changes per client (and where)

| Item | Where | Code? |
|---|---|---|
| Business type & modules | Wizard / Settings → Features | No |
| Catalogue / services / staff / hours / holidays | Dashboard pages | No |
| All texts, language, emojis | Bot messages | No |
| Payments (COD, UPI, Razorpay) | Settings → Ordering & payments | No |
| Triage / lead questions | Settings | No |
| Reminders, check-in, review, recall | Settings + Services | No |
| WhatsApp number & templates | Settings → WhatsApp, Templates | No |
| Logo/brand colours of the dashboard | `public/app/styles.css` (`--brand`) | CSS only |
| A completely new conversation type | New flow – see DEVELOPER_GUIDE §17 | Yes (~1 file) |
| New payment gateway / integration (Google Sheets, CRM) | New service + webhook | Yes |

## Part D – Pricing ideas (for you, the agency)

From the source playbooks: a **setup fee** (a few thousand rupees) + **monthly fee** (hundreds of rupees) per
business is the common shape for local shops; clinics pay more because no-shows and reviews are worth more.
Association/market bundles (one deal, many shops, shared branding) roll out fastest – onboard 5 pilot shops free for
a month and use their numbers as proof. Always include Meta's per-message template charges in your quote.

**Pitch in three lines:** *"Customers order/book on WhatsApp 24 hours a day. You see every order and booking in one
list, and reminders, follow-ups and reviews happen automatically. No app, no commission."*
