import { useState } from 'preact/hooks';
import { html, api, act, useApi, useApp } from '../lib.js';
import { Page, Card, Tabs, FormFields, HoursEditor, QuestionsEditor, Button, AsyncButton, Copy, Alert, Toggle, Field, Badge, ResourceManager } from '../ui.js';

const tabFromHash = () => new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'business';

export const businessFields = (meta) => [
  { key: 'name', label: 'Business name', required: true },
  { key: 'owner_phone', label: 'Owner WhatsApp number (for alerts)', required: true, help: 'New orders, bookings and "talk to a person" requests are sent here.', placeholder: '98765 43210' },
  { key: 'contact_phone', label: 'Public contact number', help: 'Shown to customers. Also used for your wa.me link until WhatsApp is connected.' },
  { key: 'owner_email', label: 'Owner email', type: 'email' },
  { key: 'address', label: 'Address', type: 'textarea', rows: 2, wide: true, help: 'Sent with booking confirmations and pickup orders.' },
  { key: 'map_link', label: 'Google Maps link', type: 'url', placeholder: 'https://maps.app.goo.gl/…' },
  { key: 'review_link', label: 'Google review link', type: 'url', help: 'Sent after a happy check-in. Get it from your Google Business Profile → "Ask for reviews".' },
  { key: 'website', label: 'Website', type: 'url' },
  { key: 'about', label: 'About the business (used by AI answers)', type: 'textarea', wide: true },
  { key: 'language', label: 'Bot language', type: 'select', options: Object.entries(meta.languages).map(([value, label]) => ({ value, label })) },
  { key: 'timezone', label: 'Time zone', type: 'select', options: meta.timezones },
  { key: 'currency', label: 'Currency', type: 'select', options: ['INR', 'USD', 'EUR', 'GBP', 'AED', 'PKR', 'BDT', 'NPR', 'LKR', 'SAR'] },
];

export const orderingFields = [
  { key: 'settings.ordering.delivery', label: 'Home delivery', type: 'toggle' },
  { key: 'settings.ordering.pickup', label: 'Pickup / takeaway from the shop', type: 'toggle' },
  { key: 'settings.ordering.delivery_fee', label: 'Delivery charge', type: 'money', hidden: (v) => !v.settings.ordering.delivery },
  { key: 'settings.ordering.free_delivery_above', label: 'Free delivery above', type: 'money', help: '0 = never free', hidden: (v) => !v.settings.ordering.delivery },
  { key: 'settings.ordering.min_order', label: 'Minimum order value', type: 'money', help: '0 = no minimum' },
  { key: 'settings.ordering.eta_text', label: 'Delivery time shown to customers', placeholder: '30-45 minutes' },
  { key: 'settings.ordering.payment_modes', label: 'Payment options', type: 'checks', wide: true, options: [{ value: 'cod', label: '💵 Cash on delivery / at pickup' }, { value: 'upi', label: '📱 UPI (QR + app link, you confirm)' }, { value: 'online', label: '💳 Razorpay (India, auto-confirms)' }, { value: 'stripe', label: '🌍 Stripe card payment (international, auto-confirms)' }, { value: 'link', label: '🔗 Any payment link – PayPal.me, Instamojo… (you confirm)' }] },
  { key: 'settings.ordering.upi_id', label: 'UPI ID', placeholder: 'shopname@okicici', hidden: (v) => !v.settings.ordering.payment_modes?.includes('upi') },
  { key: 'settings.ordering.upi_name', label: 'Name shown in UPI app', hidden: (v) => !v.settings.ordering.payment_modes?.includes('upi') },
  { key: 'settings.ordering.razorpay_key_id', label: 'Razorpay Key ID', placeholder: 'rzp_live_…', hidden: (v) => !v.settings.ordering.payment_modes?.includes('online') },
  { key: 'secrets.razorpay_key_secret', label: 'Razorpay Key Secret', type: 'password', help: 'Leave empty to keep the saved one.', hidden: (v) => !v.settings.ordering.payment_modes?.includes('online') },
  { key: 'secrets.razorpay_webhook_secret', label: 'Razorpay Webhook Secret', type: 'password', help: 'Leave empty to keep the saved one.', hidden: (v) => !v.settings.ordering.payment_modes?.includes('online') },
  { key: 'secrets.stripe_secret_key', label: 'Stripe secret key', type: 'password', help: 'Stripe Dashboard → Developers → API keys (sk_live_…). Leave empty to keep the saved one.', hidden: (v) => !v.settings.ordering.payment_modes?.includes('stripe') },
  { key: 'secrets.stripe_webhook_secret', label: 'Stripe webhook signing secret', type: 'password', help: 'whsec_… from the webhook you create (URL shown below). Leave empty to keep the saved one.', hidden: (v) => !v.settings.ordering.payment_modes?.includes('stripe') },
  { key: 'settings.ordering.pay_link_template', label: 'Payment link', wide: true, placeholder: 'https://paypal.me/yourshop/{amount}', help: 'Use {amount}, {order_no}, {currency}, {phone} – they are filled per order.', hidden: (v) => !v.settings.ordering.payment_modes?.includes('link') },
  { key: 'settings.ordering.ask_notes', label: 'Ask for special instructions', type: 'toggle', help: 'e.g. "less spicy", cake message' },
  { key: 'settings.ordering.show_images', label: 'Show product photos', type: 'toggle', help: 'Sends the photo before asking quantity (needs Photo URL on products).' },
  { key: 'settings.ordering.accept_prescriptions', label: 'Accept photos / prescriptions during ordering', type: 'toggle', help: 'For pharmacies: photos are attached to the order and flagged in Chats.' },
  { key: 'settings.ordering.cart_nudge_minutes', label: 'Remind about unfinished cart after (minutes)', type: 'number', help: '0 = off. Sent once, only within 24h of their last message.' },
];

export const bookingFields = [
  { key: 'settings.booking.staff_label', label: 'What do you call your staff?', placeholder: 'Doctor / Stylist / Trainer' },
  { key: 'settings.booking.slot_interval', label: 'Gap between start times (minutes)', type: 'number', min: 5, help: '15 = 10:00, 10:15, 10:30…' },
  { key: 'settings.booking.days_ahead', label: 'How many days ahead customers can book', type: 'number', min: 1, max: 60 },
  { key: 'settings.booking.min_notice_min', label: 'Minimum notice (minutes)', type: 'number', help: '60 = cannot book a slot starting within the next hour' },
  { key: 'settings.booking.allow_staff_choice', label: 'Let customers choose the staff member', type: 'toggle' },
  { key: 'settings.booking.ask_name', label: 'Ask for the patient / customer name', type: 'toggle' },
  { key: 'settings.booking.checkin_days', label: 'Send "how are you feeling?" after (days)', type: 'number', help: '0 = off. Happy answer → review link. Unhappy → alert to you.' },
  { key: 'settings.booking.review_request', label: 'Ask happy customers for a Google review', type: 'toggle' },
  { key: 'settings.booking.auto_complete_hours', label: 'Auto-mark visits as done after (hours)', type: 'number', help: '0 = you mark them done. Auto = aftercare & follow-ups run without clicks.' },
];

function Reminders({ value = [], onChange }) {
  const fmt = (m) => (m % 1440 === 0 ? `${m / 1440} day(s)` : m % 60 === 0 ? `${m / 60} hour(s)` : `${m} min`);
  return html`<div class="col">
    ${value.map((r, i) => html`<div class="row gap wrap">
      <${Toggle} checked=${r.enabled} onChange=${(v) => onChange(value.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} label=${`Reminder ${fmt(r.minutes_before)} before`} />
      <input type="number" aria-label="Minutes before" style="width:120px" value=${r.minutes_before} onInput=${(e) => onChange(value.map((x, j) => (j === i ? { ...x, minutes_before: Number(e.target.value) } : x)))} /> <span class="muted small">minutes before</span>
      <button class="icon-btn" aria-label="Remove reminder" onClick=${() => onChange(value.filter((_, j) => j !== i))}>✕</button>
    </div>`)}
    <div><${Button} small onClick=${() => onChange([...value, { minutes_before: 720, enabled: true }])}>+ Add reminder<//></div>
  </div>`;
}

function WhatsAppTab({ biz, reloadBiz }) {
  const links = useApi('/links');
  const w = biz.whatsapp;
  const [f, setF] = useState({ phone_number_id: w.phone_number_id || '', waba_id: w.waba_id || '', display_phone: w.display_phone || '', token: '', app_secret: '' });
  const [info, setInfo] = useState(null);
  const [to, setTo] = useState(biz.owner_phone || '');
  const save = async () => { if (await act(() => api('/business/whatsapp', { method: 'PUT', body: f }), 'WhatsApp details saved')) { setF({ ...f, token: '', app_secret: '' }); reloadBiz(); } };
  return html`<div>
    <${Card} title=${html`WhatsApp connection ${w.connected ? html`<${Badge} tone="ok">Connected<//>` : html`<${Badge} tone="warn">Not connected<//>`}`}>
      <${Alert}>You get these from <b>developers.facebook.com → your app → WhatsApp → API Setup</b>. Full step-by-step guide: <code>docs/META_WHATSAPP_SETUP.md</code>. Until connected, the bot still works in <a href="#/test">Test the bot</a>.<//>
      <div class="form-grid">
        <${Field} f=${{ key: 'pnid', label: 'Phone Number ID', placeholder: '123456789012345', help: 'NOT the phone number – the long ID below it.' }} value=${f.phone_number_id} onChange=${(v) => setF({ ...f, phone_number_id: v })} />
        <${Field} f=${{ key: 'waba', label: 'WhatsApp Business Account ID' }} value=${f.waba_id} onChange=${(v) => setF({ ...f, waba_id: v })} />
        <${Field} f=${{ key: 'display', label: 'WhatsApp number (with country code)', placeholder: '919876543210', help: 'Filled automatically by "Test connection".' }} value=${f.display_phone} onChange=${(v) => setF({ ...f, display_phone: v })} />
        <${Field} f=${{ key: 'token', label: 'Permanent access token', type: 'password', placeholder: w.token || 'EAAG…', help: 'System User token (never expires). Leave empty to keep the saved one.' }} value=${f.token} onChange=${(v) => setF({ ...f, token: v })} />
        <${Field} f=${{ key: 'secret', label: 'App secret (optional)', type: 'password', placeholder: w.app_secret || (w.global_app_secret ? 'Using server default' : ''), help: 'Only if this client uses their own Meta app.' }} value=${f.app_secret} onChange=${(v) => setF({ ...f, app_secret: v })} />
      </div>
      <div class="row gap wrap" style="margin-top:14px">
        <${AsyncButton} variant="primary" onClick=${save}>Save<//>
        <${AsyncButton} onClick=${async () => { const r = await act(() => api('/business/whatsapp/test', { method: 'POST' }), 'Connected to Meta ✅'); if (r) { setInfo(r.info); reloadBiz(); } }}>Test connection<//>
        <${AsyncButton} onClick=${() => act(() => api('/business/whatsapp/subscribe', { method: 'POST' }), 'App subscribed – messages will now arrive')}>Subscribe webhooks<//>
      </div>
      ${info && html`<${Alert} tone="ok">✅ <b>${info.verified_name}</b> · ${info.display_phone_number} · quality: ${info.quality_rating || 'n/a'}<//>`}
    <//>
    <${Card} title="Webhook (paste these in Meta → WhatsApp → Configuration)">
      ${links.data && html`<${Copy} label="Callback URL" value=${links.data.webhookUrl} /><${Copy} label="Verify token" value=${links.data.verifyToken} />
      ${!links.data.publicUrl.startsWith('https') && html`<${Alert} tone="warn">PUBLIC_URL is not https. Meta only accepts https webhooks – use ngrok locally or your domain in production.<//>`}
      <p class="muted small">Then click <b>Manage</b> under Webhook fields and subscribe to <b>messages</b>.</p>
      ${biz.settings.ordering?.payment_modes?.includes('online') && html`<${Copy} label="Razorpay webhook" value=${links.data.razorpayWebhook} /><p class="muted small">In Razorpay → Settings → Webhooks, add this URL with event <b>payment_link.paid</b>.</p>`}`}
    <//>
    <${Card} title="Send a test message">
      <div class="row gap wrap"><input aria-label="Phone number" style="max-width:260px" value=${to} onInput=${(e) => setTo(e.target.value)} placeholder="919876543210" />
        <${AsyncButton} onClick=${() => act(() => api('/business/whatsapp/test-message', { method: 'POST', body: { to } }), 'Sent!')}>Send<//></div>
      <p class="muted small">Works only if this number messaged your bot in the last 24 hours (or is in Meta's test recipients list while in test mode).</p>
    <//>
  </div>`;
}

function Team() {
  return html`<${ResourceManager} path="team" singular="Team member" defaults=${{ role: 'staff' }}
    empty="Add logins for your staff. Staff can manage orders, appointments and chats."
    columns=${[{ label: 'Name', render: (u) => html`<strong>${u.name || '—'}</strong><div class="small muted">${u.email}</div>` }, { label: 'Role', render: (u) => html`<${Badge} tone=${u.role === 'owner' ? 'ok' : 'info'}>${u.role}<//>` }, { label: 'Active', render: (u) => (u.active ? 'Yes' : 'No') }]}
    fields=${[
      { key: 'name', label: 'Name' }, { key: 'email', label: 'Email (login)', type: 'email', required: true },
      { key: 'password', label: 'Password', type: 'password', help: 'At least 8 characters. When editing, leave empty to keep.' },
      { key: 'role', label: 'Role', type: 'select', options: [{ value: 'staff', label: 'Staff – daily work only' }, { value: 'owner', label: 'Owner – everything incl. settings' }] },
    ]} />`;
}

function Account() {
  const [f, setF] = useState({ current: '', password: '' });
  return html`<${Card} title="Change your password"><div class="form-grid">
    <${Field} f=${{ key: 'c', label: 'Current password', type: 'password', autocomplete: 'current-password' }} value=${f.current} onChange=${(v) => setF({ ...f, current: v })} />
    <${Field} f=${{ key: 'n', label: 'New password', type: 'password', autocomplete: 'new-password', help: 'At least 8 characters' }} value=${f.password} onChange=${(v) => setF({ ...f, password: v })} />
  </div><div style="margin-top:14px"><${AsyncButton} variant="primary" onClick=${() => act(() => api('/auth/password', { method: 'POST', body: f }), 'Password changed').then((r) => r && setF({ current: '', password: '' }))}>Change password<//></div><//>`;
}

export function Settings() {
  const { biz, reloadBiz, me } = useApp();
  const [tab, setTab] = useState(tabFromHash());
  const [v, setV] = useState({ ...structuredClone(biz), secrets: {} });
  const has = (m) => v.modules.includes(m);
  const links = useApi('/links');
  const canEdit = me.user.role !== 'staff';
  const save = async () => {
    const body = { ...v, settings: v.settings };
    const secrets = Object.fromEntries(Object.entries(v.secrets || {}).filter(([, x]) => x));
    if (await act(() => api('/business', { method: 'PUT', body: { ...body, secrets } }), 'Settings saved')) { reloadBiz(); setV((x) => ({ ...x, secrets: {} })); }
  };
  const saveBar = canEdit && html`<div class="row gap" style="margin-top:16px"><${AsyncButton} variant="primary" onClick=${save}>💾 Save changes<//><span class="muted small">Changes apply to the bot immediately.</span></div>`;
  const moduleToggle = (m, label, help) => html`<${Toggle} checked=${has(m)} label=${label} help=${help}
    onChange=${(on) => setV({ ...v, modules: on ? [...new Set([...v.modules, m])] : v.modules.filter((x) => x !== m) })} />`;

  return html`<${Page} title="Settings" subtitle=${canEdit ? 'Everything about how your bot behaves.' : 'Only the owner can change settings.'}>
    <${Tabs} active=${tab} onChange=${(t) => { setTab(t); history.replaceState(null, '', `#/settings?tab=${t}`); }} tabs=${[
      { key: 'business', label: 'Business' }, { key: 'hours', label: 'Opening hours' }, { key: 'features', label: 'Features' },
      has('ordering') && { key: 'ordering', label: 'Ordering & payments' }, has('booking') && { key: 'booking', label: 'Appointments' },
      has('enquiry') && { key: 'enquiry', label: 'Enquiry form' }, { key: 'languages', label: 'Languages' }, { key: 'whatsapp', label: 'WhatsApp' },
      canEdit && { key: 'team', label: 'Team' }, { key: 'account', label: 'My account' },
    ]} />
    ${tab === 'business' && html`<${Card}><${FormFields} fields=${businessFields(biz.meta)} value=${v} onChange=${setV} />${saveBar}<//>`}
    ${tab === 'hours' && html`<${Card} title="When are you open?">
      <p class="muted">Used for appointment slots and to tell customers when you open. Outside these hours the bot keeps working.</p>
      <${HoursEditor} value=${v.settings.hours} onChange=${(h) => setV({ ...v, settings: { ...v.settings, hours: h } })} />
      <div style="margin-top:16px"><${Field} f=${{ key: 'cb', label: 'When closed, the bot should…', type: 'select', options: [{ value: 'note', label: 'Keep working, and mention when you open' }, { value: 'handoff', label: 'Only collect the message for your team (no menu)' }] }}
        value=${v.settings.closed_behavior} onChange=${(x) => setV({ ...v, settings: { ...v.settings, closed_behavior: x } })} /></div>
      ${saveBar}<//>`}
    ${tab === 'features' && html`<${Card} title="What should your bot do?"><div class="col">
      ${moduleToggle('ordering', '🛒 Ordering', 'Catalogue, cart, delivery/pickup, UPI / Razorpay / cash on delivery, order status updates.')}
      ${moduleToggle('booking', '📅 Appointments', 'Services, staff calendars, reminders, aftercare, check-ins, reviews, recalls.')}
      ${moduleToggle('enquiry', '❓ FAQs & enquiries', 'Instant answers and a lead form with your own questions.')}
      <${Field} f=${{ key: 'menu', label: 'Main menu style', type: 'select', options: [{ value: 'auto', label: 'Automatic (buttons if 3 or fewer options, else a list)' }, { value: 'list', label: 'Always a list' }, { value: 'buttons', label: 'Always buttons (max 3)' }] }}
        value=${v.settings.menu_style} onChange=${(x) => setV({ ...v, settings: { ...v.settings, menu_style: x } })} />
      <${Field} f=${{ key: 'hp', label: 'After "talk to a person", keep the bot quiet for (hours)', type: 'number', min: 1 }} value=${v.settings.handoff_pause_hours} onChange=${(x) => setV({ ...v, settings: { ...v.settings, handoff_pause_hours: x } })} />
      <${Toggle} checked=${v.settings.notify.owner_whatsapp} label="Send alerts to the owner's WhatsApp" onChange=${(x) => setV({ ...v, settings: { ...v.settings, notify: { ...v.settings.notify, owner_whatsapp: x } } })} />
      <${Toggle} checked=${v.settings.notify.staff_whatsapp} label="Send booking alerts to the staff member's WhatsApp" onChange=${(x) => setV({ ...v, settings: { ...v.settings, notify: { ...v.settings.notify, staff_whatsapp: x } } })} />
    </div>${saveBar}<//>`}
    ${tab === 'ordering' && html`<${Card}><${FormFields} fields=${orderingFields} value=${v} onChange=${setV} />
      ${v.settings.ordering.payment_modes?.includes('online') && links.data && html`<div style="margin-top:12px"><${Copy} label="Razorpay webhook URL" value=${links.data.razorpayWebhook} /></div>`}
      ${v.settings.ordering.payment_modes?.includes('stripe') && links.data && html`<div style="margin-top:12px"><${Copy} label="Stripe webhook URL" value=${links.data.stripeWebhook} /><p class="muted small">Stripe → Developers → Webhooks → Add endpoint with this URL, event <b>checkout.session.completed</b>.</p></div>`}${saveBar}<//>`}
    ${tab === 'booking' && html`<div>
      <${Card} title="Booking rules"><${FormFields} fields=${bookingFields} value=${v} onChange=${setV} /><//>
      <${Card} title="Reminders before the appointment"><${Reminders} value=${v.settings.booking.reminders} onChange=${(r) => setV({ ...v, settings: { ...v.settings, booking: { ...v.settings.booking, reminders: r } } })} /><//>
      <${Card} title="Questions asked before showing slots (triage)">
        <${QuestionsEditor} hint="e.g. 'Which tooth hurts?' with buttons Upper / Lower. Up to 3 buttons show as buttons, more as a list, none = customer types. Answers are shown to the doctor."
          value=${v.settings.booking.intake_questions} onChange=${(q) => setV({ ...v, settings: { ...v.settings, booking: { ...v.settings.booking, intake_questions: q } } })} />
      <//>${saveBar}</div>`}
    ${tab === 'enquiry' && html`<${Card} title="Enquiry form questions">
      <${QuestionsEditor} hint="Asked one by one when a customer taps 'Send enquiry'. Use the label 'name' to capture their name. Answers appear in Enquiries and are sent to you."
        value=${v.settings.enquiry.lead_questions} onChange=${(q) => setV({ ...v, settings: { ...v.settings, enquiry: { ...v.settings.enquiry, lead_questions: q } } })} />${saveBar}<//>`}
    ${tab === 'whatsapp' && html`<${WhatsAppTab} biz=${biz} reloadBiz=${reloadBiz} />`}
    ${tab === 'languages' && html`<${Card} title="Languages your customers can choose">
      <p class="muted">The bot's main language is set in <b>Business → Bot language</b>. Turn this on to let every customer pick their own language – the whole conversation, reminders and updates then use it. Edit any text per language in <a href="#/messages">Bot messages</a>. (The AI assistant always replies in the language the customer writes in.)</p>
      <div class="col">
        <${Toggle} checked=${v.settings.language_choice.enabled} label="Let customers choose their language" help='Adds "🌐 Language" to the menu; customers can also type "language".' onChange=${(x) => setV({ ...v, settings: { ...v.settings, language_choice: { ...v.settings.language_choice, enabled: x } } })} />
        <${Field} f=${{ key: 'langs', label: 'Languages offered', type: 'checks', options: Object.entries(biz.meta.languages).map(([value, label]) => ({ value, label })) }}
          value=${v.settings.language_choice.languages} onChange=${(x) => setV({ ...v, settings: { ...v.settings, language_choice: { ...v.settings.language_choice, languages: x } } })} />
        <${Toggle} checked=${v.settings.language_choice.ask_first} label="Ask new customers to choose a language on their first message" onChange=${(x) => setV({ ...v, settings: { ...v.settings, language_choice: { ...v.settings.language_choice, ask_first: x } } })} />
      </div>${saveBar}<//>`}
    ${tab === 'team' && html`<${Team} />`}
    ${tab === 'account' && html`<${Account} />`}
  <//>`;
}
