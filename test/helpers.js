// Test harness: fresh in-memory database + a fake customer that chats with the engine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.WAK_SKIP_ENV_FILE = '1';
process.env.DB_FILE = ':memory:';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wak-test-'));
process.env.SCHEDULER_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';
process.env.ANTHROPIC_API_KEY = '';

const db = await import('../src/db/index.js');
db.migrate();
const { createBusiness } = await import('../src/services/setup.js');
const { handleIncoming } = await import('../src/engine/index.js');
const { saveBusiness, getBusiness } = await import('../src/services/business.js');
const { deepMerge } = await import('../src/lib/util.js');

export { db, getBusiness };

/** Create a business from a preset with "always open" hours so tests do not depend on the clock. */
export function makeBusiness(preset, settings = {}, extra = {}) {
  const b = createBusiness({ name: `Test ${preset} ${Math.random().toString(36).slice(2, 6)}`, preset, sampleData: true, owner_phone: '919999999999' });
  const allDay = [['00:00', '23:59']];
  const hours = { mon: allDay, tue: allDay, wed: allDay, thu: allDay, fri: allDay, sat: allDay, sun: allDay };
  saveBusiness(b.id, { settings: deepMerge({ ...b.settings, hours }, settings), address: '12 MG Road', ...extra });
  return getBusiness(b.id);
}

let seq = 0;
/** A simulated customer. send() returns the bot's replies to that one message. */
export function customer(biz, phone = `sim-test-${++seq}`, name = 'Neha Sharma') {
  const lastId = () => db.get('SELECT COALESCE(MAX(id),0) AS id FROM messages WHERE business_id = ? AND phone = ?', biz.id, phone).id;
  async function deliver(message) {
    const before = lastId();
    await handleIncoming(getBusiness(biz.id), { from: phone, profileName: name, message: { id: `m${Date.now()}${Math.random()}`, ...message } });
    return db.all(`SELECT * FROM messages WHERE business_id = ? AND phone = ? AND id > ? AND direction = 'out' ORDER BY id`, biz.id, phone, before)
      .map((m) => ({ ...m, payload: JSON.parse(m.payload) }));
  }
  const api = {
    phone,
    text: (body) => deliver({ type: 'text', text: { body } }),
    tap: (id, title = id) => deliver({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } }),
    pick: (id, title = id) => deliver({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } }),
    location: () => deliver({ type: 'location', location: { latitude: 12.97, longitude: 77.59, name: 'Home', address: 'Indiranagar, Bengaluru' } }),
    media: (type = 'image') => deliver({ type, [type]: { id: 'media123' } }),
    session: () => { const s = db.get('SELECT * FROM sessions WHERE business_id = ? AND phone = ?', biz.id, phone); return s && { ...s, cart: JSON.parse(s.cart), ctx: JSON.parse(s.ctx) }; },
  };
  return api;
}

/** All selectable ids in a reply (buttons + list rows). */
export function options(reply) {
  const out = [];
  for (const m of [].concat(reply)) {
    const i = m.payload.interactive;
    if (!i) continue;
    if (i.type === 'button') out.push(...i.action.buttons.map((b) => ({ id: b.reply.id, title: b.reply.title })));
    if (i.type === 'list') out.push(...i.action.sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))));
  }
  return out;
}

export const findOpt = (reply, pred) => options(reply).find((o) => (typeof pred === 'string' ? o.id.startsWith(pred) : pred(o)));
export const bodies = (reply) => [].concat(reply).map((m) => m.body).join('\n---\n');
