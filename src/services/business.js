// Business (tenant) loading, settings defaults and secrets handling.
import { get, all, run, update, parseJson, now } from '../db/index.js';
import { decrypt } from '../lib/crypto.js';
import { deepMerge } from '../lib/util.js';
import { config } from '../config.js';

const weekday = [['09:00', '21:00']];

/** Every setting a business can have, with safe defaults. Dashboard edits are merged on top. */
export const DEFAULT_SETTINGS = {
  hours: { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: weekday, sun: [] },
  closed_behavior: 'note',           // note = bot works + tells when you open | handoff = only collect message
  handoff_pause_hours: 12,           // bot stays quiet this long after "talk to a person"
  menu_style: 'auto',                // auto | buttons | list
  show_menu_after_answer: true,
  welcome_image_url: '',
  custom_menu_position: 'bottom',    // where owner-made buttons appear in the main menu: top | bottom             // optional image/logo sent with the first welcome of the day
  language_choice: {                 // let customers pick their language (menu item + "language" keyword)
    enabled: false,
    languages: ['en', 'hi', 'gu'],
    ask_first: true,                 // ask new customers to pick a language on their first "Hi"
  },
  notify: {
    owner_whatsapp: true,            // WhatsApp alert to owner_phone on new order/booking/lead/handoff
    staff_whatsapp: true,            // booking alert to the assigned staff member's phone
  },
  ordering: {
    delivery: true,
    pickup: false,
    delivery_fee: 2000,              // minor units
    free_delivery_above: 30000,
    min_order: 0,
    payment_modes: ['cod', 'upi'],   // cod | upi | online (Razorpay) | stripe | link
    upi_id: '',
    upi_name: '',
    razorpay_key_id: '',
    razorpay_key_secret_enc: '',
    razorpay_webhook_secret_enc: '',
    stripe_secret_key_enc: '',       // Stripe Checkout (international cards, Apple/Google Pay)
    stripe_webhook_secret_enc: '',
    pay_link_template: '',           // any payment link, e.g. https://paypal.me/shop/{amount} (manual confirmation)
    eta_text: '30-45 minutes',
    ask_notes: false,
    cart_nudge_minutes: 60,          // remind about an unfinished cart (0 = off)
    show_images: false,              // send product photo before quantity question
    accept_prescriptions: false,     // pharmacy: photos during ordering are attached to the order
  },
  booking: {
    slot_interval: 30,               // minutes between slot start times
    days_ahead: 7,
    min_notice_min: 60,              // cannot book a slot starting sooner than this
    allow_staff_choice: true,
    ask_name: true,
    staff_label: 'Doctor',           // "Doctor", "Stylist", "Trainer"...
    intake_questions: [],            // [{ key, question, options: ["A","B","C"] | [] }]
    reminders: [
      { minutes_before: 1440, enabled: true },
      { minutes_before: 120, enabled: true },
    ],
    checkin_days: 3,                 // "how are you feeling" after visit (0 = off)
    review_request: true,            // ask for Google review only after positive check-in
    auto_complete_hours: 0,          // auto-mark visits COMPLETED N hours after end (0 = manual)
  },
  enquiry: {
    lead_questions: [
      { key: 'requirement', question: 'Please tell us what you are looking for.', options: [] },
    ],
  },
  ai: {
    enabled: false,
    order_parsing: true,             // "2 kilo aata aur 1 maggi" -> cart
    answer_questions: true,          // answers from business info, FAQs, catalogue, knowledge base
    use_knowledge: true,             // include the Knowledge base documents (RAG)
    remember_chat: true,             // use the last messages of the chat as context
    tone: 'friendly',                // friendly | formal | short
    assistant_name: '',              // e.g. "Riya from Pearl Dental"
    instructions: '',                // extra rules from the owner ("always mention free delivery above ₹300")
    handoff_when_unsure: true,       // offer "talk to us" when the AI cannot answer
  },
  integrations: {                    // send events to Google Sheets, n8n/Make/Zapier, HubSpot, Airtable
    events: ['lead.created', 'order.created', 'order.updated', 'appointment.booked', 'appointment.updated', 'handoff.requested', 'feedback.received', 'customer.created'],
    webhook: { enabled: false, url: '', secret_enc: '' },
    sheets: { enabled: false, url: '', token: '' },
    hubspot: { enabled: false, token_enc: '' },
    airtable: { enabled: false, token_enc: '', base_id: '', table: 'WhatsApp' },
  },
  // Approved Meta templates for business-initiated messages (outside the 24h window).
  templates: {
    owner_alert: { name: '', lang: 'en' },
    order_update: { name: '', lang: 'en' },
    appointment_reminder: { name: '', lang: 'en' },
    appointment_checkin: { name: '', lang: 'en' },
    appointment_recall: { name: '', lang: 'en' },
  },
};

export const MODULES = ['ordering', 'booking', 'enquiry'];

const cache = new Map();

function hydrate(row) {
  if (!row) return null;
  parseJson(row, ['modules', 'settings', 'texts']);
  row.settings = deepMerge(DEFAULT_SETTINGS, row.settings || {});
  row.texts = row.texts || {};
  row.modules = Array.isArray(row.modules) ? row.modules : [];
  row.has = (m) => row.modules.includes(m);
  return row;
}

export function getBusiness(id) {
  const key = `id:${id}`;
  if (cache.has(key)) return cache.get(key);
  const b = hydrate(get('SELECT * FROM businesses WHERE id = ?', id));
  if (b) cache.set(key, b);
  return b;
}

export function getBusinessByPhoneNumberId(phoneNumberId) {
  const row = get('SELECT id FROM businesses WHERE wa_phone_number_id = ? AND active = 1', String(phoneNumberId));
  return row ? getBusiness(row.id) : null;
}

export function getBusinessBySlug(slug) {
  const row = get('SELECT id FROM businesses WHERE slug = ?', slug);
  return row ? getBusiness(row.id) : null;
}

export function listBusinesses() {
  return all('SELECT * FROM businesses ORDER BY id').map(hydrate);
}

export function invalidateBusiness(id) {
  cache.delete(`id:${id}`);
}

export function saveBusiness(id, patch) {
  const p = { ...patch };
  for (const k of ['modules', 'settings', 'texts']) if (p[k] !== undefined) p[k] = JSON.stringify(p[k]);
  p.updated_at = now();
  update('businesses', id, p);
  invalidateBusiness(id);
  return getBusiness(id);
}

/** Store only the differences from defaults would be nicer, but full JSON keeps it transparent. */
export function saveSettings(id, settings) {
  return saveBusiness(id, { settings });
}

/** Decrypted WhatsApp credentials for API calls. */
export function waCredentials(biz) {
  return {
    token: decrypt(biz.wa_token_enc),
    phoneNumberId: biz.wa_phone_number_id,
    wabaId: biz.wa_waba_id,
    appSecret: decrypt(biz.wa_app_secret_enc) || config.metaAppSecret,
  };
}

export const isConnected = (biz) => Boolean(biz.wa_phone_number_id && biz.wa_token_enc);

export function waLink(biz, text = 'Hi') {
  const phone = String(biz.wa_display_phone || biz.contact_phone || '').replace(/\D/g, '');
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : '';
}

export function touchBusiness(id) {
  run('UPDATE businesses SET updated_at = ? WHERE id = ?', now(), id);
}
