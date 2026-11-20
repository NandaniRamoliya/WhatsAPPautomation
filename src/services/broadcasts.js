// Broadcast campaigns: approved template -> opted-in customers, in throttled batches.
import { all, get, run, parseJson, now } from '../db/index.js';
import * as B from '../whatsapp/builders.js';
import { send } from '../whatsapp/sender.js';
import { registerJob, schedule } from './jobs.js';
import { getBusiness } from './business.js';
import { firstName } from './customers.js';
import { fill } from '../lib/util.js';

export function broadcastAudience(bizId, audience = {}) {
  let sql = `SELECT id, phone, name FROM customers WHERE business_id = ? AND opted_in = 1 AND phone NOT LIKE 'sim%'`;
  const p = [bizId];
  if (audience.marketing_only !== false) sql += ' AND marketing_opt_in = 1';
  if (audience.tag) { sql += ' AND tags LIKE ?'; p.push(`%"${audience.tag}"%`); }
  return { sql, p };
}

const BATCH = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

registerJob('broadcast.run', async (job) => {
  const biz = getBusiness(job.business_id);
  const bc = parseJson(get('SELECT * FROM broadcasts WHERE id = ? AND business_id = ?', job.payload.id, job.business_id), ['params', 'audience']);
  if (!biz || !bc || ['DONE', 'FAILED'].includes(bc.status)) return;
  run(`UPDATE broadcasts SET status = 'RUNNING' WHERE id = ?`, bc.id);
  const { sql, p } = broadcastAudience(biz.id, bc.audience);
  const batch = all(`${sql} AND id > ? ORDER BY id LIMIT ${BATCH}`, ...p, bc.cursor);
  let sent = 0, failed = 0, cursor = bc.cursor;
  for (const c of batch) {
    const params = (bc.params || []).map((x) => fill(x, { name: firstName(c.name) || 'there', business: biz.name }));
    const r = await send(biz, c.phone, B.template(bc.template_name, bc.template_lang, params), { sentBy: `broadcast:${bc.id}` });
    if (r.ok || r.simulated) sent++; else failed++;
    cursor = c.id;
    await sleep(80); // ~12 msg/s, well under Cloud API throughput limits
  }
  run('UPDATE broadcasts SET sent = sent + ?, failed = failed + ?, cursor = ? WHERE id = ?', sent, failed, cursor, bc.id);
  if (batch.length === BATCH) schedule(biz.id, 'broadcast.run', Date.now(), { id: bc.id }, `broadcast:${bc.id}`);
  else run(`UPDATE broadcasts SET status = 'DONE', finished_at = ? WHERE id = ?`, now(), bc.id);
});
