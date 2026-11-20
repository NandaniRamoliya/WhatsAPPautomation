import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBusiness, customer, options, findOpt, bodies, db } from './helpers.js';
import { LIMITS } from '../src/whatsapp/builders.js';

test('grocery: full COD order from greeting to confirmation', async () => {
  const biz = makeBusiness('grocery', { ordering: { payment_modes: ['cod', 'upi'], upi_id: 'shop@upi', min_order: 0, pickup: false } });
  const c = customer(biz);

  let r = await c.text('Hi');
  assert.match(bodies(r), /Welcome to/);
  assert.ok(findOpt(r, 'ord:start'), 'menu offers Order now');

  r = await c.tap('ord:start');
  const cat = findOpt(r, 'ord:cat:');
  assert.ok(cat, 'categories list shown');

  r = await c.pick(findOpt(r, (o) => o.title === 'Staples').id);
  const atta = findOpt(r, (o) => o.title.startsWith('Aashirvaad'));
  assert.ok(atta);

  r = await c.pick(atta.id);
  assert.match(bodies(r), /How many/);
  r = await c.text('3'); // typed quantity
  assert.match(bodies(r), /Added 3 × Aashirvaad/);
  assert.equal(c.session().cart[0].qty, 3);

  // adding the same item again merges the line
  r = await c.pick(atta.id);
  r = await c.tap('ord:q:2');
  assert.equal(c.session().cart.length, 1);
  assert.equal(c.session().cart[0].qty, 5);

  r = await c.tap('ord:checkout');
  assert.match(bodies(r), /delivery address/i);
  r = await c.text('short');
  assert.match(bodies(r), /too short/);
  r = await c.text('Flat 4B, Green Park, Near City Mall, Pune');
  assert.match(bodies(r), /How would you like to pay/);
  r = await c.tap('ord:pay:cod');
  assert.match(bodies(r), /Order \*#1001\* confirmed/);

  const order = db.get('SELECT * FROM orders WHERE business_id = ?', biz.id);
  assert.equal(order.status, 'CONFIRMED');
  assert.equal(order.payment_status, 'COD');
  assert.equal(order.subtotal, 5 * 23000);
  assert.equal(order.delivery_fee, 0, 'free delivery above threshold');
  assert.equal(c.session().cart.length, 0, 'cart cleared');

  // Owner was alerted
  const alert = db.get(`SELECT * FROM messages WHERE business_id = ? AND phone = '919999999999' ORDER BY id DESC`, biz.id);
  assert.match(alert.body, /NEW ORDER #1001/);

  // Second checkout offers the saved address
  await c.tap('ord:start');
  await c.pick(findOpt(await c.tap('ord:start'), (o) => o.title === 'Dairy').id).then(async (rr) => c.pick(options(rr)[0].id));
  await c.tap('ord:q:1');
  r = await c.tap('ord:checkout');
  assert.match(bodies(r), /Deliver to this address/);
  assert.ok(findOpt(r, 'ord:addr:same'));
});

test('UPI order waits for payment and confirms exactly once', async () => {
  const biz = makeBusiness('grocery', { ordering: { payment_modes: ['upi'], upi_id: 'shop@upi', min_order: 0, pickup: false, delivery: false } });
  const c = customer(biz);
  await c.text('hi');
  let r = await c.text('maggi'); // free-text search
  const maggi = findOpt(r, (o) => o.title.startsWith('Maggi'));
  assert.ok(maggi, 'search finds product');
  await c.pick(maggi.id);
  await c.tap('ord:q:2');
  r = await c.tap('ord:checkout');
  const cta = r.find((m) => m.payload.interactive?.type === 'cta_url');
  assert.ok(cta, 'pay-now button sent');
  const order = db.get('SELECT * FROM orders WHERE business_id = ?', biz.id);
  assert.equal(order.status, 'NEW');
  assert.equal(order.fulfilment, 'pickup');
  assert.ok(cta.payload.interactive.action.parameters.url.endsWith(`/pay/${order.pay_token}`));

  const { confirmPayment } = await import('../src/services/orders.js');
  const { getBusiness } = await import('../src/services/business.js');
  assert.equal(await confirmPayment(getBusiness(biz.id), order.id), true);
  assert.equal(await confirmPayment(getBusiness(biz.id), order.id), false, 'second confirm is a no-op');
  const paidMsgs = db.all(`SELECT * FROM messages WHERE business_id = ? AND phone = ? AND body LIKE '%Payment received%'`, biz.id, c.phone);
  assert.equal(paidMsgs.length, 1);
});

test('minimum order, out-of-stock and unknown input never break the flow', async () => {
  const biz = makeBusiness('grocery', { ordering: { min_order: 100000 } });
  const c = customer(biz);
  await c.text('hello');
  await c.tap('ord:start');
  const p = db.get(`SELECT * FROM products WHERE business_id = ? AND name LIKE 'Parle%'`, biz.id);
  await c.pick(`ord:p:${p.id}`);
  await c.tap('ord:q:1');
  let r = await c.tap('ord:checkout');
  assert.match(bodies(r), /Minimum order/);

  db.run('UPDATE products SET in_stock = 0 WHERE id = ?', p.id);
  r = await c.tap('ord:cart');
  assert.match(bodies(r), /no longer available/);
  assert.match(bodies(r), /cart is empty/);

  r = await c.text('asdkjh qwe zzz');
  assert.ok(options(r).length > 0, 'nonsense gets a menu, not silence');
});

test('every interactive message respects WhatsApp limits', async () => {
  const biz = makeBusiness('grocery');
  for (let i = 0; i < 25; i++) db.insert('products', { business_id: biz.id, name: `Very long product name number ${i} extra words`, category: `Category with a very long name ${i % 13}`, price: 1000 + i });
  const c = customer(biz);
  await c.text('hi');
  let r = await c.tap('ord:start');
  const all = db.all(`SELECT payload FROM messages WHERE business_id = ? AND direction = 'out'`, biz.id).map((m) => JSON.parse(m.payload));
  // paginate categories
  const more = findOpt(r, 'ord:cats:');
  assert.ok(more, 'more-options row when > 10 categories');
  r = await c.pick(more.id);
  for (const m of all.concat(r.map((x) => x.payload))) {
    const i = m.interactive;
    if (!i) continue;
    if (i.type === 'button') {
      assert.ok(i.action.buttons.length <= LIMITS.buttons);
      i.action.buttons.forEach((b) => assert.ok(b.reply.title.length <= LIMITS.buttonTitle, b.reply.title));
    }
    if (i.type === 'list') {
      const rows = i.action.sections.flatMap((s) => s.rows);
      assert.ok(rows.length <= LIMITS.rows);
      rows.forEach((row) => assert.ok(row.title.length <= LIMITS.rowTitle, row.title));
      assert.ok(i.action.button.length <= LIMITS.listButton);
    }
  }
});

test('reorder, location address, STOP opt-out and handoff', async () => {
  const biz = makeBusiness('grocery', { ordering: { payment_modes: ['cod'], min_order: 0, pickup: false } });
  const c = customer(biz);
  await c.text('hi');
  const p = db.get(`SELECT * FROM products WHERE business_id = ? AND name LIKE 'Sugar%'`, biz.id);
  await c.pick(`ord:p:${p.id}`);
  await c.tap('ord:q:2');
  await c.tap('ord:checkout');
  let r = await c.location();
  assert.match(bodies(r), /Order \*#1001\* confirmed/, 'COD-only goes straight to confirmation');
  assert.match(db.get('SELECT address FROM orders WHERE business_id = ?', biz.id).address, /maps\.google\.com/);

  r = await c.tap('ord:my');
  assert.match(bodies(r), /#1001/);
  r = await c.tap('ord:reorder');
  assert.equal(c.session().cart[0].qty, 2);

  r = await c.text('talk to someone');
  assert.match(bodies(r), /team member will reply/);
  r = await c.text('are you there?');
  assert.equal(r.length, 0, 'bot stays silent during handoff');
  assert.equal(c.session().needs_attention, 1);
  r = await c.text('menu');
  assert.ok(options(r).length, 'menu resumes the bot');

  r = await c.text('STOP');
  assert.match(bodies(r), /unsubscribed/);
  assert.equal(db.get('SELECT opted_in FROM customers WHERE phone = ? AND business_id = ?', c.phone, biz.id).opted_in, 0);
});

test('hinglish language and custom text overrides', async () => {
  const biz = makeBusiness('grocery', {}, { language: 'hinglish', texts: { menu_human: '📞 Call me' } });
  const c = customer(biz);
  const r = await c.text('namaste');
  assert.match(bodies(r), /swagat/);
  assert.ok(options(r).some((o) => o.title === '📞 Call me'));
});
