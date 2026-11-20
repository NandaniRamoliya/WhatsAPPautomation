# Meta / WhatsApp Cloud API Setup

Step-by-step: from zero to a live WhatsApp number connected to this kit. Screens and names in Meta change from
time to time – the steps stay the same. Always confirm current pricing and policies on Meta's official pages.

> You can build and demo everything **before** this, using **Test the bot** in the dashboard.

---

## What you need

| Item | Notes |
|---|---|
| Facebook account + **Meta Business** account (business.facebook.com) | Owns the WhatsApp Business Account (WABA) |
| A phone number for the bot | Must **not** be active on the normal WhatsApp / WhatsApp Business app. A new SIM is easiest. Must receive SMS or a call once |
| Business documents | GST, Udyam, shop licence, clinic registration… for business verification |
| This server reachable on **https** | `PUBLIC_URL` – ngrok for local testing, your domain in production |

## Step 1 – Create the Meta app (20 min)

1. Go to **developers.facebook.com → My Apps → Create App**.
2. Use case: **Connect with customers through WhatsApp** (or type *Business*). Name it e.g. *YourAgency Bot*.
3. Attach it to your **Meta Business** account.
4. Open **WhatsApp → API Setup**. Meta gives you a free **test number**, a **temporary token** (24h),
   the **Phone Number ID** and the **WhatsApp Business Account ID**.
5. Under **To**, add your own phone as a test recipient and confirm the code (test mode allows up to 5 numbers).

> One Meta app can serve **all** your clients. Each client's number is added to a WABA (yours or theirs) and the
> webhook routes by Phone Number ID.

## Step 2 – Permanent token (System User)

The temporary token dies in ~24 hours.

1. **business.facebook.com → Business settings → Users → System users → Add**, name `whatsapp-bot`, role **Admin**.
2. **Add assets**: your **App** (full control) and the **WhatsApp account(s)** (full control).
3. **Generate new token** → select your app → expiry **Never** → permissions
   `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Copy it once and keep it in a password manager. Never paste it in chats or GitHub.

## Step 3 – App secret

developers.facebook.com → your app → **App settings → Basic → App secret → Show**.
Put it in `.env` as `META_APP_SECRET` (all clients on this app) – or per business in Settings → WhatsApp.
It is used to verify that webhooks really come from Meta.

## Step 4 – Connect in the dashboard

Dashboard → choose the business → **Settings → WhatsApp**:

1. **Phone Number ID** (the long ID, not the phone number), **WhatsApp Business Account ID**, **Permanent access token** → **Save**.
2. **Test connection** – shows the verified name, number and quality rating. Fills the number automatically.
3. Copy the **Callback URL** (`https://YOUR-DOMAIN/webhook`) and **Verify token** shown on that page.

## Step 5 – Webhook

developers.facebook.com → your app → **WhatsApp → Configuration**:

1. **Webhook → Edit**: paste the Callback URL and Verify token → **Verify and save**.
   (Fails? The server must be reachable on https and the verify token must match exactly – test `/health` in a browser.)
2. **Webhook fields → Manage** → subscribe to **messages**.
3. Back in the dashboard: **Settings → WhatsApp → Subscribe webhooks** (subscribes the app to the WABA – needed when
   messages don't arrive even though the webhook verified).
4. From your phone send **Hi** to the number → the bot answers. 🎉

## Step 6 – Message templates

Needed for anything sent more than 24 h after the customer's last message (reminders, check-ins, recalls, late
order updates, owner alerts).

Dashboard → **Message templates → Submit all to Meta**. This creates and links:

| Slot | Name | Category | Body | Buttons |
|---|---|---|---|---|
| Owner alerts | `owner_alert` | Utility | New alert from your WhatsApp assistant: {{1}} | – |
| Order updates | `order_update` | Utility | Hi {{1}}, there is an update on your order: {{2}} | – |
| Reminders | `appointment_reminder` | Utility | Hi {{1}}, this is a reminder of your {{2}} appointment on {{3}} at {{4}}. Please confirm or reschedule using the buttons below. | Confirm, Reschedule |
| Check-in | `appointment_checkin` | Utility | Hi {{1}}, how are you feeling after your {{2}}? Tap a button to let us know. | Better, Same, Not good |
| Recall | `appointment_recall` | Marketing | Hi {{1}}, your {{2}} at {{3}} is due. Would you like to book a visit? | Book now |

Approval usually takes minutes to a day. The page shows the live status. If Meta re-categorises or rejects a
template, edit its wording in WhatsApp Manager, then enter the approved name on the Templates page.

To create templates manually: **business.facebook.com → WhatsApp Manager → Message templates → Create template**,
then type the approved name and language code on the Templates page. For broadcasts (offers) create your own
**Marketing** templates – they appear in the Broadcasts page once approved.

Rules: lowercase names with underscores; parameters `{{1}}`, `{{2}}`; choose the category honestly (Utility for
transactional, Marketing for offers); fill the sample values Meta asks for.

## Using the same number on the WhatsApp Business app (coexistence)

Meta lets many WhatsApp **Business app** numbers also connect to the Cloud API, so the owner keeps chatting from the
phone while the bot works. When onboarding through a partner flow that supports it, subscribe the webhook field for
message echoes as well. The kit handles echoes: when the owner replies from the phone, the message appears in
**Chats** (as "WhatsApp app") and the bot goes quiet for that customer. Check Meta's current eligibility rules
(country, number type) before promising it to a client.

## Step 7 – Go live with the client's real number

1. **WhatsApp Manager → Phone numbers → Add phone number**. Enter the client's dedicated number
   (if it was on the WhatsApp app, delete that WhatsApp account first).
2. Verify by SMS/voice code.
3. **Display name** = exact business name on documents. Wait for approval.
4. Add a **payment method** in Meta billing (needed for paid template messages).
5. **Business verification**: Business settings → Security centre → Start verification with the documents.
   Verification raises messaging limits and unlocks features.
6. In the dashboard update the **Phone Number ID** (and token if a different WABA) → Test connection →
   Subscribe webhooks.
7. Fill the **WhatsApp profile**: logo, description, address, hours, website (WhatsApp Manager → Phone numbers →
   Profile).
8. Re-submit templates for the new WABA if it is different (Templates → Submit all to Meta).
9. Print the QR from the dashboard Home page.

New numbers start with a limit on how many people you may **start** conversations with per day; it grows with
quality and verification. Ordering and booking bots are mostly customer-initiated, so this rarely matters. Watch the
**quality rating** and never send unwanted marketing.

## Costs (check Meta's official India rate card before quoting)

* Customer-initiated service conversations: a monthly free allowance per number, then a small per-message charge.
* Utility templates (order updates, reminders): charged per message, cheaper than marketing.
* Marketing templates (offers, recalls): the most expensive category.
Rates changed several times in 2025–2026 – always confirm before quoting a client.

## Error codes you'll see in the inbox

| Code | Meaning | Fix |
|---|---|---|
| 131030 | Recipient not in allowed list (test mode) | Add the number in API Setup, or go live |
| 131047 | More than 24 h since last customer message | Templates (Step 6) |
| 131026 | Undeliverable (not on WhatsApp / blocked / old app) | Check number format: country code, no + |
| 132000 | Template parameter count mismatch | Re-create via "Submit all to Meta" |
| 132001 | Template name/language not found or not approved | Check name + language code on Templates page |
| 190 | Token expired/invalid | System User permanent token (Step 2) |
| 133010 | Number not registered on Cloud API | Register in WhatsApp Manager |
| 130429 / 131056 | Rate limits | Slow down broadcasts; avoid many messages to one person |
| 368 | Account restricted for policy | Check WhatsApp Manager notifications |

## Advanced: Embedded Signup (self-serve onboarding)

Instead of adding every client's number to your own Meta Business, you can become a **Tech Provider** and use
**Embedded Signup** so clients connect their own WABA through a Facebook pop-up. That requires Meta app review.
Start with the simple route above; the kit already supports per-business tokens and app secrets, so moving later
only means storing the token the pop-up returns.
