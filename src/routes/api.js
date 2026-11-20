// Dashboard REST API. Everything here is scoped to req.biz (the logged-in business).
import express from 'express';
import QRCode from 'qrcode';
import { all, get, run, insert, update, tx, parseJson, now } from '../db/index.js';
import { config } from '../config.js';
import { encrypt, mask, verifyPassword, decrypt } from '../lib/crypto.js';
import { HttpError, normalizePhone, parseCsv, toCsv, deepMerge, toMinor } from '../lib/util.js';
import { zonedToUtc, todayIn, addDays, tzParts } from '../lib/time.js';
import { auth, business, role, audit, setSessionCookie, clearSessionCookie, rateLimit } from './middleware.js';
import { getBusiness, saveBusiness, isConnected, waLink, MODULES, DEFAULT_SETTINGS } from '../services/business.js';
import { createUser, setPassword, applyPreset, createBusiness } from '../services/setup.js';
import { presetList, clearSampleData, loadSampleData } from '../presets/index.js';
import { DEFAULT_TEXTS, TEXT_GROUPS, LANGUAGES, text } from '../engine/texts.js';
import { TEMPLATE_SLOTS, templateDefinition } from '../services/templates.js';
import { getOrder, setOrderStatus, markPaidManually, ORDER_STATUSES } from '../services/orders.js';
import {
  getAppointment, book, slotsFor, getService, cancelAppointment, rescheduleAppointment, completeAppointment, setApptStatus,
  alertNewBooking, SlotTakenError, APPT_STATUSES, apptVars,
} from '../services/appointments.js';
import { schedule, runDueJobs } from '../services/jobs.js';
import { broadcastAudience } from '../services/broadcasts.js';
import * as KB from '../services/knowledge.js';
import * as INT from '../services/integrations.js';
import { aiAvailable, tryQuestion, engineFor, PROVIDERS } from '../services/ai.js';
import { ensureCustomer } from '../services/customers.js';
import { resumeBot, pauseBot } from '../engine/session.js';
import { handleIncoming } from '../engine/index.js';
import * as B from '../whatsapp/builders.js';
import { send, clientFor, windowOpen } from '../whatsapp/sender.js';

const r = express.Router();
const ok = (res, data = {}) => res.json({ ok: true, ...data });
const int = (v) => (v === '' || v === null || v === undefined ? null : Math.round(Number(v)));
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

// ======================= AUTH =======================
r.post('/auth/login', rateLimit('login', 10, 10 * 60_000), (req, res) => {
  const { email, password } = req.body || {};
  const user = get('SELECT * FROM users WHERE email = ?', String(email || '').trim());
  if (!user || !user.active || !verifyPassword(password || '', user.password_hash)) throw new HttpError(401, 'Wrong email or password');
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id);
  setSessionCookie(res, user);
  ok(res);
});

r.post('/auth/logout', (_req, res) => { clearSessionCookie(res); ok(res); });

r.use(auth);

r.get('/me', (req, res) => {
  const u = req.user;
  const businesses = u.role === 'superadmin'
    ? all('SELECT id, name, slug, preset, active, setup_done FROM businesses ORDER BY name')
    : all('SELECT id, name, slug, preset, active, setup_done FROM businesses WHERE id = ?', u.business_id);
  ok(res, { user: u, businesses });
});

r.post('/auth/password', (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(req.body.current || '', user.password_hash)) throw new HttpError(400, 'Current password is wrong');
  setPassword(user.id, req.body.password);
  ok(res);
});

// ======================= AGENCY ADMIN (super-admin) =======================
const admin = express.Router();
admin.use(role('superadmin'));

admin.get('/businesses', (_req, res) => {
  const rows = all(`SELECT b.id, b.name, b.slug, b.preset, b.modules, b.active, b.setup_done, b.wa_display_phone, b.created_at,
      (SELECT COUNT(*) FROM customers c WHERE c.business_id = b.id) AS customers,
      (SELECT COUNT(*) FROM orders o WHERE o.business_id = b.id) AS orders,
      (SELECT COUNT(*) FROM appointments a WHERE a.business_id = b.id) AS appointments,
      (SELECT COUNT(*) FROM messages m WHERE m.business_id = b.id AND m.created_at > ?) AS messages_30d,
      (SELECT COUNT(*) FROM users u WHERE u.business_id = b.id) AS users,
      b.wa_phone_number_id IS NOT NULL AND b.wa_token_enc IS NOT NULL AS connected
    FROM businesses b ORDER BY b.id DESC`, new Date(Date.now() - 30 * 86400_000).toISOString());
  ok(res, { businesses: rows.map((b) => parseJson(b, ['modules'])), presets: presetList() });
});

admin.post('/businesses', (req, res) => {
  const b = req.body || {};
  const biz = tx(() => {
    const created = createBusiness({ name: b.name, preset: b.preset, sampleData: b.sampleData !== false, owner_phone: normalizePhone(b.owner_phone) || null, language: b.language, timezone: b.timezone });
    if (b.owner_email) createUser({ email: b.owner_email, password: b.owner_password, name: b.owner_name || '', role: 'owner', businessId: created.id });
    return created;
  });
  audit(req, 'business.create', { id: biz.id, name: biz.name });
  ok(res, { id: biz.id });
});

admin.put('/businesses/:id', (req, res) => {
  const id = Number(req.params.id);
  if (req.body.active !== undefined) saveBusiness(id, { active: bool(req.body.active) });
  ok(res);
});

admin.delete('/businesses/:id', (req, res) => {
  const id = Number(req.params.id);
  const biz = getBusiness(id);
  if (!biz) throw new HttpError(404, 'Not found');
  if (req.body?.confirm !== biz.slug) throw new HttpError(400, `Type "${biz.slug}" to confirm deletion`);
  run('DELETE FROM businesses WHERE id = ?', id);
  audit(req, 'business.delete', { id, name: biz.name });
  ok(res);
});

r.use('/admin', admin);

// Everything below needs a selected business
r.use(business);

// ======================= BUSINESS & SETTINGS =======================
// Secret name (as sent by the dashboard in body.secrets) -> encrypted settings path
const SECRET_SETTINGS = {
  razorpay_key_secret: 'ordering.razorpay_key_secret_enc',
  razorpay_webhook_secret: 'ordering.razorpay_webhook_secret_enc',
  stripe_secret_key: 'ordering.stripe_secret_key_enc',
  stripe_webhook_secret: 'ordering.stripe_webhook_secret_enc',
  webhook_secret: 'integrations.webhook.secret_enc',
  hubspot_token: 'integrations.hubspot.token_enc',
  airtable_token: 'integrations.airtable.token_enc',
  anthropic_key: 'ai.anthropic_key_enc',
  openai_key: 'ai.openai_key_enc',
  gemini_key: 'ai.gemini_key_enc',
};
const parentOf = (obj, path, create = false) => {
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) { if (!cur[k] || typeof cur[k] !== 'object') { if (!create) return null; cur[k] = {}; } cur = cur[k]; }
  return [cur, keys.at(-1)];
};

function publicBusiness(biz) {
  const settings = structuredClone(biz.settings);
  for (const path of Object.values(SECRET_SETTINGS)) {
    const pr = parentOf(settings, path);
    if (pr) { const [o, k] = pr; o[k.replace('_enc', '_set')] = Boolean(o[k]); delete o[k]; }
  }
  return {
    id: biz.id, slug: biz.slug, name: biz.name, preset: biz.preset, modules: biz.modules, language: biz.language, timezone: biz.timezone,
    currency: biz.currency, owner_phone: biz.owner_phone, owner_email: biz.owner_email, contact_phone: biz.contact_phone, address: biz.address,
    map_link: biz.map_link, review_link: biz.review_link, website: biz.website, about: biz.about, setup_done: biz.setup_done, active: biz.active,
    whatsapp: {
      connected: isConnected(biz), phone_number_id: biz.wa_phone_number_id, waba_id: biz.wa_waba_id, display_phone: biz.wa_display_phone,
      token: mask(decrypt(biz.wa_token_enc)), app_secret: mask(decrypt(biz.wa_app_secret_enc)), global_app_secret: Boolean(config.metaAppSecret),
    },
    settings,
  };
}

r.get('/business', (req, res) => ok(res, {
  business: publicBusiness(req.biz), presets: presetList(), languages: LANGUAGES, modules: MODULES, defaults: DEFAULT_SETTINGS,
  timezones: Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [req.biz.timezone],
}));

const BIZ_FIELDS = ['name', 'language', 'timezone', 'currency', 'contact_phone', 'owner_email', 'address', 'map_link', 'review_link', 'website', 'about'];

r.put('/business', role('owner', 'superadmin'), (req, res) => {
  const b = req.body || {};
  const patch = {};
  for (const f of BIZ_FIELDS) if (b[f] !== undefined) patch[f] = b[f] === '' ? null : String(b[f]).trim();
  if (patch.name === null) throw new HttpError(400, 'Business name cannot be empty');
  if (b.owner_phone !== undefined) patch.owner_phone = normalizePhone(b.owner_phone) || null;
  if (b.setup_done !== undefined) patch.setup_done = bool(b.setup_done);
  if (b.language && !DEFAULT_TEXTS[b.language]) throw new HttpError(400, 'Unknown language');
  if (b.modules) patch.modules = b.modules.filter((m) => MODULES.includes(m));
  if (b.settings) {
    const raw = JSON.parse(get('SELECT settings FROM businesses WHERE id = ?', req.biz.id).settings || '{}');
    const incoming = structuredClone(b.settings);
    for (const path of Object.values(SECRET_SETTINGS)) {
      const pr = parentOf(incoming, path);
      if (pr) { const [o, k] = pr; delete o[k]; delete o[k.replace('_enc', '_set')]; }
    }
    const merged = deepMerge(raw, incoming);
    for (const [name, path] of Object.entries(SECRET_SETTINGS)) {
      const plain = b.secrets?.[name];
      if (plain === undefined) continue;
      const [o, k] = parentOf(merged, path, true);
      o[k] = plain ? encrypt(String(plain).trim()) : '';
    }
    patch.settings = merged;
  }
  const biz = saveBusiness(req.biz.id, patch);
  audit(req, 'business.update', { fields: Object.keys(patch) });
  ok(res, { business: publicBusiness(biz) });
});

r.post('/business/preset', role('owner', 'superadmin'), (req, res) => {
  if (req.body.replaceData) clearSampleData(req.biz.id);
  const biz = applyPreset(req.biz.id, req.body.preset, req.body.sampleData);
  ok(res, { business: publicBusiness(biz) });
});

r.post('/business/sample-data', role('owner', 'superadmin'), (req, res) => {
  if (req.body.action === 'clear') clearSampleData(req.biz.id);
  else loadSampleData(req.biz.id, req.biz.preset);
  ok(res);
});

r.put('/business/whatsapp', role('owner', 'superadmin'), (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.phone_number_id !== undefined) {
    const pnid = String(b.phone_number_id).replace(/\D/g, '') || null;
    if (pnid && get('SELECT 1 FROM businesses WHERE wa_phone_number_id = ? AND id != ?', pnid, req.biz.id)) throw new HttpError(409, 'This Phone Number ID is already used by another business');
    patch.wa_phone_number_id = pnid;
  }
  if (b.waba_id !== undefined) patch.wa_waba_id = String(b.waba_id).replace(/\D/g, '') || null;
  if (b.display_phone !== undefined) patch.wa_display_phone = normalizePhone(b.display_phone) || null;
  if (b.token) patch.wa_token_enc = encrypt(String(b.token).trim());
  if (b.app_secret !== undefined && b.app_secret !== '') patch.wa_app_secret_enc = encrypt(String(b.app_secret).trim());
  if (b.clear_token) patch.wa_token_enc = null;
  saveBusiness(req.biz.id, patch);
  audit(req, 'whatsapp.update', { fields: Object.keys(patch) });
  ok(res, { business: publicBusiness(getBusiness(req.biz.id)) });
});

r.post('/business/whatsapp/test', role('owner', 'superadmin'), async (req, res) => {
  if (!isConnected(req.biz)) throw new HttpError(400, 'Enter the Phone Number ID and Access Token first');
  try {
    const info = await clientFor(req.biz).phoneInfo();
    const display = normalizePhone(info.display_phone_number);
    if (display) saveBusiness(req.biz.id, { wa_display_phone: display });
    ok(res, { info });
  } catch (e) {
    throw new HttpError(400, `Meta says: ${e.message}`);
  }
});

r.post('/business/whatsapp/subscribe', role('owner', 'superadmin'), async (req, res) => {
  if (!req.biz.wa_waba_id) throw new HttpError(400, 'Enter the WhatsApp Business Account ID first');
  try { ok(res, { result: await clientFor(req.biz).subscribeApp() }); } catch (e) { throw new HttpError(400, `Meta says: ${e.message}`); }
});

r.post('/business/whatsapp/test-message', role('owner', 'superadmin'), async (req, res) => {
  const to = normalizePhone(req.body.to || req.biz.owner_phone);
  if (!to) throw new HttpError(400, 'Enter a phone number');
  const result = await send(req.biz, to, B.text(`✅ Test message from ${req.biz.name}'s WhatsApp assistant.`), { sentBy: req.user.name || 'dashboard' });
  if (!result.ok) throw new HttpError(400, result.error);
  ok(res, result);
});

r.get('/links', (req, res) => {
  const link = waLink(req.biz, 'Hi');
  ok(res, {
    webhookUrl: `${config.publicUrl}/webhook`, verifyToken: config.verifyToken, publicUrl: config.publicUrl,
    waLink: link, shortLink: `${config.publicUrl}/q/${req.biz.slug}`, qrPng: link ? `${config.publicUrl}/q/${req.biz.slug}/qr.png` : '',
    razorpayWebhook: `${config.publicUrl}/webhooks/razorpay/${req.biz.id}`, stripeWebhook: `${config.publicUrl}/webhooks/stripe/${req.biz.id}`, graphVersion: config.graphVersion,
    aiAvailable: aiAvailable(req.biz),
  });
});

r.get('/qr', async (req, res) => {
  const link = waLink(req.biz, req.query.text || 'Hi');
  if (!link) throw new HttpError(400, 'Add the WhatsApp number first');
  ok(res, { dataUrl: await QRCode.toDataURL(link, { width: 480, margin: 2 }), link });
});

// ======================= OVERVIEW / PULSE =======================
function dayRange(biz, ymd) {
  return [zonedToUtc(ymd, '00:00', biz.timezone).toISOString(), zonedToUtc(addDays(ymd, 1), '00:00', biz.timezone).toISOString()];
}

r.get('/stats', (req, res) => {
  const b = req.biz;
  const today = todayIn(b.timezone);
  const [s, e] = dayRange(b, today);
  const real = `phone NOT LIKE 'sim%'`;
  const one = (sql, ...p) => Object.values(get(sql, ...p))[0] || 0;
  const series = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const [ds, de] = dayRange(b, d);
    series.push({
      date: d,
      orders: one(`SELECT COUNT(*) FROM orders WHERE business_id = ? AND ${real} AND status != 'CANCELLED' AND created_at >= ? AND created_at < ?`, b.id, ds, de),
      revenue: one(`SELECT COALESCE(SUM(total),0) FROM orders WHERE business_id = ? AND ${real} AND status != 'CANCELLED' AND status != 'NEW' AND created_at >= ? AND created_at < ?`, b.id, ds, de),
      appointments: one(`SELECT COUNT(*) FROM appointments WHERE business_id = ? AND ${real} AND status != 'CANCELLED' AND start_at >= ? AND start_at < ?`, b.id, ds, de),
      chats: one(`SELECT COUNT(DISTINCT phone) FROM messages WHERE business_id = ? AND ${real} AND direction = 'in' AND created_at >= ? AND created_at < ?`, b.id, ds, de),
    });
  }
  ok(res, {
    today: {
      orders: series[6].orders, revenue: series[6].revenue, appointments: series[6].appointments, chats: series[6].chats,
      pendingOrders: one(`SELECT COUNT(*) FROM orders WHERE business_id = ? AND ${real} AND status IN ('NEW','CONFIRMED','PREPARING','READY','OUT_FOR_DELIVERY')`, b.id),
      unpaidUpi: one(`SELECT COUNT(*) FROM orders WHERE business_id = ? AND ${real} AND status = 'NEW'`, b.id),
      upcomingAppointments: one(`SELECT COUNT(*) FROM appointments WHERE business_id = ? AND ${real} AND status IN ('BOOKED','CONFIRMED') AND start_at >= ?`, b.id, now()),
      needsReply: one(`SELECT COUNT(*) FROM sessions WHERE business_id = ? AND ${real} AND needs_attention = 1`, b.id),
      newLeads: one(`SELECT COUNT(*) FROM leads WHERE business_id = ? AND ${real} AND status = 'NEW'`, b.id),
      customers: one(`SELECT COUNT(*) FROM customers WHERE business_id = ? AND ${real}`, b.id),
      newCustomers7d: one(`SELECT COUNT(*) FROM customers WHERE business_id = ? AND ${real} AND created_at >= ?`, b.id, new Date(Date.now() - 7 * 86400_000).toISOString()),
      failedMessages24h: one(`SELECT COUNT(*) FROM messages WHERE business_id = ? AND ${real} AND status IN ('failed','skipped') AND created_at >= ?`, b.id, new Date(Date.now() - 86400_000).toISOString()),
      noShows30d: one(`SELECT COUNT(*) FROM appointments WHERE business_id = ? AND ${real} AND status = 'NO_SHOW' AND start_at >= ?`, b.id, new Date(Date.now() - 30 * 86400_000).toISOString()),
      completed30d: one(`SELECT COUNT(*) FROM appointments WHERE business_id = ? AND ${real} AND status = 'COMPLETED' AND start_at >= ?`, b.id, new Date(Date.now() - 30 * 86400_000).toISOString()),
      dayStart: s, dayEnd: e,
    },
    series,
    checklist: {
      details: Boolean(b.name && b.address && b.owner_phone),
      whatsapp: isConnected(b),
      catalogue: b.has('ordering') ? Boolean(get('SELECT 1 FROM products WHERE business_id = ? LIMIT 1', b.id)) : null,
      services: b.has('booking') ? Boolean(get('SELECT 1 FROM services WHERE business_id = ? LIMIT 1', b.id)) : null,
      faqs: Boolean(get('SELECT 1 FROM faqs WHERE business_id = ? LIMIT 1', b.id)),
      tested: Boolean(get(`SELECT 1 FROM messages WHERE business_id = ? AND phone LIKE 'sim%' LIMIT 1`, b.id)),
      templates: Object.values(b.settings.templates || {}).some((t) => t.name),
      knowledge: aiAvailable(b) ? Boolean(get('SELECT 1 FROM kb_sources WHERE business_id = ? LIMIT 1', b.id) && b.settings.ai.enabled) : null,
      menu: Boolean(get('SELECT 1 FROM quick_replies WHERE business_id = ? LIMIT 1', b.id)),
      live: Boolean(get(`SELECT 1 FROM messages WHERE business_id = ? AND direction = 'in' AND phone NOT LIKE 'sim%' LIMIT 1`, b.id)),
    },
  });
});

r.get('/pulse', (req, res) => ok(res, {
  lastOrder: get('SELECT MAX(id) AS id FROM orders WHERE business_id = ?', req.biz.id).id || 0,
  lastAppointment: get('SELECT MAX(id) AS id FROM appointments WHERE business_id = ?', req.biz.id).id || 0,
  lastLead: get('SELECT MAX(id) AS id FROM leads WHERE business_id = ?', req.biz.id).id || 0,
  needsReply: get(`SELECT COUNT(*) AS n FROM sessions WHERE business_id = ? AND needs_attention = 1 AND phone NOT LIKE 'sim%'`, req.biz.id).n,
}));

// ======================= GENERIC CRUD (catalogue, services, staff, FAQs, time off) =======================
function crud(path, table, fields, { orderBy = 'sort, id', json = [], beforeSave } = {}) {
  const clean = (body) => {
    const out = {};
    for (const [k, type] of Object.entries(fields)) {
      if (body[k] === undefined) continue;
      const v = body[k];
      out[k] = type === 'num' ? (v === '' || v === null ? null : Number(v)) : type === 'int' ? int(v) : type === 'bool' ? bool(v) : type === 'json' ? JSON.stringify(v ?? null) : v === null ? null : String(v).trim();
    }
    return out;
  };
  r.get(`/${path}`, (req, res) => ok(res, { items: all(`SELECT * FROM ${table} WHERE business_id = ? ORDER BY ${orderBy}`, req.biz.id).map((x) => parseJson(x, json)) }));
  r.post(`/${path}`, (req, res) => {
    const data = clean(req.body || {});
    beforeSave?.(data, req, true);
    const id = insert(table, { ...data, business_id: req.biz.id });
    ok(res, { item: parseJson(get(`SELECT * FROM ${table} WHERE id = ?`, id), json) });
  });
  r.put(`/${path}/:id`, (req, res) => {
    const data = clean(req.body || {});
    beforeSave?.(data, req, false);
    if (!update(table, Number(req.params.id), data, req.biz.id) && Object.keys(data).length) throw new HttpError(404, 'Not found');
    ok(res, { item: parseJson(get(`SELECT * FROM ${table} WHERE id = ? AND business_id = ?`, Number(req.params.id), req.biz.id), json) });
  });
  r.delete(`/${path}/:id`, (req, res) => {
    run(`DELETE FROM ${table} WHERE id = ? AND business_id = ?`, Number(req.params.id), req.biz.id);
    ok(res);
  });
}

const required = (...keys) => (data, _req, isNew) => {
  for (const k of keys) if ((isNew && !data[k] && data[k] !== 0) || (data[k] !== undefined && (data[k] === '' || data[k] === null))) throw new HttpError(400, `${k.replace(/_/g, ' ')} is required`);
};

crud('products', 'products', { name: 'text', description: 'text', category: 'text', unit: 'text', price: 'int', image_url: 'text', sku: 'text', in_stock: 'bool', active: 'bool', sort: 'int' },
  { orderBy: 'category, sort, name', beforeSave: (d, q, n) => { required('name', 'price')(d, q, n); if (n && !d.category) d.category = 'General'; } });
crud('services', 'services', { name: 'text', description: 'text', category: 'text', duration_min: 'int', price: 'int', recall_days: 'int', aftercare: 'text', active: 'bool', sort: 'int' },
  { beforeSave: required('name', 'duration_min') });
crud('staff', 'staff', { name: 'text', title: 'text', phone: 'text', service_ids: 'json', hours: 'json', active: 'bool', sort: 'int' },
  { json: ['service_ids', 'hours'], beforeSave: (d, q, n) => { required('name')(d, q, n); if (d.phone) d.phone = normalizePhone(d.phone); } });
crud('faqs', 'faqs', { question: 'text', answer: 'text', keywords: 'text', active: 'bool', sort: 'int' }, { beforeSave: required('question', 'answer') });
const QR_TYPES = ['text', 'link', 'image', 'document', 'location', 'flow'];
crud('quick-replies', 'quick_replies', {
  title: 'text', description: 'text', keywords: 'text', reply_type: 'text', body: 'text', url: 'text', button_label: 'text',
  latitude: 'num', longitude: 'num', flow_target: 'text', show_in_menu: 'bool', active: 'bool', sort: 'int',
}, { beforeSave: (d, q, n) => {
  required('title')(d, q, n);
  if (d.reply_type !== undefined && !QR_TYPES.includes(d.reply_type)) throw new HttpError(400, 'Unknown reply type');
  if (['link', 'image', 'document'].includes(d.reply_type) && d.url && !/^https:\/\//.test(d.url)) throw new HttpError(400, 'Links must start with https://');
  if (d.reply_type === 'location' && (d.latitude == null || d.longitude == null)) throw new HttpError(400, 'Location needs latitude and longitude');
} });
crud('time-off', 'time_off', { staff_id: 'int', date_from: 'text', date_to: 'text', reason: 'text' }, { orderBy: 'date_from DESC', beforeSave: required('date_from', 'date_to') });

// Catalogue CSV import / export
r.post('/products/import', (req, res) => {
  const rows = parseCsv(req.body.csv);
  if (!rows.length) throw new HttpError(400, 'CSV is empty. First row must be headers: name,price,category,unit,description,in_stock,image_url,sku');
  const errors = [];
  let created = 0, updated = 0;
  tx(() => {
    if (req.body.replace) run('DELETE FROM products WHERE business_id = ?', req.biz.id);
    rows.forEach((row, i) => {
      if (!row.name || !row.price) { errors.push(`Row ${i + 2}: name and price are required`); return; }
      const data = {
        name: row.name, price: toMinor(row.price), category: row.category || 'General', unit: row.unit || 'pc', description: row.description || null,
        image_url: row.image_url || null, sku: row.sku || null, in_stock: row.in_stock ? bool(['yes', 'y', '1', 'true'].includes(row.in_stock.toLowerCase())) : 1,
      };
      const existing = get('SELECT id FROM products WHERE business_id = ? AND (name = ? OR (sku IS NOT NULL AND sku = ?))', req.biz.id, data.name, data.sku || '');
      if (existing) { update('products', existing.id, data); updated++; } else { insert('products', { ...data, business_id: req.biz.id, sort: i }); created++; }
    });
  });
  ok(res, { created, updated, errors });
});

r.get('/products/export.csv', (req, res) => {
  const rows = all('SELECT * FROM products WHERE business_id = ? ORDER BY category, sort, name', req.biz.id).map((p) => ({ ...p, price: (p.price / 100).toFixed(2), in_stock: p.in_stock ? 'yes' : 'no' }));
  res.type('text/csv').attachment('products.csv').send(toCsv(rows, ['name', 'price', 'category', 'unit', 'description', 'in_stock', 'image_url', 'sku']));
});

// ======================= ORDERS =======================
r.get('/orders', (req, res) => {
  const { status, q, from, to, test } = req.query;
  let sql = 'SELECT * FROM orders WHERE business_id = ?';
  const p = [req.biz.id];
  if (status === 'active') sql += ` AND status IN ('NEW','CONFIRMED','PREPARING','READY','OUT_FOR_DELIVERY')`;
  else if (status) { sql += ' AND status = ?'; p.push(status); }
  if (q) { sql += ' AND (phone LIKE ? OR customer_name LIKE ? OR CAST(order_no AS TEXT) = ?)'; p.push(`%${q}%`, `%${q}%`, String(q).replace('#', '')); }
  if (from) { sql += ' AND created_at >= ?'; p.push(from); }
  if (to) { sql += ' AND created_at < ?'; p.push(to); }
  if (test !== '1') sql += ` AND phone NOT LIKE 'sim%'`;
  sql += ' ORDER BY id DESC LIMIT 200';
  ok(res, { orders: all(sql, ...p).map((o) => parseJson(o, ['items'])), statuses: ORDER_STATUSES });
});

r.get('/orders/:id', (req, res) => {
  const o = getOrder(req.biz.id, req.params.id);
  if (!o) throw new HttpError(404, 'Order not found');
  ok(res, { order: o });
});

r.post('/orders/:id/status', async (req, res) => {
  const o = await setOrderStatus(req.biz, req.params.id, req.body.status, { reason: req.body.reason });
  audit(req, 'order.status', { id: o.id, status: o.status });
  ok(res, { order: o });
});

r.post('/orders/:id/paid', async (req, res) => {
  await markPaidManually(req.biz, req.params.id);
  audit(req, 'order.paid', { id: Number(req.params.id) });
  ok(res, { order: getOrder(req.biz.id, req.params.id) });
});

r.get('/orders-export.csv', (req, res) => {
  const rows = all(`SELECT * FROM orders WHERE business_id = ? AND phone NOT LIKE 'sim%' ORDER BY id DESC`, req.biz.id).map((o) => {
    parseJson(o, ['items']);
    return { ...o, items: o.items.map((l) => `${l.name} x${l.qty}`).join('; '), subtotal: o.subtotal / 100, delivery_fee: o.delivery_fee / 100, total: o.total / 100 };
  });
  res.type('text/csv').attachment('orders.csv').send(toCsv(rows, ['order_no', 'created_at', 'customer_name', 'phone', 'items', 'subtotal', 'delivery_fee', 'total', 'fulfilment', 'address', 'payment_mode', 'payment_status', 'status', 'notes']));
});

// ======================= APPOINTMENTS =======================
r.get('/appointments', (req, res) => {
  const b = req.biz;
  const from = req.query.date || todayIn(b.timezone);
  const days = Math.min(31, Number(req.query.days) || 1);
  const [s] = dayRange(b, from);
  const [, e] = dayRange(b, addDays(from, days - 1));
  let sql = `SELECT a.*, s.name AS service_name, st.name AS staff_name FROM appointments a LEFT JOIN services s ON s.id = a.service_id
    LEFT JOIN staff st ON st.id = a.staff_id WHERE a.business_id = ? AND a.start_at >= ? AND a.start_at < ?`;
  const p = [b.id, s, e];
  if (req.query.staff_id) { sql += ' AND a.staff_id = ?'; p.push(Number(req.query.staff_id)); }
  if (req.query.test !== '1') sql += ` AND a.phone NOT LIKE 'sim%'`;
  if (req.query.status) { sql += ' AND a.status = ?'; p.push(req.query.status); }
  sql += ' ORDER BY a.start_at';
  ok(res, { appointments: all(sql, ...p).map((a) => parseJson(a, ['intake'])), statuses: APPT_STATUSES, date: from });
});

r.get('/slots', (req, res) => {
  const service = getService(req.biz.id, req.query.service_id);
  if (!service) throw new HttpError(400, 'Choose a service');
  const slots = slotsFor(req.biz, service, req.query.date || todayIn(req.biz.timezone), req.query.staff_id ? Number(req.query.staff_id) : null, { excludeId: Number(req.query.exclude) || 0 });
  ok(res, { slots: slots.map((s) => ({ ...s, label: tzParts(s.start, req.biz.timezone).hm })) });
});

r.post('/appointments', async (req, res) => {
  const b = req.body || {};
  const phone = normalizePhone(b.phone);
  if (!phone) throw new HttpError(400, 'Phone number is required');
  try {
    const appt = book(req.biz, { phone, name: b.name, serviceId: b.service_id, staffId: b.staff_id || null, start: b.start, notes: b.notes, source: 'dashboard' });
    if (b.notify !== false) await send(req.biz, phone, B.text(text(req.biz, 'booked', apptVars(req.biz, appt))));
    await alertNewBooking(req.biz, appt);
    audit(req, 'appointment.create', { id: appt.id });
    ok(res, { appointment: appt });
  } catch (e) {
    if (e instanceof SlotTakenError) throw new HttpError(409, 'That time is already booked. Pick another slot.');
    throw e;
  }
});

r.post('/appointments/:id/status', async (req, res) => {
  const { status, note, reason } = req.body || {};
  let appt;
  if (status === 'COMPLETED') appt = await completeAppointment(req.biz, req.params.id, { note });
  else if (status === 'CANCELLED') { await cancelAppointment(req.biz, req.params.id, { by: 'business', reason }); appt = getAppointment(req.biz.id, req.params.id); }
  else appt = setApptStatus(req.biz, req.params.id, status);
  audit(req, 'appointment.status', { id: Number(req.params.id), status });
  ok(res, { appointment: appt });
});

r.post('/appointments/:id/reschedule', async (req, res) => {
  try {
    const appt = await rescheduleAppointment(req.biz, req.params.id, req.body.start, { staffId: req.body.staff_id === undefined ? undefined : (req.body.staff_id || null), by: 'business' });
    ok(res, { appointment: appt });
  } catch (e) {
    if (e instanceof SlotTakenError) throw new HttpError(409, 'That time is already booked.');
    throw e;
  }
});

r.get('/appointments-export.csv', (req, res) => {
  const rows = all(`SELECT a.*, s.name AS service, st.name AS staff FROM appointments a LEFT JOIN services s ON s.id = a.service_id LEFT JOIN staff st ON st.id = a.staff_id
    WHERE a.business_id = ? AND a.phone NOT LIKE 'sim%' ORDER BY a.start_at DESC`, req.biz.id)
    .map((a) => ({ ...a, date: tzParts(a.start_at, req.biz.timezone).ymd, time: tzParts(a.start_at, req.biz.timezone).hm }));
  res.type('text/csv').attachment('appointments.csv').send(toCsv(rows, ['id', 'date', 'time', 'customer_name', 'phone', 'service', 'staff', 'status', 'intake', 'notes', 'source']));
});

// ======================= CUSTOMERS =======================
r.get('/customers', (req, res) => {
  const { q, tag } = req.query;
  let sql = `SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders_count,
    (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id) AS visits_count FROM customers c WHERE c.business_id = ? AND c.phone NOT LIKE 'sim%'`;
  const p = [req.biz.id];
  if (q) { sql += ' AND (c.phone LIKE ? OR c.name LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
  if (tag) { sql += ' AND c.tags LIKE ?'; p.push(`%"${tag}"%`); }
  sql += ' ORDER BY COALESCE(c.last_inbound_at, c.created_at) DESC LIMIT 500';
  const tags = new Set();
  const rows = all(sql, ...p).map((c) => { parseJson(c, ['tags']); (c.tags || []).forEach((t) => tags.add(t)); return c; });
  ok(res, { customers: rows, tags: [...tags].sort() });
});

r.put('/customers/:id', (req, res) => {
  const b = req.body || {};
  const data = {};
  for (const k of ['name', 'address', 'notes']) if (b[k] !== undefined) data[k] = b[k] || null;
  if (b.tags) data.tags = JSON.stringify(b.tags.map((t) => String(t).trim()).filter(Boolean));
  if (b.opted_in !== undefined) data.opted_in = bool(b.opted_in);
  if (b.marketing_opt_in !== undefined) data.marketing_opt_in = bool(b.marketing_opt_in);
  update('customers', Number(req.params.id), data, req.biz.id);
  ok(res);
});

r.delete('/customers/:id', (req, res) => {
  // Data deletion on request (privacy laws): removes customer, chat history and session
  const c = get('SELECT * FROM customers WHERE id = ? AND business_id = ?', Number(req.params.id), req.biz.id);
  if (!c) throw new HttpError(404, 'Not found');
  tx(() => {
    run('DELETE FROM messages WHERE business_id = ? AND phone = ?', req.biz.id, c.phone);
    run('DELETE FROM sessions WHERE business_id = ? AND phone = ?', req.biz.id, c.phone);
    run('DELETE FROM leads WHERE business_id = ? AND phone = ?', req.biz.id, c.phone);
    run('UPDATE orders SET customer_name = NULL, address = NULL WHERE business_id = ? AND phone = ?', req.biz.id, c.phone);
    run('DELETE FROM customers WHERE id = ?', c.id);
  });
  audit(req, 'customer.delete', { phone: c.phone.slice(-4) });
  ok(res);
});

/** Import existing customers. Optional columns: tags (a|b), last_visit (YYYY-MM-DD), service (name) -> schedules recalls. */
r.post('/customers/import', (req, res) => {
  const rows = parseCsv(req.body.csv);
  if (!rows.length) throw new HttpError(400, 'CSV is empty. Headers: phone,name,tags,notes,last_visit,service,marketing_opt_in');
  let imported = 0, recalls = 0;
  const errors = [];
  const services = all('SELECT * FROM services WHERE business_id = ?', req.biz.id);
  tx(() => {
    rows.forEach((row, i) => {
      const phone = normalizePhone(row.phone);
      if (!phone || phone.length < 10) { errors.push(`Row ${i + 2}: invalid phone`); return; }
      const c = ensureCustomer(req.biz.id, phone, row.name || null);
      const tags = new Set([...(JSON.parse(get('SELECT tags FROM customers WHERE id = ?', c.id).tags || '[]')), ...String(row.tags || '').split('|').map((t) => t.trim()).filter(Boolean)]);
      update('customers', c.id, {
        tags: JSON.stringify([...tags]), notes: row.notes || undefined,
        last_visit_at: row.last_visit ? new Date(`${row.last_visit}T12:00:00Z`).toISOString() : undefined,
        marketing_opt_in: row.marketing_opt_in ? bool(['yes', 'y', '1', 'true'].includes(row.marketing_opt_in.toLowerCase())) : undefined,
      });
      imported++;
      const svc = row.service && services.find((s) => s.name.toLowerCase() === row.service.toLowerCase());
      if (svc?.recall_days && row.last_visit) {
        const due = Date.parse(`${row.last_visit}T05:00:00Z`) + svc.recall_days * 86400_000;
        schedule(req.biz.id, 'service.recall', Math.max(due, Date.now() + 60_000 + recalls * 2000), { phone, service_id: svc.id }, `recall:${phone}:${svc.id}`);
        recalls++;
      }
    });
  });
  ok(res, { imported, recalls, errors });
});

r.get('/customers-export.csv', (req, res) => {
  const rows = all(`SELECT * FROM customers WHERE business_id = ? AND phone NOT LIKE 'sim%' ORDER BY id`, req.biz.id)
    .map((c) => ({ ...c, tags: JSON.parse(c.tags || '[]').join('|') }));
  res.type('text/csv').attachment('customers.csv').send(toCsv(rows, ['phone', 'name', 'address', 'tags', 'notes', 'opted_in', 'marketing_opt_in', 'last_order_at', 'last_visit_at', 'created_at']));
});

// ======================= LEADS =======================
r.get('/leads', (req, res) => ok(res, { leads: all(`SELECT * FROM leads WHERE business_id = ? AND phone NOT LIKE 'sim%' ORDER BY id DESC LIMIT 500`, req.biz.id).map((l) => parseJson(l, ['answers'])) }));
r.put('/leads/:id', (req, res) => {
  update('leads', Number(req.params.id), { status: req.body.status, notes: req.body.notes }, req.biz.id);
  ok(res);
});
r.get('/leads-export.csv', (req, res) => {
  const rows = all(`SELECT * FROM leads WHERE business_id = ? AND phone NOT LIKE 'sim%' ORDER BY id DESC`, req.biz.id)
    .map((l) => ({ ...l, answers: Object.entries(JSON.parse(l.answers || '{}')).map(([k, v]) => `${k}: ${v}`).join('; ') }));
  res.type('text/csv').attachment('leads.csv').send(toCsv(rows, ['id', 'created_at', 'name', 'phone', 'answers', 'status', 'notes']));
});

// ======================= INBOX =======================
r.get('/chats', (req, res) => {
  const filter = req.query.filter;
  const rows = all(`SELECT m.phone, MAX(m.id) AS last_id FROM messages m WHERE m.business_id = ? AND m.phone NOT LIKE 'sim%'
    ${req.query.q ? 'AND (m.phone LIKE ? OR m.phone IN (SELECT phone FROM customers WHERE business_id = m.business_id AND name LIKE ?))' : ''}
    GROUP BY m.phone ORDER BY last_id DESC LIMIT 200`, req.biz.id, ...(req.query.q ? [`%${req.query.q}%`, `%${req.query.q}%`] : []));
  const chats = rows.map((r0) => {
    const last = get('SELECT body, direction, created_at FROM messages WHERE id = ?', r0.last_id);
    const c = get('SELECT id, name, last_inbound_at FROM customers WHERE business_id = ? AND phone = ?', req.biz.id, r0.phone) || {};
    const s = get('SELECT needs_attention, bot_paused_until, state FROM sessions WHERE business_id = ? AND phone = ?', req.biz.id, r0.phone) || {};
    return {
      phone: r0.phone, name: c.name, customer_id: c.id, last: last?.body, last_dir: last?.direction, last_at: last?.created_at,
      needs_reply: Boolean(s.needs_attention), paused: Boolean(s.bot_paused_until && Date.parse(s.bot_paused_until) > Date.now()), state: s.state,
      window_open: Boolean(c.last_inbound_at && Date.now() - Date.parse(c.last_inbound_at) < 86400_000),
    };
  }).filter((c) => (filter === 'attention' ? c.needs_reply : true));
  ok(res, { chats });
});

r.get('/chats/:phone/messages', (req, res) => {
  const msgs = all('SELECT id, direction, kind, body, status, error, sent_by, created_at, payload FROM messages WHERE business_id = ? AND phone = ? AND id > ? ORDER BY id DESC LIMIT 200',
    req.biz.id, req.params.phone, Number(req.query.after) || 0).reverse().map((m) => {
    if (m.kind === 'image' || m.kind === 'document' || m.kind === 'audio' || m.kind === 'video') {
      try { const p = JSON.parse(m.payload); m.media_id = p[m.kind]?.id; m.mime = p[m.kind]?.mime_type; } catch { /* ignore */ }
    }
    delete m.payload;
    return m;
  });
  const s = get('SELECT * FROM sessions WHERE business_id = ? AND phone = ?', req.biz.id, req.params.phone);
  const customer = parseJson(get('SELECT * FROM customers WHERE business_id = ? AND phone = ?', req.biz.id, req.params.phone), ['tags']);
  ok(res, {
    messages: msgs, customer, windowOpen: windowOpen(req.biz, req.params.phone),
    paused: Boolean(s?.bot_paused_until && Date.parse(s.bot_paused_until) > Date.now()), needsReply: Boolean(s?.needs_attention),
  });
});

r.post('/chats/:phone/send', async (req, res) => {
  const textBody = String(req.body.text || '').trim();
  if (!textBody) throw new HttpError(400, 'Type a message');
  const phone = req.params.phone;
  // A staff reply pauses the bot so it does not talk over the human
  pauseBot(req.biz.id, phone, req.biz.settings.handoff_pause_hours);
  run('UPDATE sessions SET needs_attention = 0 WHERE business_id = ? AND phone = ?', req.biz.id, phone);
  const result = await send(req.biz, phone, B.text(textBody), { sentBy: req.user.name || req.user.email });
  if (!result.ok && !result.simulated) throw new HttpError(400, result.error);
  ok(res, result);
});

r.post('/chats/:phone/resume', (req, res) => { resumeBot(req.biz.id, req.params.phone); ok(res); });
r.post('/chats/:phone/pause', (req, res) => { pauseBot(req.biz.id, req.params.phone, req.biz.settings.handoff_pause_hours); ok(res); });
r.post('/chats/:phone/done', (req, res) => { run('UPDATE sessions SET needs_attention = 0 WHERE business_id = ? AND phone = ?', req.biz.id, req.params.phone); ok(res); });

r.get('/media/:id', async (req, res) => {
  if (!isConnected(req.biz)) throw new HttpError(400, 'WhatsApp not connected');
  const { buffer, mime } = await clientFor(req.biz).downloadMedia(req.params.id);
  res.type(mime || 'application/octet-stream').set('Cache-Control', 'private, max-age=3600').send(buffer);
});

// ======================= KNOWLEDGE BASE (AI) =======================
const engineInfo = (biz) => {
  const e = engineFor(biz);
  return {
    provider: e.provider, label: e.label, model: e.model, ownKey: e.ownKey, ready: Boolean(e.key),
    engines: Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, { label: p.label, defaultModel: p.defaultModel(), serverKey: Boolean(p.serverKey()) }])),
  };
};
r.get('/knowledge', (req, res) => ok(res, { sources: KB.listSources(req.biz.id), stats: KB.stats(req.biz.id), limits: KB.LIMITS, aiAvailable: aiAvailable(req.biz), engine: engineInfo(req.biz) }));
r.get('/knowledge/:id', (req, res) => {
  const src = KB.getSource(req.biz.id, req.params.id);
  if (!src) throw new HttpError(404, 'Not found');
  ok(res, { source: src });
});
r.post('/knowledge', (req, res) => ok(res, { source: KB.addSource(req.biz.id, { title: req.body.title || 'Notes', kind: 'text', content: req.body.content }) }));
r.post('/knowledge/file', async (req, res) => {
  const { filename, mime, base64, title } = req.body || {};
  const content = await KB.extractFile({ filename, mime, base64 });
  ok(res, { source: KB.addSource(req.biz.id, { title: title || filename, kind: 'file', source: filename, content }) });
});
r.post('/knowledge/url', async (req, res) => {
  const page = await KB.fetchUrl(String(req.body.url || '').trim());
  ok(res, { source: KB.addSource(req.biz.id, { title: req.body.title || page.title || req.body.url, kind: 'url', source: req.body.url, content: page.text }) });
});
r.put('/knowledge/:id', (req, res) => ok(res, { source: KB.updateSource(req.biz.id, req.params.id, req.body || {}) }));
r.delete('/knowledge/:id', (req, res) => { KB.deleteSource(req.biz.id, req.params.id); ok(res); });
r.post('/knowledge/search', (req, res) => ok(res, { passages: KB.search(req.biz.id, req.body.q || '', 6) }));
r.post('/ai/try', async (req, res) => {
  if (!aiAvailable(req.biz)) throw new HttpError(400, `No API key for ${engineFor(req.biz).label}. Paste your key in AI assistant → AI engine (or ask your developer to add it to .env).`);
  const q = String(req.body.question || '').trim();
  if (!q) throw new HttpError(400, 'Type a question');
  const out = await tryQuestion(req.biz, q);
  if (!out) throw new HttpError(502, `${engineFor(req.biz).label} did not answer. Check the API key, the model name and your account credit, then try again.`);
  ok(res, { result: out });
});

// ======================= INTEGRATIONS =======================
r.get('/integrations', (req, res) => {
  const pub = publicBusiness(req.biz).settings.integrations;
  ok(res, {
    config: pub, events: INT.EVENTS, log: INT.recentLog(req.biz.id), sheetsScript: INT.sheetsScript(req.biz.settings.integrations?.sheets?.token || ''),
    stripeWebhook: `${config.publicUrl}/webhooks/stripe/${req.biz.id}`,
  });
});
r.post('/integrations/test', role('owner', 'superadmin'), async (req, res) => {
  const target = req.body.target;
  if (!INT.TARGETS.includes(target)) throw new HttpError(400, 'Unknown integration');
  try {
    const r0 = await INT.deliver(req.biz, target, INT.testPayload(req.biz));
    ok(res, { result: r0 });
  } catch (e) {
    throw new HttpError(400, `Test failed: ${e.message}`);
  }
});

// ======================= BOT TEXTS =======================
const textLang = (req) => (DEFAULT_TEXTS[req.query.lang] ? req.query.lang : DEFAULT_TEXTS[req.biz.language] ? req.biz.language : 'en');
const overridesFor = (biz, lang) => (lang === biz.language ? Object.fromEntries(Object.entries(biz.texts || {}).filter(([k]) => !k.startsWith('@'))) : biz.texts?.[`@${lang}`] || {});

r.get('/texts', (req, res) => {
  const lang = textLang(req);
  ok(res, { groups: TEXT_GROUPS, defaults: DEFAULT_TEXTS[lang], overrides: overridesFor(req.biz, lang), language: lang, primary: req.biz.language, languages: LANGUAGES });
});

r.put('/texts', (req, res) => {
  const lang = textLang(req);
  const all = structuredClone(req.biz.texts || {});
  const target = lang === req.biz.language ? all : (all[`@${lang}`] = all[`@${lang}`] || {});
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!(k in DEFAULT_TEXTS.en)) continue;
    if (v === null || v === '') delete target[k]; else target[k] = String(v).slice(0, 2000);
  }
  saveBusiness(req.biz.id, { texts: all });
  ok(res, { overrides: overridesFor(getBusiness(req.biz.id), lang) });
});

// ======================= TEMPLATES =======================
r.get('/templates', async (req, res) => {
  let remote = [];
  let remoteError = null;
  if (isConnected(req.biz) && req.biz.wa_waba_id) {
    try { remote = (await clientFor(req.biz).listTemplates()).data || []; } catch (e) { remoteError = e.message; }
  }
  ok(res, { slots: TEMPLATE_SLOTS, configured: req.biz.settings.templates, remote: remote.map((t) => ({ name: t.name, language: t.language, status: t.status, category: t.category })), remoteError });
});

r.post('/templates/create', role('owner', 'superadmin'), async (req, res) => {
  if (!isConnected(req.biz) || !req.biz.wa_waba_id) throw new HttpError(400, 'Connect WhatsApp (including WABA ID) first');
  const lang = req.body.lang || 'en';
  const slots = (req.body.slots?.length ? req.body.slots : Object.keys(TEMPLATE_SLOTS)).filter((s) => TEMPLATE_SLOTS[s]);
  const results = [];
  const templates = structuredClone(req.biz.settings.templates || {});
  for (const slot of slots) {
    const def = templateDefinition(slot, lang);
    try {
      const out = await clientFor(req.biz).createTemplate(def);
      results.push({ slot, ok: true, status: out.status });
    } catch (e) {
      const exists = /already exists|duplicate/i.test(e.message) || e.code === 100 && /name/i.test(e.message);
      results.push({ slot, ok: exists, status: exists ? 'EXISTS' : 'ERROR', error: exists ? null : e.message });
    }
    if (results.at(-1).ok) templates[slot] = { name: def.name, lang };
  }
  const raw = JSON.parse(get('SELECT settings FROM businesses WHERE id = ?', req.biz.id).settings || '{}');
  saveBusiness(req.biz.id, { settings: { ...raw, templates } });
  ok(res, { results });
});

// ======================= BROADCASTS =======================
r.get('/broadcasts', (req, res) => {
  const tags = new Set();
  all(`SELECT tags FROM customers WHERE business_id = ? AND phone NOT LIKE 'sim%'`, req.biz.id).forEach((c) => JSON.parse(c.tags || '[]').forEach((t) => tags.add(t)));
  ok(res, { broadcasts: all('SELECT * FROM broadcasts WHERE business_id = ? ORDER BY id DESC LIMIT 50', req.biz.id).map((b) => parseJson(b, ['params', 'audience'])), tags: [...tags].sort() });
});

r.post('/broadcasts/preview', (req, res) => {
  const { sql, p } = broadcastAudience(req.biz.id, req.body.audience);
  ok(res, { count: all(sql, ...p).length });
});

r.post('/broadcasts', role('owner', 'superadmin'), (req, res) => {
  const b = req.body || {};
  if (!b.template_name) throw new HttpError(400, 'Choose an approved template');
  const { sql, p } = broadcastAudience(req.biz.id, b.audience);
  const total = all(sql, ...p).length;
  if (!total) throw new HttpError(400, 'No customers match this audience (only opted-in customers can receive broadcasts)');
  const id = insert('broadcasts', {
    business_id: req.biz.id, name: b.name || b.template_name, template_name: b.template_name, template_lang: b.template_lang || 'en',
    params: JSON.stringify(b.params || []), audience: JSON.stringify(b.audience || {}), total,
  });
  schedule(req.biz.id, 'broadcast.run', Date.now(), { id }, `broadcast:${id}`);
  audit(req, 'broadcast.create', { id, total });
  ok(res, { id, total });
});

// ======================= TEAM =======================
r.get('/team', (req, res) => ok(res, { users: all('SELECT id, email, name, role, active, last_login_at, created_at FROM users WHERE business_id = ? ORDER BY id', req.biz.id) }));
r.post('/team', role('owner', 'superadmin'), (req, res) => {
  const roleName = req.body.role === 'owner' ? 'owner' : 'staff';
  const id = createUser({ email: req.body.email, password: req.body.password, name: req.body.name, role: roleName, businessId: req.biz.id });
  ok(res, { id });
});
r.put('/team/:id', role('owner', 'superadmin'), (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ? AND business_id = ?', Number(req.params.id), req.biz.id);
  if (!u) throw new HttpError(404, 'Not found');
  if (req.body.password) setPassword(u.id, req.body.password);
  if (req.body.name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', String(req.body.name || ''), u.id);
  if (['owner', 'staff'].includes(req.body.role) && u.id !== req.user.id) run('UPDATE users SET role = ? WHERE id = ?', req.body.role, u.id);
  if (req.body.active !== undefined) {
    if (u.id === req.user.id) throw new HttpError(400, 'You cannot disable yourself');
    run('UPDATE users SET active = ? WHERE id = ?', bool(req.body.active), u.id);
  }
  ok(res);
});
r.delete('/team/:id', role('owner', 'superadmin'), (req, res) => {
  if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'You cannot delete yourself');
  run('DELETE FROM users WHERE id = ? AND business_id = ?', Number(req.params.id), req.biz.id);
  ok(res);
});

// ======================= SIMULATOR (test the bot without WhatsApp) =======================
const simPhone = (req) => `sim${req.user.id}`;

r.get('/sim/messages', (req, res) => {
  const msgs = all('SELECT id, direction, kind, body, payload, status, created_at FROM messages WHERE business_id = ? AND phone = ? AND id > ? ORDER BY id',
    req.biz.id, simPhone(req), Number(req.query.after) || 0).map((m) => ({ ...m, payload: JSON.parse(m.payload || '{}') }));
  const s = get('SELECT state, cart, ctx, bot_paused_until FROM sessions WHERE business_id = ? AND phone = ?', req.biz.id, simPhone(req));
  ok(res, { messages: msgs, session: s ? parseJson(s, ['cart', 'ctx']) : null, phone: simPhone(req) });
});

r.post('/sim/message', async (req, res) => {
  const b = req.body || {};
  const id = `sim.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  let message;
  if (b.choice) {
    message = b.choice.list
      ? { id, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: b.choice.id, title: b.choice.title } } }
      : { id, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: b.choice.id, title: b.choice.title } } };
  } else if (b.location) message = { id, type: 'location', location: { latitude: 28.6139, longitude: 77.209, name: 'Shared location', address: 'Connaught Place, New Delhi' } };
  else if (b.media) message = { id, type: b.media, [b.media]: { id: 'sim-media', mime_type: b.media === 'image' ? 'image/jpeg' : 'application/pdf' } };
  else message = { id, type: 'text', text: { body: String(b.text || '').slice(0, 1000) } };
  await handleIncoming(req.biz, { from: simPhone(req), profileName: b.name || req.user.name || 'Test Customer', message });
  ok(res);
});

r.post('/sim/reset', (req, res) => {
  const phone = simPhone(req);
  tx(() => {
    for (const t of ['messages', 'sessions', 'orders', 'appointments', 'leads']) run(`DELETE FROM ${t} WHERE business_id = ? AND phone = ?`, req.biz.id, phone);
    run('DELETE FROM customers WHERE business_id = ? AND phone = ?', req.biz.id, phone);
  });
  ok(res);
});

/** "Fast-forward time": run this tester's pending reminders / check-ins / recalls right now. */
r.post('/sim/run-jobs', async (req, res) => {
  const phone = simPhone(req);
  const ids = all('SELECT id FROM appointments WHERE business_id = ? AND phone = ?', req.biz.id, phone).map((a) => `appt:${a.id}`);
  const refs = [...ids, ...all(`SELECT DISTINCT ref FROM jobs WHERE business_id = ? AND ref LIKE ?`, req.biz.id, `recall:${phone}:%`).map((j) => j.ref)];
  let n = 0;
  for (const ref of refs) n += run(`UPDATE jobs SET run_at = ? WHERE ref = ? AND status = 'PENDING'`, new Date(Date.now() - 1000).toISOString(), ref).changes;
  // cart nudge for the tester
  const { cartNudges } = await import('../services/scheduler.js');
  await cartNudges(true);
  await runDueJobs();
  ok(res, { jobs: n });
});

export default r;
