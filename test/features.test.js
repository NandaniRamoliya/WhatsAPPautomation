// New features: knowledge base, custom menu & quick replies, multi-language,
// integrations hub, Stripe + payment links, WhatsApp-app coexistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeBusiness, customer, options, findOpt, bodies, db, getBusiness } from './helpers.js';
import * as KB from '../src/services/knowledge.js';
import { saveBusiness } from '../src/services/business.js';
import { encrypt } from '../src/lib/crypto.js';
import { deepMerge } from '../src/lib/util.js';

const setSettings = (biz, patch) => saveBusiness(biz.id, { settings: deepMerge(getBusiness(biz.id).settings, patch) });

// ---------------- knowledge base ----------------
test('knowledge: chunking, Unicode full-text search, update and delete', () => {
  const biz = makeBusiness('generic');
  const src = KB.addSource(biz.id, { title: 'Menu', content: 'Masala Dosa costs Rs 120.\n\nFilter coffee Rs 40.\n\nપાર્કિંગ મફત છે અને સાંજે 10 વાગ્યા સુધી ખુલ્લું છે.' });
  assert.equal(src.chunks, 1);
  assert.match(KB.search(biz.id, 'how much is dosa?')[0].body, /Masala Dosa/);
  assert.match(KB.search(biz.id, 'પાર્કિંગ')[0].body, /પાર્કિંગ/, 'Gujarati search works');
  assert.equal(KB.knowledgeFor(biz.id, 'x').mode, 'full');
  KB.updateSource(biz.id, src.id, { content: 'Only idli today. Idli costs Rs 60 per plate.' });
  assert.equal(KB.search(biz.id, 'dosa').length, 0);
  assert.equal(KB.search(biz.id, 'idli').length, 1);
  KB.updateSource(biz.id, src.id, { active: false });
  assert.equal(KB.search(biz.id, 'idli').length, 0, 'inactive sources are ignored');
  KB.deleteSource(biz.id, src.id);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM kb_chunks WHERE business_id = ?', biz.id).n, 0);
  const long = KB.chunkText('Sentence number one is here. '.repeat(200));
  assert.ok(long.length > 3 && long.every((ch) => ch.length <= 900 + 150), "chunks stay within size + overlap");
});

test('knowledge: file extraction and URL safety (no internal addresses)', async () => {
  const txt = await KB.extractFile({ filename: 'prices.csv', base64: Buffer.from('item,price\nTea,20').toString('base64') });
  assert.match(txt, /Tea,20/);
  const html = KB.htmlToText('<html><title>Our Menu</title><style>x{}</style><body><h1>Menu</h1><ul><li>Tea &amp; Coffee</li></ul><script>alert(1)</script></body></html>');
  assert.equal(html.title, 'Our Menu');
  assert.match(html.text, /• Tea & Coffee/);
  assert.doesNotMatch(html.text, /alert/);
  await assert.rejects(KB.fetchUrl('http://127.0.0.1:3000/api'), /not allowed/);
  await assert.rejects(KB.fetchUrl('http://169.254.169.254/latest/meta-data'), /not allowed/);
  await assert.rejects(KB.fetchUrl('file:///etc/passwd'), /http/);
  await assert.rejects(KB.extractFile({ filename: 'a.docx', base64: Buffer.from('x').toString('base64') }), /Save as PDF/);
});

// ---------------- custom menu & quick replies ----------------
test('custom menu buttons and keyword quick replies (text, document, link, flow)', async () => {
  const biz = makeBusiness('generic');
  const add = (o) => db.insert('quick_replies', { business_id: biz.id, show_in_menu: 1, active: 1, ...o });
  const price = add({ title: '📄 Price list', keywords: 'price list, rate card, rates', reply_type: 'document', url: 'https://example.com/price-list.pdf', body: 'Our latest prices' });
  add({ title: '🎁 Offers', keywords: 'offer, discount', reply_type: 'text', body: '20% off on Sundays!' });
  add({ title: 'Website', keywords: 'website', reply_type: 'link', url: 'https://example.com', button_label: 'Open site', body: 'Visit us online', show_in_menu: 0 });
  add({ title: 'Enquire', keywords: 'quote', reply_type: 'flow', flow_target: 'enq:lead', show_in_menu: 0 });
  const c = customer(biz);
  let r = await c.text('hi');
  assert.ok(findOpt(r, (o) => o.title === '📄 Price list'), 'custom button in menu');
  assert.ok(!findOpt(r, (o) => o.title === 'Website'), 'hidden from menu when show_in_menu = 0');
  r = await c.pick(`qr:${price}`);
  assert.equal(r[0].payload.type, 'document');
  assert.equal(r[0].payload.document.filename, 'price-list.pdf');
  r = await c.text('any discount today?');
  assert.match(bodies(r), /20% off/);
  r = await c.text('what is your website');
  assert.equal(r[0].payload.interactive.type, 'cta_url');
  r = await c.text('I need a quote');
  assert.match(bodies(r), /what you are looking for/, 'flow reply starts the enquiry form');
});

test('menu with more than 10 options is paginated', async () => {
  const biz = makeBusiness('generic');
  for (let i = 0; i < 14; i++) db.insert('quick_replies', { business_id: biz.id, title: `Option ${i}`, reply_type: 'text', body: `Answer ${i}`, sort: i });
  const c = customer(biz);
  let r = await c.text('hi');
  const more = findOpt(r, 'menu:p:');
  assert.ok(more);
  assert.equal(options(r).length, 10);
  r = await c.pick(more.id);
  assert.ok(findOpt(r, (o) => o.id === 'human'), 'last page ends with Talk to us');
});

// ---------------- languages ----------------
test('language picker, Gujarati conversation, reminders in the customer language', async () => {
  const biz = makeBusiness('dental', { language_choice: { enabled: true, languages: ['en', 'gu', 'hi'] }, booking: { intake_questions: [] } });
  const c = customer(biz);
  let r = await c.text('hi');
  assert.ok(findOpt(r, 'lang:gu'), 'new customer is asked to choose a language');
  r = await c.tap('lang:gu');
  assert.match(bodies(r), /ગુજરાતીમાં/);
  assert.match(bodies(r), /સ્વાગત/, 'menu in Gujarati');
  assert.equal(db.get('SELECT language FROM customers WHERE phone = ?', c.phone).language, 'gu');
  r = await c.text('hi');
  assert.ok(!findOpt(r, 'lang:gu'), 'not asked again');
  const { book, slotsFor } = await import('../src/services/appointments.js');
  const { addDays, todayIn } = await import('../src/lib/time.js');
  const service = db.get('SELECT * FROM services WHERE business_id = ? LIMIT 1', biz.id);
  const appt = book(getBusiness(biz.id), { phone: c.phone, name: 'Neha', serviceId: service.id, start: slotsFor(getBusiness(biz.id), service, addDays(todayIn(biz.timezone), 3))[0].start });
  db.run('UPDATE jobs SET run_at = ? WHERE ref = ?', new Date(Date.now() - 1000).toISOString(), `appt:${appt.id}`);
  await (await import('../src/services/jobs.js')).runDueJobs();
  const rem = db.get(`SELECT body FROM messages WHERE phone = ? AND body LIKE '%⏰%' ORDER BY id DESC`, c.phone);
  assert.match(rem.body, /યાદ અપાવીએ/, 'scheduled reminder uses the customer language');
  r = await c.text('language');
  assert.ok(findOpt(r, 'lang:hi'));
  r = await c.tap('lang:hi');
  assert.match(bodies(r), /हिन्दी/);
});

test('per-language text overrides', async () => {
  const biz = makeBusiness('generic', {}, { language: 'hi', texts: { welcome: 'स्वागत है {business}!' } });
  const c = customer(biz);
  const r = await c.text('नमस्ते');
  assert.match(bodies(r), /स्वागत है Test generic/);
});

// ---------------- integrations ----------------
test('integrations: signed webhook + Google Sheets + HubSpot + Airtable deliveries, failures retried and logged', async () => {
  const biz = makeBusiness('real_estate');
  setSettings(biz, { integrations: {
    webhook: { enabled: true, url: 'https://hooks.example.com/n8n', secret_enc: encrypt('s3cret') },
    sheets: { enabled: true, url: 'https://script.google.com/macros/s/abc/exec', token: 'tok' },
    hubspot: { enabled: true, token_enc: encrypt('hs-token') },
    airtable: { enabled: true, token_enc: encrypt('at-token'), base_id: 'appXYZ', table: 'Leads' },
  } });
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes('hubapi.com/crm/v3/objects/contacts/search')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
    if (String(url).includes('hubapi.com/crm/v3/objects/contacts')) return new Response(JSON.stringify({ id: '501' }), { status: 201 });
    if (String(url).includes('airtable')) return new Response('{"error":"down"}', { status: 503 });
    return new Response('ok', { status: 200 });
  };
  try {
    const c = customer(biz, '919811122233', 'Riya Patel');
    await c.text('hi');
    await c.tap('enq:lead');
    await c.tap('enq:la:0:0'); await c.tap('enq:la:1:0'); await c.text('50 lakh'); await c.text('Satellite, Ahmedabad');
    await new Promise((r) => setTimeout(r, 50));
  } finally { globalThis.fetch = real; }
  const hook = calls.find((x) => x.url === 'https://hooks.example.com/n8n' && JSON.parse(x.opts.body).event === 'lead.created');
  assert.ok(hook, 'webhook received lead.created');
  const body = hook.opts.body;
  assert.equal(hook.opts.headers['X-WAK-Signature'], `sha256=${crypto.createHmac('sha256', 's3cret').update(body).digest('hex')}`);
  const p = JSON.parse(body);
  assert.equal(p.contact.phone, '+919811122233');
  assert.equal(p.row.Budget, '50 lakh');
  const sheet = calls.find((x) => x.url.includes('script.google.com') && JSON.parse(x.opts.body).event === 'lead.created');
  assert.equal(JSON.parse(sheet.opts.body).sheet, 'Leads');
  assert.equal(JSON.parse(sheet.opts.body).token, 'tok');
  assert.ok(calls.some((x) => x.url.endsWith('/crm/v3/objects/notes') && JSON.parse(x.opts.body).associations[0].to.id === '501'), 'HubSpot note linked to contact');
  assert.ok(calls.some((x) => x.url.includes('customer.created') || JSON.parse(x.opts.body || '{}').event === 'customer.created'), 'customer.created emitted');
  const log = db.all('SELECT target, status FROM integration_log WHERE business_id = ?', biz.id);
  assert.ok(log.some((l) => l.target === 'airtable' && l.status === 'error'));
  assert.ok(db.get(`SELECT 1 FROM jobs WHERE type = 'integration.retry' AND business_id = ?`, biz.id), 'failed delivery queued for retry');
});

test('integrations: simulator chats never reach real systems', async () => {
  const biz = makeBusiness('real_estate');
  setSettings(biz, { integrations: { webhook: { enabled: true, url: 'https://hooks.example.com/x' } } });
  const real = globalThis.fetch;
  let hit = 0;
  globalThis.fetch = async () => { hit++; return new Response('ok'); };
  try { await customer(biz).text('hi'); await new Promise((r) => setTimeout(r, 20)); } finally { globalThis.fetch = real; }
  assert.equal(hit, 0);
});

// ---------------- payments ----------------
test('Stripe: checkout link sent; signed webhook confirms once; bad signature rejected', async () => {
  const biz = makeBusiness('restaurant', { ordering: { payment_modes: ['stripe'], stripe_secret_key_enc: encrypt('sk_test_1'), stripe_webhook_secret_enc: encrypt('whsec_1'), pickup: true, delivery: false, ask_notes: false } });
  const real = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, opts) => { sent = { url: String(url), body: String(opts.body) }; return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200 }); };
  const c = customer(biz);
  try {
    await c.text('hi');
    const p = db.get(`SELECT id FROM products WHERE business_id = ? LIMIT 1`, biz.id);
    await c.pick(`ord:p:${p.id}`); await c.tap('ord:q:1');
    const r = await c.tap('ord:checkout');
    assert.equal(r.at(-1).payload.interactive.action.parameters.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  } finally { globalThis.fetch = real; }
  assert.equal(sent.url, 'https://api.stripe.com/v1/checkout/sessions');
  const order = db.get('SELECT * FROM orders WHERE business_id = ?', biz.id);
  assert.match(decodeURIComponent(sent.body), new RegExp(`client_reference_id=${biz.id}-${order.id}`));
  assert.match(decodeURIComponent(sent.body), new RegExp(`unit_amount\\]=${order.total}`));

  const { verifyStripeSignature } = await import('../src/services/payments.js');
  const raw = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: `${biz.id}-${order.id}`, payment_status: 'paid' } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${crypto.createHmac('sha256', 'whsec_1').update(`${t}.${raw}`).digest('hex')}`;
  assert.equal(verifyStripeSignature(getBusiness(biz.id), raw, sig), true);
  assert.equal(verifyStripeSignature(getBusiness(biz.id), raw, `t=${t},v1=deadbeef`), false);
  assert.equal(verifyStripeSignature(getBusiness(biz.id), raw, sig, t + 3600), false, 'old signatures rejected');
});

test('generic payment link with {amount} and {order_no}', async () => {
  const biz = makeBusiness('bakery', { ordering: { payment_modes: ['link'], pay_link_template: 'https://paypal.me/sweetcakes/{amount}?note=order{order_no}', ask_notes: false, delivery: false, pickup: true } });
  const c = customer(biz);
  await c.text('hi');
  const p = db.get(`SELECT * FROM products WHERE business_id = ? LIMIT 1`, biz.id);
  await c.pick(`ord:p:${p.id}`); await c.tap('ord:q:1');
  const r = await c.tap('ord:checkout');
  assert.equal(r.at(-1).payload.interactive.action.parameters.url, `https://paypal.me/sweetcakes/${(p.price / 100).toFixed(2)}?note=order1001`);
});

// ---------------- coexistence ----------------
test('owner replies from the WhatsApp Business app -> logged and bot pauses for that chat', async () => {
  const biz = makeBusiness('generic');
  const c = customer(biz, '919800011111');
  await c.text('hi');
  const { recordEcho } = await import('../src/engine/index.js');
  recordEcho(getBusiness(biz.id), { from: '919811122233', to: '919800011111', id: 'wamid.echo1', type: 'text', text: { body: 'Hi! This is the owner.' } });
  const m = db.get(`SELECT * FROM messages WHERE wamid = 'wamid.echo1'`);
  assert.equal(m.sent_by, 'WhatsApp app');
  const r = await c.text('thanks, what time?');
  assert.equal(r.length, 0, 'bot stays quiet while the owner is chatting');
});
