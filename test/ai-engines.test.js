// OpenAI GPT and Google Gemini engines: same brain, same rules, same validation as Claude.
// Both APIs are mocked locally (no keys or network needed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server, calls = [], respond;
before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
      const [status, payload] = respond(req.url);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENAI_BASE_URL = `${base}/openai/v1`;
  process.env.GEMINI_BASE_URL = `${base}/gemini/v1beta`;
});
after(() => server.close());

const R = (o) => ({ intent: 'question', answerable: false, answer: '', items: [], unclear: [], suggest: 'none', ...o });
const openaiReply = (obj) => [200, { choices: [{ message: { role: 'assistant', content: JSON.stringify(obj), refusal: null } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }];
const geminiReply = (obj, finishReason = 'STOP') => [200, { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason }], usageMetadata: { promptTokenCount: 10 } }];

async function setup(preset, ai) {
  const h = await import('./helpers.js');
  const { config } = await import('../src/config.js');
  config.openaiBaseUrl = process.env.OPENAI_BASE_URL;
  config.geminiBaseUrl = process.env.GEMINI_BASE_URL;
  return { ...h, config, biz: h.makeBusiness(preset, { ai: { enabled: true, ...ai } }) };
}

test('OpenAI GPT: own encrypted key, strict JSON schema, typed order goes into the cart', async () => {
  const { encrypt } = await import('../src/lib/crypto.js');
  const { biz, customer, bodies, db } = await setup('grocery', { provider: 'openai', openai_key_enc: encrypt('sk-client-key') });
  const atta = db.get(`SELECT * FROM products WHERE business_id = ? AND name LIKE 'Aashirvaad%'`, biz.id);
  respond = () => openaiReply(R({ intent: 'order', items: [{ id: atta.id, qty: 3 }, { id: 424242, qty: 1 }] }));
  const c = customer(biz);
  await c.text('hi');
  const r = await c.text('3 packet aata bhej do');
  assert.match(bodies(r), /added these to your cart/);
  assert.deepEqual(c.session().cart.map((l) => [l.id, l.qty, l.price]), [[atta.id, 3, atta.price]], 'unknown id dropped, DB price used');
  const req = calls.at(-1);
  assert.equal(req.url, '/openai/v1/chat/completions');
  assert.equal(req.headers.authorization, 'Bearer sk-client-key');
  assert.equal(req.body.model, 'gpt-5-mini');
  assert.equal(req.body.response_format.type, 'json_schema');
  assert.equal(req.body.response_format.json_schema.strict, true);
  assert.deepEqual(req.body.response_format.json_schema.schema.required, ['intent', 'answerable', 'answer', 'items', 'unclear', 'suggest']);
  assert.equal(req.body.messages[0].role, 'system');
  assert.match(req.body.messages[0].content, /Aashirvaad Atta 5kg/);
  assert.match(req.body.messages[1].content, /CUSTOMER MESSAGE:\n3 packet aata/);
});

test('Google Gemini: server key, response schema, knowledge answer in the customer language; model override', async () => {
  const { biz, customer, bodies, options, config } = await setup('clinic', { provider: 'gemini', model: 'gemini-custom-model' });
  config.geminiKey = 'g-server-key';
  const KB = await import('../src/services/knowledge.js');
  KB.addSource(biz.id, { title: 'Fees', content: 'Consultation fee is Rs 500. Follow-up within 7 days is Rs 300.' });
  respond = () => geminiReply(R({ answerable: true, answer: 'કન્સલ્ટેશન ફી *₹500* છે.', suggest: 'book' }));
  const c = customer(biz);
  await c.text('hi');
  const r = await c.text('કન્સલ્ટેશન ફી કેટલી છે?');
  assert.match(bodies(r), /₹500/);
  assert.ok(options(r).some((o) => o.id === 'bk:start'));
  const req = calls.at(-1);
  assert.equal(req.url, '/gemini/v1beta/models/gemini-custom-model:generateContent');
  assert.equal(req.headers['x-goog-api-key'], 'g-server-key');
  assert.equal(req.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(req.body.generationConfig.responseSchema.type, 'OBJECT');
  assert.match(req.body.systemInstruction.parts[0].text, /Consultation fee is Rs 500/);
  config.geminiKey = '';
});

test('bad engine output, safety blocks and API errors never break the chat', async () => {
  const { biz, customer, bodies, options, config } = await setup('generic', { provider: 'gemini' });
  config.geminiKey = 'g-key';
  const c = customer(biz);
  await c.text('hi');
  respond = () => [200, { candidates: [{ content: { parts: [{ text: '{"hello":"not our schema"}' }] }, finishReason: 'STOP' }] }];
  let r = await c.text('tell me something random please');
  assert.ok(options(r).length > 0, 'falls back to the menu');
  respond = () => geminiReply(R({ answerable: true, answer: 'x' }), 'SAFETY');
  r = await c.text('another question here');
  assert.ok(options(r).length > 0);
  respond = () => [429, { error: { message: 'quota exceeded' } }];
  r = await c.text('one more question here');
  assert.ok(options(r).length > 0);
  assert.doesNotMatch(bodies(r), /quota/);
  config.geminiKey = '';
});

test('no key for the chosen engine -> AI is simply not used', async () => {
  const { biz, customer, bodies } = await setup('generic', { provider: 'openai' });
  const { aiAvailable, engineFor } = await import('../src/services/ai.js');
  assert.equal(aiAvailable(biz), false);
  assert.equal(engineFor(biz).label, 'OpenAI GPT (ChatGPT)');
  const before = calls.length;
  const c = customer(biz);
  await c.text('hi');
  const r = await c.text('what are your timings on sunday');
  assert.equal(calls.length, before, 'no AI request made');
  assert.match(bodies(r), /open|Welcome|Monday|timings|options/i);
});
