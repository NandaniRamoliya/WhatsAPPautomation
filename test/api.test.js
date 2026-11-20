import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.META_APP_SECRET = 'test-app-secret';
const { db, makeBusiness } = await import('./helpers.js');
const { app } = await import('../src/server.js');
const { createUser } = await import('../src/services/setup.js');
const { config } = await import('../src/config.js');
const { saveBusiness } = await import('../src/services/business.js');
const { encrypt } = await import('../src/lib/crypto.js');

let server, base, cookie, biz;
const H = () => ({ 'content-type': 'application/json', 'x-requested-with': 'wak', cookie });
const api = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: H(), body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
};

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  biz = makeBusiness('grocery', { ordering: { payment_modes: ['upi'], upi_id: 'shop@okicici', delivery: false, pickup: true, min_order: 0 } });
  saveBusiness(biz.id, { wa_phone_number_id: '111222333', wa_token_enc: encrypt('fake-token') });
  createUser({ email: 'owner@shop.test', password: 'password123', role: 'owner', businessId: biz.id });
});
after(() => server.close());

test('webhook verification handshake', async () => {
  const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=${config.verifyToken}&hub.challenge=12345`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '12345');
  const bad = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`);
  assert.equal(bad.status, 403);
});

test('webhook rejects bad signatures, accepts good ones, de-duplicates', async () => {
  const realFetch = globalThis.fetch;
  const graphCalls = [];
  // Intercept Graph API calls (send + mark read) so no network is used
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://graph.facebook.com')) {
      graphCalls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${graphCalls.length}` }], success: true }), { status: 200 });
    }
    return realFetch(url, opts);
  };
  try {
    const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: '111222333' }, contacts: [{ wa_id: '919876543210', profile: { name: 'Rahul' } }],
      messages: [{ from: '919876543210', id: 'wamid.IN1', timestamp: '1', type: 'text', text: { body: 'Hi' } }],
    } }] }] });
    const sig = `sha256=${crypto.createHmac('sha256', 'test-app-secret').update(payload).digest('hex')}`;
    const post = (s) => realFetch(`${base}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': s }, body: payload });

    assert.equal((await post('sha256=deadbeef')).status, 401);
    assert.equal((await post(sig)).status, 200);
    assert.equal((await post(sig)).status, 200); // Meta retry
    await new Promise((r) => setTimeout(r, 300));
    const inbound = db.all(`SELECT * FROM messages WHERE business_id = ? AND phone = '919876543210' AND direction = 'in'`, biz.id);
    assert.equal(inbound.length, 1, 'duplicate delivery ignored');
    const sends = graphCalls.filter((c) => c.body?.to === '919876543210');
    assert.equal(sends.length, 1, 'one welcome message');
    assert.equal(sends[0].body.type, 'interactive');
    assert.ok(graphCalls.some((c) => c.body?.status === 'read'), 'marked as read');
    assert.equal(db.get(`SELECT name FROM customers WHERE phone = '919876543210'`).name, 'Rahul');

    // delivery status update
    const st = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '111222333' }, statuses: [{ id: sends[0] ? 'wamid.2' : '', status: 'read', recipient_id: '919876543210' }] } }] }] });
    await realFetch(`${base}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', 'test-app-secret').update(st).digest('hex')}` }, body: st });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('about (public): product name, maker, version; Help guide PDF is served', async () => {
  const r = await fetch(`${base}/api/about`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.brand.name, 'Replix');
  assert.equal(j.brand.company, 'Indrix');
  assert.match(j.version, /^\d+\.\d+\.\d+$/);
  assert.ok(!JSON.stringify(j).match(/secret|token|key/i), 'no secrets in the public about data');
  const pdf = await fetch(`${base}/guides/user-guide.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
});

test('auth: login required, CSRF header enforced, wrong password rejected', async () => {
  let r = await fetch(`${base}/api/me`);
  assert.equal(r.status, 401);
  r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@shop.test', password: 'nope' }) });
  assert.equal(r.status, 401);
  r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@shop.test', password: 'password123' }) });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  const me = await api('GET', '/api/me');
  assert.equal(me.body.user.email, 'owner@shop.test');
  const noHeader = await fetch(`${base}/api/products`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' });
  assert.equal(noHeader.status, 403);
  const admin = await api('GET', '/api/admin/businesses');
  assert.equal(admin.status, 403, 'owners cannot use agency admin');
});

test('business settings: secrets are encrypted and never returned', async () => {
  const r = await api('PUT', '/api/business', { settings: { ordering: { razorpay_key_id: 'rzp_test_1' } }, secrets: { razorpay_key_secret: 'supersecret' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.business.settings.ordering.razorpay_key_secret_set, true);
  assert.ok(!JSON.stringify(r.body).includes('supersecret'));
  const raw = db.get('SELECT settings FROM businesses WHERE id = ?', biz.id).settings;
  assert.ok(!raw.includes('supersecret'), 'stored encrypted');
  const g = await api('GET', '/api/business');
  assert.match(g.body.business.whatsapp.token, /^••••••/);
});

test('catalogue CRUD + CSV import', async () => {
  const created = await api('POST', '/api/products', { name: 'Test Soap', price: 4500, category: 'Bath' });
  assert.equal(created.status, 200);
  const bad = await api('POST', '/api/products', { category: 'x' });
  assert.equal(bad.status, 400);
  const imp = await api('POST', '/api/products/import', { csv: 'name,price,category,unit\n"Rice, Premium",120.50,Staples,kg\nTest Soap,50,Bath,pc\n,10,x,y' });
  assert.equal(imp.body.created, 1);
  assert.equal(imp.body.updated, 1);
  assert.equal(imp.body.errors.length, 1);
  assert.equal(db.get(`SELECT price FROM products WHERE business_id = ? AND name = 'Rice, Premium'`, biz.id).price, 12050);
  const exp = await fetch(`${base}/api/products/export.csv`, { headers: H() });
  assert.match(await exp.text(), /"Rice, Premium",120\.50/);
});

test('simulator end-to-end + UPI pay page + mark paid from dashboard', async () => {
  await api('POST', '/api/sim/reset');
  await api('POST', '/api/sim/message', { text: 'hi' });
  const p = db.get(`SELECT id FROM products WHERE business_id = ? AND name LIKE 'Amul Milk%'`, biz.id);
  await api('POST', '/api/sim/message', { choice: { id: `ord:p:${p.id}`, title: 'Milk', list: true } });
  await api('POST', '/api/sim/message', { choice: { id: 'ord:q:2', title: '2' } });
  await api('POST', '/api/sim/message', { choice: { id: 'ord:checkout', title: 'Checkout' } });
  const msgs = (await api('GET', '/api/sim/messages')).body.messages;
  const cta = msgs.reverse().find((m) => m.payload?.interactive?.type === 'cta_url');
  assert.ok(cta, 'pay link sent in simulator');
  const url = new URL(cta.payload.interactive.action.parameters.url);
  const page = await fetch(base + url.pathname);
  const html = await page.text();
  assert.match(html, /upi:\/\/pay\?pa=shop%40okicici/);
  assert.match(html, /₹66/);

  const orders = await api('GET', '/api/orders?test=1&status=NEW');
  const order = orders.body.orders[0];
  const paid = await api('POST', `/api/orders/${order.id}/paid`);
  assert.equal(paid.body.order.status, 'CONFIRMED');
  const st = await api('POST', `/api/orders/${order.id}/status`, { status: 'READY' });
  assert.equal(st.body.order.status, 'READY');
  const last = (await api('GET', '/api/sim/messages')).body.messages.at(-1);
  assert.match(last.body, /ready for pickup/);
  const pulse = await api('GET', '/api/pulse');
  assert.ok(pulse.body.lastOrder >= order.id);
  const stats = await api('GET', '/api/stats');
  assert.equal(stats.body.checklist.tested, true);
});

test('inbox: staff reply pauses bot; resume', async () => {
  const chats = await api('GET', '/api/chats');
  const chat = chats.body.chats.find((c) => c.phone === '919876543210');
  assert.ok(chat);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (String(url).startsWith('https://graph.facebook.com')
    ? new Response(JSON.stringify({ messages: [{ id: 'wamid.staff' }] }), { status: 200 }) : realFetch(url, opts));
  try {
    const r = await api('POST', `/api/chats/${chat.phone}/send`, { text: 'Hello from the shop!' });
    assert.equal(r.status, 200);
  } finally { globalThis.fetch = realFetch; }
  const m = await api('GET', `/api/chats/${chat.phone}/messages`);
  assert.equal(m.body.paused, true);
  assert.equal(m.body.messages.at(-1).sent_by, 'owner@shop.test');
  await api('POST', `/api/chats/${chat.phone}/resume`);
  assert.equal((await api('GET', `/api/chats/${chat.phone}/messages`)).body.paused, false);
});
