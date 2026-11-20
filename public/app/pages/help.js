// Help Centre: quick start, step-by-step "How do I…" guides, troubleshooting, glossary, FAQ,
// PDF guides and support contacts. Everything is searchable from one box.
import { useState } from 'preact/hooks';
import { html, useApp } from '../lib.js';
import { Page, Card, Wordmark } from '../ui.js';

const go = (route, label) => html`<a class="help-go" href="#/${route}">${label} →</a>`;

// ---------------------------------------------------------------- How do I…
// mod: only shown when the business uses that feature. k: extra search words.
const HOWTO = [
  { group: 'Products & orders', mod: 'ordering', items: [
    { t: 'Add or edit a product', k: 'item price photo catalogue menu', route: ['catalogue', 'Open Products'], steps: [
      html`Open <b>Products</b> and tap <b>+ Add</b> (or tap a product to edit it).`,
      html`Fill in name, price and category. A photo link and description are optional but help customers decide.`,
      html`Save. The product shows in WhatsApp straight away – no restart needed.` ] },
    { t: 'Mark something out of stock', k: 'unavailable sold out hide', route: ['catalogue', 'Open Products'], steps: [
      html`Open <b>Products</b> and switch <b>In stock</b> off for that item.`,
      html`It disappears from the bot instantly. Switch it on again when it is back.` ] },
    { t: 'Upload many products from Excel', k: 'csv import bulk spreadsheet', route: ['catalogue', 'Open Products'], steps: [
      html`In Excel / Google Sheets, keep columns like <b>name, price, category, description, image_url, in_stock</b>.`,
      html`Save it as <b>CSV</b>, then Products → <b>Import CSV</b>. Tip: <b>Export</b> first to get a ready-made sheet.`,
      html`Existing products with the same name are updated, new ones are added.` ] },
    { t: 'Move an order forward', k: 'status preparing delivered dispatch', route: ['orders', 'Open Orders'], steps: [
      html`Open <b>Orders</b>. Each order shows the next step as a button (Preparing → Out for delivery → Delivered).`,
      html`Tap it – the customer gets a WhatsApp update automatically.`,
      html`For UPI or payment-link orders, check your bank / UPI app first, then tap <b>Payment received</b>.` ] },
    { t: 'Change delivery charge, minimum order or payment options', k: 'cod upi razorpay stripe free delivery', route: ['settings?tab=ordering', 'Open Ordering & payments'], steps: [
      html`Settings → <b>Ordering & payments</b>.`,
      html`Set delivery charge, free delivery above, minimum order and the payment options you accept.`,
      html`Tap <b>Save changes</b>. The next customer sees the new rules.` ] },
  ] },
  { group: 'Appointments', mod: 'booking', items: [
    { t: 'Add a service or a staff member', k: 'doctor stylist treatment duration', route: ['services', 'Open Services & staff'], steps: [
      html`Open <b>Services & staff</b>. Add the service with its duration and price.`,
      html`Add staff and tick which services each one does, with their working hours.`,
      html`Free slots are calculated automatically from hours, duration and existing bookings.` ] },
    { t: 'Block a holiday or someone’s leave', k: 'closed day off vacation leave', route: ['services', 'Open Services & staff'], steps: [
      html`Services & staff → <b>Holidays</b> for the whole business, or <b>Leave</b> on a staff member.`,
      html`Pick the dates. Those slots stop showing in WhatsApp at once. Existing bookings are not cancelled – move them yourself.` ] },
    { t: 'Book a phone or walk-in appointment yourself', k: 'manual new appointment call', route: ['appointments', 'Open Appointments'], steps: [
      html`Appointments → <b>New appointment</b>. Choose the customer number, service, staff and slot.`,
      html`The customer still gets the confirmation and the reminders on WhatsApp.` ] },
    { t: 'Finish a visit (aftercare, review, recall)', k: 'done completed prescription follow up', route: ['appointments', 'Open Appointments'], steps: [
      html`After the visit tap <b>Visit done</b>. Add a note or prescription if you want.`,
      html`The bot then sends aftercare, a "how are you feeling?" check-in, a review request to happy customers and the recall reminder – on its own.` ] },
  ] },
  { group: 'Chats & customers', items: [
    { t: 'Reply to a customer myself', k: 'human handoff talk agent inbox', route: ['inbox', 'Open Chats'], steps: [
      html`Open <b>Chats</b>. Chats marked <b>Needs reply</b> are customers who asked for a person.`,
      html`Type your reply. The bot pauses for that customer so you are not interrupted.`,
      html`When you are done tap <b>Hand back to bot</b>.` ] },
    { t: 'Import my existing customers', k: 'contacts patients csv', route: ['customers', 'Open Customers'], steps: [
      html`Customers → <b>Import CSV</b> with columns <b>phone, name, tags</b>. Numbers need the country code.`,
      html`Only mark people as opted in if they really agreed to receive WhatsApp messages from you.` ] },
    { t: 'Stop messages to a customer, or delete their data', k: 'opt out stop privacy gdpr remove', route: ['customers', 'Open Customers'], steps: [
      html`Customers can type <b>STOP</b> themselves at any time.`,
      html`Or Customers → Edit → switch off <b>Receives reminders & updates</b>.`,
      html`To erase everything about a person: Customers → Edit → <b>Delete data</b>.` ] },
    { t: 'Download my data to Excel', k: 'export report csv backup', steps: [
      html`Orders, Appointments, Customers, Enquiries and Products each have an <b>Export</b> button.`,
      html`It downloads a CSV that opens in Excel or Google Sheets.` ] },
  ] },
  { group: 'Your bot & AI', items: [
    { t: 'Change what the bot says', k: 'text wording welcome message language translate', route: ['messages', 'Open Bot messages'], steps: [
      html`Open <b>Bot messages</b>, choose the language, edit the text and save.`,
      html`Keep words in {curly} braces – they are filled in automatically (name, order number, time…).`,
      html`Check the result in <b>Test the bot</b>.` ] },
    { t: 'Add menu buttons and quick replies', k: 'custom menu button price list location offers', route: ['menu', 'Open Menu & quick replies'], steps: [
      html`Open <b>Menu & quick replies</b> and tap <b>+ Add</b>.`,
      html`Give it a short button title (max 24 letters) and the reply – text, a photo, a PDF or a link button.`,
      html`It appears in the main menu, and also answers when a customer types one of its keywords.` ] },
    { t: 'Add an FAQ answer', k: 'question keyword auto reply', route: ['faqs', 'Open FAQs'], steps: [
      html`Open <b>FAQs</b> → <b>+ Add</b>. Write the question and the answer.`,
      html`Add keywords customers really type, also in Hindi/Gujarati/Hinglish (e.g. <i>timing, kab khulta, samay</i>).` ] },
    { t: 'Turn on the AI assistant', k: 'chatgpt claude gemini openai artificial intelligence api key', route: ['ai', 'Open AI assistant'], steps: [
      html`Open <b>AI assistant</b>. Choose the engine (Claude, OpenAI GPT or Google Gemini) and paste the API key.`,
      html`Switch AI on, give it a name and tone, and write any instructions (e.g. "never promise same-day delivery").`,
      html`Use <b>Try a question</b> with 5–10 real customer questions before going live.` ] },
    { t: 'Teach the AI my prices and policies', k: 'knowledge base pdf website document rag train', route: ['ai', 'Open AI assistant'], steps: [
      html`AI assistant → <b>Knowledge base</b>. Add text, upload a PDF, or paste a website page link.`,
      html`The AI answers only from this information and your settings. If it doesn't know, it offers the menu or your team.`,
      html`Update the knowledge when prices change – no retraining needed.` ] },
    { t: 'Let customers pick their language', k: 'hindi gujarati hinglish english', route: ['settings?tab=languages', 'Open Languages'], steps: [
      html`Settings → <b>Languages</b>. Tick the languages you want and turn on the language choice.`,
      html`Customers can also type <b>language</b> any time to switch.` ] },
    { t: 'Test everything before going live', k: 'simulator demo try fast forward', route: ['test', 'Open Test the bot'], steps: [
      html`Open <b>Test the bot</b> – it is a phone that behaves exactly like WhatsApp, but nothing is sent.`,
      html`Try "Hi", every menu button, a typed question, an order or a booking.`,
      html`<b>Fast-forward time</b> shows reminders, check-ins and recalls in a minute.` ] },
  ] },
  { group: 'Grow your business', items: [
    { t: 'Get customers to message you', k: 'qr code link share instagram google', route: ['overview', 'Open Home'], steps: [
      html`Home → <b>Share your WhatsApp link</b>. Download the QR code.`,
      html`Print it on the counter, bills and visiting cards; add the link to Instagram and your Google Business Profile.` ] },
    { t: 'Send an offer to many customers', k: 'broadcast bulk festival promotion campaign', route: ['broadcasts', 'Open Broadcasts'], steps: [
      html`First get a <b>Message template</b> approved by WhatsApp (Message templates page).`,
      html`Broadcasts → <b>New broadcast</b>, pick the template and the audience (only opted-in customers are included).`,
      html`Start small. Many "block / report" taps can restrict your number.` ] },
    { t: 'Send leads and orders to Google Sheets or a CRM', k: 'hubspot airtable zapier make n8n webhook integration', route: ['integrations', 'Open Integrations'], steps: [
      html`Open <b>Integrations</b>. For Google Sheets, <b>Copy script</b>, paste it in the sheet's Extensions → Apps Script, deploy, and paste the link back.`,
      html`For HubSpot or Airtable paste the key; for Zapier / Make / n8n paste the webhook link.`,
      html`Tap <b>Send test</b> – a green tick means it works.` ] },
  ] },
  { group: 'Account & team', items: [
    { t: 'Give a staff member their own login', k: 'user team add employee role', route: ['settings?tab=team', 'Open Team'], steps: [
      html`Settings → <b>Team</b> → <b>+ Add</b>. Enter their email and a password, role <b>Staff</b>.`,
      html`Staff can handle orders, appointments and chats, but cannot change settings.` ] },
    { t: 'Change my password', k: 'login security', route: ['settings?tab=account', 'Open My account'], steps: [
      html`Settings → <b>My account</b>, enter the current and new password, <b>Change password</b>.`,
      html`Forgot it? Ask the owner or your administrator to reset it.` ] },
    { t: 'Change opening hours or business details', k: 'timing address phone maps review link', route: ['settings', 'Open Settings'], steps: [
      html`Settings → <b>Business</b> for name, address, Google Maps & review links; <b>Opening hours</b> for timings.`,
      html`Choose what the bot does when you are closed: keep working, or only collect messages.` ] },
  ] },
];

// ---------------------------------------------------------------- Something not working?
const TROUBLE = [
  { t: 'Nobody is getting replies', k: 'bot not working down offline', fix: html`Settings → <b>WhatsApp</b> → <b>Test connection</b>. If it fails, the access token may have changed – ask your developer. If it passes, send "Hi" from another phone and check <b>Chats</b>.` },
  { t: 'One customer is not getting replies', k: 'paused', fix: html`Open the chat. If it says <b>Bot paused</b>, tap <b>Hand back to bot</b>. The customer can also type <b>menu</b> to restart.` },
  { t: 'A message shows ⚠️ "24h window closed"', k: 'failed template not delivered', fix: html`WhatsApp allows free-form messages only within 24 hours of the customer's last message. For later messages (reminders, order updates) set up approved templates on the <b>Message templates</b> page.` },
  { t: 'A product or service does not show in the bot', k: 'missing hidden', fix: html`Check it is <b>In stock</b> / active, has a price, and belongs to a category. Lists show 10 items per page – the customer can tap <i>More</i>.` },
  { t: 'No appointment slots are offered', k: 'booking full no time available', fix: html`Check <b>Opening hours</b>, staff working hours, holidays and leave, and Settings → Appointments → <b>minimum notice</b> and <b>days ahead</b>.` },
  { t: 'The AI gives a wrong or no answer', k: 'ai wrong hallucination', fix: html`Add the correct fact to AI assistant → <b>Knowledge base</b> (or an FAQ), then check it with <b>Try a question</b>. If the AI page says <i>Needs an API key</i>, the key is missing or expired.` },
  { t: 'Online payment received but order still "unpaid"', k: 'razorpay stripe webhook', fix: html`The payment provider's webhook may not be set up. Check Settings → Ordering & payments (the webhook link is shown there). Meanwhile tap <b>Payment received</b> on the order yourself.` },
  { t: 'No sound for new orders', k: 'alert beep notification', fix: html`Browsers only allow sound after you tap the page once. Keep this dashboard open and tap anywhere after opening it.` },
  { t: 'Google Sheets / CRM is not receiving leads', k: 'integration failed', fix: html`Integrations → look at the <b>recent deliveries</b> log for the error, fix the link or key, and tap <b>Send test</b>. Failed deliveries are retried automatically.` },
];

// ---------------------------------------------------------------- Words you will see
const GLOSSARY = [
  ['24-hour window', 'After a customer messages you, you can reply freely for 24 hours. After that, only approved templates can be sent.'],
  ['Template', 'A message pre-approved by WhatsApp (reminders, offers, order updates) that can be sent at any time.'],
  ['Opted in', 'The customer agreed to receive messages from you. Only they get broadcasts.'],
  ['Hand-off', 'The bot passes the chat to your team and stays quiet for that customer until you hand it back.'],
  ['Knowledge base', 'Your documents, price lists and website pages that the AI assistant answers from.'],
  ['Quick reply', 'A menu button or keyword that sends a fixed answer, photo, PDF or link.'],
];

// ---------------------------------------------------------------- FAQ
const FAQ = [
  { t: 'How do customers find the bot?', a: html`Print the QR from the Home page. Share the chat link on Instagram, Google Business Profile, bills and visiting cards.` },
  { t: 'Is it safe to send offers to everyone?', a: html`Only to customers who agreed. WhatsApp checks complaints – too many "block / report" taps can restrict your number.` },
  { t: 'Can I keep using WhatsApp on my phone?', a: html`If your number is connected in "coexistence" mode, yes. When you reply from the phone, the bot goes quiet for that customer automatically.` },
  { t: 'What does WhatsApp charge?', a: html`Replies within 24 hours of the customer's message are free. Templates sent later are charged by Meta per message, by category and country.` },
  { t: 'Does the AI cost money?', a: html`Only when it is switched on – roughly ₹0.5–2 per AI reply on your own AI account. Buttons, FAQs and menus cost nothing.` },
  { t: 'Does the bot work at night?', a: html`Yes, 24/7. Under Settings → Opening hours you choose whether it keeps taking orders/bookings when you are closed.` },
  { t: 'Is my data safe?', a: html`Your data stays on your own server. Passwords and keys are stored encrypted, and you can export or delete any customer's data.` },
];

const norm = (s) => String(s).toLowerCase();
const textOf = (v) => (Array.isArray(v) ? v.map(textOf).join(' ') : v && typeof v === 'object' ? textOf(v.props?.children ?? v.children ?? '') : String(v ?? ''));

const HowTo = ({ item }) => html`<details class="card help-item"><summary><strong>${item.t}</strong></summary>
  <ol class="help-steps">${item.steps.map((s) => html`<li>${s}</li>`)}</ol>
  ${item.route && go(...item.route)}
</details>`;
const Trouble = ({ item }) => html`<details class="card help-item"><summary><strong>${item.t}</strong></summary><div class="help-fix">${item.fix}</div></details>`;
const Faq = ({ item }) => html`<details class="card help-item"><summary><strong>${item.t}</strong></summary><div class="help-fix">${item.a}</div></details>`;

function Support({ about, biz, me }) {
  const b = about?.brand || {};
  const msg = encodeURIComponent(`Hi ${b.company || 'Indrix'} team, I need help with ${b.name || 'Replix'} for "${biz.name}" (v${about?.version || ''}).\n\nWhat happened: `);
  const mail = `mailto:${b.supportEmail}?subject=${encodeURIComponent(`${b.name} help – ${biz.name}`)}&body=${msg}`;
  const has = b.supportWhatsapp || b.supportEmail;
  return html`<${Card} title="💬 Contact support">
    ${has ? html`<p class="muted">We usually reply within a few hours${b.supportHours ? ` (${b.supportHours})` : ''}.</p>
      <div class="row gap wrap">
        ${b.supportWhatsapp && html`<a class="btn primary" target="_blank" rel="noopener" href=${`https://wa.me/${b.supportWhatsapp}?text=${msg}`}>WhatsApp support</a>`}
        ${b.supportEmail && html`<a class="btn" href=${mail}>Email ${b.supportEmail}</a>`}
      </div>`
    : html`<p class="muted">Contact the person or agency who set up your bot.${me.user.role === 'superadmin' ? html` <i>(Admin: set <code>SUPPORT_WHATSAPP</code> and <code>SUPPORT_EMAIL</code> in <code>.env</code> to show buttons here.)</i>` : ''}</p>`}
    <p style="margin:14px 0 6px"><b>To get help faster, tell us:</b></p>
    <ul class="help-steps">
      <li>Which page you were on and what you tapped</li>
      <li>The customer's number (if it is about one chat) and the time it happened</li>
      <li>A screenshot of the message or error</li>
    </ul>
  <//>`;
}

export function Help() {
  const { biz, me, about } = useApp();
  const [q, setQ] = useState('');
  const has = (m) => !m || biz.modules.includes(m);
  const groups = HOWTO.filter((g) => has(g.mod));
  const words = norm(q).split(/\s+/).filter(Boolean);
  const match = (...parts) => { const s = norm(parts.map(textOf).join(' ')); return words.every((w) => s.includes(w)); };
  const b = about?.brand || {};
  const isAdmin = me.user.role === 'superadmin';

  const results = words.length ? {
    howto: groups.flatMap((g) => g.items.filter((i) => match(i.t, i.k, g.group, i.steps))),
    trouble: TROUBLE.filter((i) => match(i.t, i.k, i.fix)),
    faq: FAQ.filter((i) => match(i.t, i.a)),
  } : null;
  const count = results ? results.howto.length + results.trouble.length + results.faq.length : 0;

  return html`<${Page} title="Help Centre" subtitle="Step-by-step guides, fixes for common problems, and how to reach us.">
    <div class="card help-hero">
      <div class="row between wrap gap">
        <div><${Wordmark} about=${about} size="lg" /><div class="muted small">Version ${about?.version || ''}</div></div>
        <div class="row gap wrap">
          <a class="btn" href="/guides/user-guide.pdf" target="_blank" rel="noopener">📘 User Guide (PDF)</a>
          ${isAdmin && html`<a class="btn" href="/guides/developer-guide.pdf" target="_blank" rel="noopener">🛠️ Developer Guide (PDF)</a>`}
        </div>
      </div>
      <input class="help-search" type="search" placeholder="Search help – e.g. out of stock, holiday, AI, password, QR" aria-label="Search help" value=${q} onInput=${(e) => setQ(e.target.value)} />
    </div>

    ${results ? html`
      <p class="muted">${count ? `${count} result${count > 1 ? 's' : ''} for “${q}”` : html`No results for “${q}”. Try another word, or contact support below.`}</p>
      ${results.howto.map((i) => html`<${HowTo} item=${i} />`)}
      ${results.trouble.map((i) => html`<${Trouble} item=${i} />`)}
      ${results.faq.map((i) => html`<${Faq} item=${i} />`)}
    ` : html`
      <h2 class="help-h">🚀 Start here</h2>
      <div class="grid help-start">
        <div class="card"><div class="q-num">1</div><h3>Fill in your details</h3><p class="muted">The setup wizard asks for your business, hours and what the bot should do.</p>${go('setup', 'Setup wizard')}</div>
        <div class="card"><div class="q-num">2</div><h3>Try it yourself</h3><p class="muted">Chat with your bot on the test phone. Nothing is sent to real customers.</p>${go('test', 'Test the bot')}</div>
        <div class="card"><div class="q-num">3</div><h3>Go live & share</h3><p class="muted">Finish the go-live checklist on Home, then share your QR code and link.</p>${go('overview', 'Home')}</div>
      </div>

      <${Card} title="🗓️ Your daily routine (5 minutes)">
        <ol class="help-steps">
          <li>Keep this dashboard open on a computer or phone – new orders/bookings make a <b>sound</b> (tap anywhere once so the browser allows sound).</li>
          ${biz.modules.includes('ordering') && html`<li><b>Orders:</b> tap "Payment received" for UPI orders after checking your bank app, then move orders to Preparing → Out for delivery → Delivered. The customer is told automatically.</li>`}
          ${biz.modules.includes('booking') && html`<li><b>Appointments:</b> after each visit tap "Visit done". The bot sends aftercare, a check-in, a review request and the recall – automatically.</li>`}
          <li><b>Chats:</b> reply to anyone marked "Needs reply". When you reply, the bot pauses for that customer; tap "Hand back to bot" when done.</li>
          <li>Switch items <b>out of stock</b> / add holidays so the bot never promises what you cannot give.</li>
        </ol>
      <//>

      <h2 class="help-h">📖 How do I…</h2>
      ${groups.map((g) => html`<h3 class="help-group">${g.group}</h3>${g.items.map((i) => html`<${HowTo} item=${i} />`)}`)}

      <h2 class="help-h">🧰 Something not working?</h2>
      ${TROUBLE.map((i) => html`<${Trouble} item=${i} />`)}

      <h2 class="help-h">❓ Frequently asked questions</h2>
      ${FAQ.map((i) => html`<${Faq} item=${i} />`)}

      <${Card} title="🔤 Words you will see">
        <dl class="help-glossary">${GLOSSARY.map(([w, d]) => html`<dt>${w}</dt><dd>${d}</dd>`)}</dl>
      <//>
    `}

    <${Support} about=${about} biz=${biz} me=${me} />

    <p class="muted small help-about">
      ${b.name || 'Replix'} v${about?.version || ''} · made by <a href=${b.companyUrl} target="_blank" rel="noopener">${b.company || 'Indrix'}</a>
      ${b.siteUrl && html` · <a href=${b.siteUrl} target="_blank" rel="noopener">${new URL(b.siteUrl).host}</a>`}
    </p>
  <//>`;
}
