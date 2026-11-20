// The ONE place every outbound message goes through. It:
//  - routes simulator chats (phone starts with "sim") to the dashboard tester
//  - respects the 24-hour customer service window (falls back to approved templates)
//  - records every message for the inbox
//  - never throws: returns { ok, wamid, error }
import { get, insert, run, now } from '../db/index.js';
import { log } from '../lib/logger.js';
import { WhatsAppClient, ERROR_HINTS } from './cloudApi.js';
import { summarize } from './builders.js';
import { waCredentials, isConnected } from '../services/business.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;
export const isSimulator = (phone) => String(phone).startsWith('sim');

export function clientFor(biz) {
  const c = waCredentials(biz);
  return new WhatsAppClient({ token: c.token, phoneNumberId: c.phoneNumberId, wabaId: c.wabaId });
}

export function windowOpen(biz, phone) {
  if (isSimulator(phone)) return true;
  const c = get('SELECT last_inbound_at FROM customers WHERE business_id = ? AND phone = ?', biz.id, phone);
  return Boolean(c?.last_inbound_at && Date.now() - Date.parse(c.last_inbound_at) < WINDOW_MS);
}

function record(biz, phone, msg, status, extra = {}) {
  return insert('messages', {
    business_id: biz.id, phone, direction: 'out', kind: msg.type === 'interactive' ? msg.interactive.type : msg.type,
    body: summarize(msg), payload: JSON.stringify(msg), status, created_at: now(), ...extra,
  });
}

/**
 * send(biz, phone, message, { fallbackTemplate, sentBy })
 * fallbackTemplate: a template() message used automatically when the 24h window is closed.
 */
export async function send(biz, phone, message, opts = {}) {
  const sentBy = opts.sentBy || 'bot';
  let msg = message;
  if (msg.type !== 'template' && !windowOpen(biz, phone)) {
    if (opts.fallbackTemplate) msg = opts.fallbackTemplate;
    else {
      const error = '24h window closed and no approved template configured for this message';
      record(biz, phone, msg, 'skipped', { error, sent_by: sentBy });
      log.warn('message skipped (24h window)', { biz: biz.id, phone });
      return { ok: false, error };
    }
  }

  if (isSimulator(phone)) {
    record(biz, phone, msg, 'simulated', { sent_by: sentBy });
    return { ok: true, simulated: true };
  }
  if (!isConnected(biz)) {
    const error = 'WhatsApp not connected yet (dry run) - add credentials in Settings > WhatsApp';
    record(biz, phone, msg, 'dry_run', { error, sent_by: sentBy });
    log.info('dry-run message', { biz: biz.id, phone, body: summarize(msg).slice(0, 80) });
    return { ok: false, error, dryRun: true };
  }

  try {
    const wamid = await clientFor(biz).send(phone, msg);
    record(biz, phone, msg, 'sent', { wamid, sent_by: sentBy });
    return { ok: true, wamid };
  } catch (e) {
    const hint = ERROR_HINTS[e.code] ? ` – ${ERROR_HINTS[e.code]}` : '';
    const error = `${e.code || ''} ${e.message}${hint}`.trim();
    record(biz, phone, msg, 'failed', { error, sent_by: sentBy });
    log.error('send failed', { biz: biz.id, phone, error, details: e.details });
    return { ok: false, error, code: e.code };
  }
}

/** Update delivery status from Meta status webhooks. */
export function applyStatus(status) {
  const err = status.errors?.[0];
  const error = err ? `${err.code} ${err.title || ''}${ERROR_HINTS[err.code] ? ` – ${ERROR_HINTS[err.code]}` : ''}` : null;
  run('UPDATE messages SET status = ?, error = COALESCE(?, error) WHERE wamid = ?', status.status, error, status.id);
}
