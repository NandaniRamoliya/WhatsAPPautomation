// Meta WhatsApp webhook: GET = verification, POST = messages + delivery statuses.
// Production rules: verify signature on the RAW body, answer 200 immediately,
// de-duplicate by message id, process in the background.
import express from 'express';
import { run } from '../db/index.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { hmacHex, safeEqual } from '../lib/crypto.js';
import { getBusinessByPhoneNumberId, waCredentials } from '../services/business.js';
import { handleIncoming } from '../engine/index.js';
import { applyStatus, clientFor } from '../whatsapp/sender.js';
import { recordEcho } from '../engine/index.js';

const r = express.Router();

r.get('/webhook', (req, res) => {
  const ok = req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.verifyToken;
  if (ok) { log.info('webhook verified'); return res.status(200).type('text/plain').send(String(req.query['hub.challenge'])); }
  log.warn('webhook verification failed - check the Verify Token in Meta');
  return res.sendStatus(403);
});

function signatureValid(req, appSecret) {
  if (!appSecret) return !config.isProd; // allow unsigned only in development
  const got = req.get('x-hub-signature-256') || '';
  return safeEqual(got, `sha256=${hmacHex(appSecret, req.rawBody || '')}`);
}

/** Per-customer queue so two quick taps are processed in order, never in parallel. */
const queues = new Map();
function enqueue(key, task) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(task, task).finally(() => { if (queues.get(key) === next) queues.delete(key); });
  queues.set(key, next);
  return next;
}

r.post('/webhook', (req, res) => {
  const entries = req.body?.entry || [];
  // Signature: check against the app secret of the business the event belongs to (or global)
  const pnid = entries[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  const biz = pnid ? getBusinessByPhoneNumberId(pnid) : null;
  const secret = (biz && waCredentials(biz).appSecret) || config.metaAppSecret;
  if (!signatureValid(req, secret)) { log.warn('invalid webhook signature', { pnid }); return res.sendStatus(401); }
  res.sendStatus(200); // answer fast; Meta retries slow/failed deliveries

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const b = getBusinessByPhoneNumberId(value.metadata?.phone_number_id);
      if (!b) { if (value.messages) log.warn('message for unknown phone_number_id', { id: value.metadata?.phone_number_id }); continue; }
      for (const st of value.statuses || []) { try { applyStatus(st); } catch (e) { log.error('status update failed', e); } }
      // Same number used in the WhatsApp Business app ("coexistence"): the owner typed a reply on the phone
      for (const echo of value.message_echoes || []) { try { recordEcho(b, echo); } catch (e) { log.error('echo failed', e); } }
      for (const msg of value.messages || []) {
        if (!run('INSERT INTO processed_events (id) VALUES (?) ON CONFLICT DO NOTHING', msg.id).changes) continue; // duplicate
        const profileName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;
        enqueue(`${b.id}:${msg.from}`, async () => {
          clientFor(b).markRead(msg.id).catch(() => {});
          await handleIncoming(b, { from: msg.from, profileName, message: msg });
        }).catch((e) => log.error('handler error', e));
      }
    }
  }
});

export default r;
export { enqueue };
