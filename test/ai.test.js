// Verifies the AI layer's request shape and its "AI proposes, code validates" guard
// against a local mock of the Anthropic API (no real key or network needed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let mock, captured = [], reply;
before(async () => {
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      captured.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 10, output_tokens: 10 },
      }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
});
after(() => mock.close());

test('free-text order is parsed by AI, invented ids are dropped, prices stay from DB', async () => {
  const { makeBusiness, customer, bodies, db } = await import('./helpers.js');
  const { config } = await import('../src/config.js');
  config.anthropicKey = 'test-key';
  const biz = makeBusiness('grocery', { ai: { enabled: true } });
  const atta = db.get(`SELECT * FROM products WHERE business_id = ? AND name LIKE 'Aashirvaad%'`, biz.id);
  const maggi = db.get(`SELECT * FROM products WHERE business_id = ? AND name LIKE 'Maggi%'`, biz.id);
  reply = { items: [{ id: atta.id, qty: 2 }, { id: maggi.id, qty: 1 }, { id: 999999, qty: 5 }], unclear: ['tel'] };

  const c = customer(biz);
  await c.text('hi');
  const r = await c.text('2 kilo aata aur 1 maggi aur tel bhej do');
  assert.match(bodies(r), /added these to your cart/);
  assert.match(bodies(r), /could not find: tel/);
  const cart = c.session().cart;
  assert.deepEqual(cart.map((l) => [l.id, l.qty, l.price]), [[atta.id, 2, atta.price], [maggi.id, 1, maggi.price]]);

  const req = captured.at(-1);
  assert.match(req.url, /^\/v1\/messages/);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(req.body.output_config.effort, 'low');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.match(req.body.messages[0].content, /Aashirvaad Atta 5kg/);
});

test('AI answers questions only when answerable; otherwise falls back to the menu', async () => {
  const { makeBusiness, customer, bodies, options } = await import('./helpers.js');
  const biz = makeBusiness('generic', { ai: { enabled: true } });
  const c = customer(biz);
  await c.text('hi');
  reply = { answerable: true, answer: 'Yes, we are open on Sunday till 1 PM.' };
  let r = await c.text('kya aap sunday ko khule ho bhai');
  assert.match(bodies(r), /open on Sunday/);
  reply = { answerable: false, answer: '' };
  r = await c.text('can you give me medical advice about my knee');
  assert.ok(options(r).some((o) => o.id === 'human'), 'menu with talk-to-us');
});
