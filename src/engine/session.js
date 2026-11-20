import { get, run, parseJson, now } from '../db/index.js';

export function loadSession(bizId, phone) {
  run('INSERT INTO sessions (business_id, phone) VALUES (?, ?) ON CONFLICT DO NOTHING', bizId, phone);
  const s = parseJson(get('SELECT * FROM sessions WHERE business_id = ? AND phone = ?', bizId, phone), ['cart', 'ctx']);
  s.cart = Array.isArray(s.cart) ? s.cart : [];
  s.ctx = s.ctx && typeof s.ctx === 'object' ? s.ctx : {};
  return s;
}

export function saveSession(s) {
  run(`UPDATE sessions SET state = ?, cart = ?, ctx = ?, bot_paused_until = ?, needs_attention = ?, updated_at = ?
       WHERE business_id = ? AND phone = ?`,
  s.state, JSON.stringify(s.cart), JSON.stringify(s.ctx), s.bot_paused_until || null, s.needs_attention ? 1 : 0, now(), s.business_id, s.phone);
}

export const isPaused = (s) => Boolean(s.bot_paused_until && Date.parse(s.bot_paused_until) > Date.now());

export function pauseBot(bizId, phone, hours) {
  run(`UPDATE sessions SET bot_paused_until = ?, needs_attention = 1, state = 'MENU' WHERE business_id = ? AND phone = ?`,
    new Date(Date.now() + hours * 3600_000).toISOString(), bizId, phone);
}

export function resumeBot(bizId, phone) {
  run('UPDATE sessions SET bot_paused_until = NULL, needs_attention = 0 WHERE business_id = ? AND phone = ?', bizId, phone);
}
