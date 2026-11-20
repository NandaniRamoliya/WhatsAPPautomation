// AI brain: request shape (model, cached system prompt with the knowledge base,
// structured output, refusal fallback), routing of each intent, and the
// "AI proposes, code validates" guarantees - against a local mock of the Anthropic API.
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
        content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0 },
      }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
});
after(() => mock.close());

const R = (o) => ({ intent: 'question', answerable: false, answer: '', items: [], unclear: [], suggest: 'none', ...o });

async function setup(preset, settings = {}) {
  const h = await import('./helpers.js');
  const { config } = await import('../src/config.js');
  config.anthropicKey = 'test-key';
  return { ...h, biz: h.makeBusiness(preset, { ai: { enabled: true }, ...settings }) };
}

test('typed order -> cart; invented ids dropped; prices from DB; request shape', async () => {
  const { biz, customer, bodies, db } = await setup('grocery');
  const atta = db.get(`SELECT * FROM products WHERE business_id = ? AND name LIKE 'Aashirvaad%'`, biz.id);
  const maggi = db.get(`SELECT * FROM products WHERE business_id = ? AND name LIKE 'Maggi%'`, biz.id);
  reply = R({ intent: 'order', items: [{ id: atta.id, qty: 2 }, { id: maggi.id, qty: 1 }, { id: 999999, qty: 5 }], unclear: ['tel'] });
  const c = customer(biz);
  await c.text('hi');
  const r = await c.text('2 kilo aata aur 1 maggi aur tel bhej do');
  assert.match(bodies(r), /added these to your cart/);
  assert.match(bodies(r), /could not find: tel/);
  assert.deepEqual(c.session().cart.map((l) => [l.id, l.qty, l.price]), [[atta.id, 2, atta.price], [maggi.id, 1, maggi.price]]);

  const req = captured.at(-1);
  assert.match(req.url, /^\/v1\/messages/);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(req.body.output_config.effort, 'low');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.system[0].cache_control.type, 'ephemeral', 'stable prompt is cached');
  assert.match(req.body.system[0].text, /Aashirvaad Atta 5kg/, 'catalogue in the cached prompt');
  assert.match(req.body.messages[0].content, /CUSTOMER MESSAGE:\n2 kilo aata/);
  assert.match(req.body.messages[0].content, /RECENT CHAT:/, 'chat memory included');
});

test('question answered from the knowledge base with next-step buttons; unsure -> human offer', async () => {
  const { biz, customer, bodies, options } = await setup('clinic');
  const KB = await import('../src/services/knowledge.js');
  KB.addSource(biz.id, { title: 'Clinic policies', content: 'We accept all major insurance including Star Health and HDFC Ergo. Parking is free in the basement.' });
  const c = customer(biz);
  await c.text('hi');
  reply = R({ answerable: true, answer: 'Yes, we accept *Star Health* insurance 🙂', suggest: 'book' });
  let r = await c.text('kya aap star health insurance lete ho');
  assert.match(bodies(r), /Star Health/);
  assert.ok(options(r).some((o) => o.id === 'bk:start'), 'book-now button suggested');
  assert.match(captured.at(-1).body.system[0].text, /KNOWLEDGE BASE:[\s\S]*Star Health and HDFC Ergo/, 'small KB sent in full (cached)');

  reply = R({ answerable: false });
  r = await c.text('can you explain my MRI report findings please');
  assert.match(bodies(r), /not fully sure/);
  assert.ok(options(r).some((o) => o.id === 'human'));
});

test('booking intent starts the booking flow; human intent hands off', async () => {
  const { biz, customer, bodies } = await setup('salon');
  const c = customer(biz);
  await c.text('hi');
  reply = R({ intent: 'booking', answerable: true, answer: 'Sure! Let us find you a slot.' });
  let r = await c.text('i want a haircut tomorrow evening');
  assert.match(bodies(r), /find you a slot/);
  assert.match(bodies(r), /Which service/);
  reply = R({ intent: 'human' });
  r = await c.text('I want to speak to the manager about a bad experience');
  assert.match(bodies(r), /team member will reply/);
  assert.equal(c.session().needs_attention, 1);
});

test('large knowledge base -> only the best passages are sent (search mode)', async () => {
  const { biz, customer } = await setup('generic');
  const KB = await import('../src/services/knowledge.js');
  const filler = Array.from({ length: 900 }, (_, i) => `Paragraph ${i} about general company history and unrelated facts number ${i}.`).join('\n\n');
  KB.addSource(biz.id, { title: 'Handbook', content: `${filler}\n\nRefund policy: refunds are processed within 7 working days to the original payment method.` });
  const c = customer(biz);
  await c.text('hi');
  reply = R({ answerable: true, answer: 'Refunds take 7 working days.' });
  await c.text('how long does a refund take');
  const req = captured.at(-1).body;
  assert.doesNotMatch(req.system[0].text, /KNOWLEDGE BASE:/, 'big KB not in system prompt');
  assert.match(req.messages[0].content, /RELEVANT KNOWLEDGE BASE PASSAGES:[\s\S]*refunds are processed within 7 working days/);
});
