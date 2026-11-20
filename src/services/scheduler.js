// Background loop: due jobs (reminders, check-ins, recalls, broadcasts), abandoned-cart
// nudges, auto-completion of visits and housekeeping. Runs inside the web process.
import { all, run, now } from '../db/index.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import * as B from '../whatsapp/builders.js';
import { send, windowOpen } from '../whatsapp/sender.js';
import { textFor } from '../engine/texts.js';
import { runDueJobs } from './jobs.js';
import { getBusiness } from './business.js';
import { autoCompleteDue } from './appointments.js';
import { firstName, getCustomer } from './customers.js';
import './broadcasts.js'; // registers broadcast job handler

/** Remind customers who left items in the cart (only inside the free 24h window, once per cart). */
export async function cartNudges(force = false) {
  const rows = all(`SELECT * FROM sessions WHERE cart != '[]' AND state LIKE 'ORD_%' ${force ? `AND phone LIKE 'sim%'` : ''}`);
  for (const s of rows) {
    const biz = getBusiness(s.business_id);
    const mins = Number(biz?.settings.ordering.cart_nudge_minutes) || 0;
    if (!biz || !biz.has('ordering') || !mins) continue;
    const ctx = JSON.parse(s.ctx || '{}');
    if (ctx.nudged) continue;
    const idle = Date.now() - Date.parse(s.updated_at);
    if (!force && (idle < mins * 60_000 || idle > 20 * 3600_000)) continue;
    if (!windowOpen(biz, s.phone)) continue;
    ctx.nudged = true;
    run('UPDATE sessions SET ctx = ? WHERE business_id = ? AND phone = ?', JSON.stringify(ctx), s.business_id, s.phone);
    const c = getCustomer(biz.id, s.phone);
    const n = firstName(c?.name);
    await send(biz, s.phone, B.buttons(textFor(biz, s.phone, 'cart_nudge', { name_sp: n ? ` ${n}` : '' }), [
      { id: 'ord:checkout', title: textFor(biz, s.phone, 'btn_checkout') }, { id: 'ord:cart', title: textFor(biz, s.phone, 'btn_view_cart') },
    ]));
  }
}

function housekeeping() {
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  run('DELETE FROM processed_events WHERE created_at < ?', weekAgo);
  run(`DELETE FROM jobs WHERE status IN ('DONE','CANCELLED') AND updated_at < ?`, new Date(Date.now() - 30 * 86400_000).toISOString());
  // un-stick jobs left RUNNING by a crash
  run(`UPDATE jobs SET status = 'PENDING' WHERE status = 'RUNNING' AND updated_at < ?`, new Date(Date.now() - 15 * 60_000).toISOString());
}

let timer = null;
let busy = false;
let ticks = 0;

export async function tick() {
  if (busy) return;
  busy = true;
  try {
    await runDueJobs();
    await cartNudges();
    if (ticks % 10 === 0) { await autoCompleteDue(); housekeeping(); }
    ticks++;
  } catch (e) {
    log.error('scheduler tick failed', e);
  } finally {
    busy = false;
  }
}

export function startScheduler() {
  if (!config.schedulerEnabled || timer) return;
  timer = setInterval(tick, config.schedulerIntervalMs);
  timer.unref?.();
  setTimeout(tick, 3000).unref?.();
  log.info('scheduler started', { everyMs: config.schedulerIntervalMs, at: now() });
}

export function stopScheduler() { clearInterval(timer); timer = null; }
