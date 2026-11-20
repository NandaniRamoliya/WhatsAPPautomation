// Creating businesses and users (used by the dashboard, the CLI setup and the demo seed).
import { get, insert, run } from '../db/index.js';
import { hashPassword } from '../lib/crypto.js';
import { slugify, deepMerge, HttpError } from '../lib/util.js';
import { config } from '../config.js';
import { PRESETS, loadSampleData } from '../presets/index.js';
import { getBusiness, saveBusiness } from './business.js';

export function uniqueSlug(name) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; get('SELECT 1 FROM businesses WHERE slug = ?', slug); i++) slug = `${base}-${i}`;
  return slug;
}

export function createBusiness({ name, preset = 'generic', sampleData = true, ...rest }) {
  if (!name?.trim()) throw new HttpError(400, 'Business name is required');
  const p = PRESETS[preset] ? preset : 'generic';
  const id = insert('businesses', {
    slug: uniqueSlug(name), name: name.trim(), preset: p, modules: JSON.stringify(PRESETS[p].modules),
    settings: JSON.stringify(PRESETS[p].settings || {}), timezone: rest.timezone || config.defaultTimezone,
    currency: rest.currency || config.defaultCurrency, language: rest.language || 'en',
    owner_phone: rest.owner_phone || null, owner_email: rest.owner_email || null,
  });
  if (sampleData) loadSampleData(id, p);
  return getBusiness(id);
}

/** Re-apply a preset to an existing business (modules + settings merged, data optional). */
export function applyPreset(bizId, preset, sampleData) {
  const p = PRESETS[preset];
  if (!p) throw new HttpError(400, 'Unknown preset');
  const biz = getBusiness(bizId);
  const raw = JSON.parse(get('SELECT settings FROM businesses WHERE id = ?', bizId).settings || '{}');
  saveBusiness(bizId, { preset, modules: p.modules, settings: deepMerge(raw, p.settings || {}) });
  if (sampleData) loadSampleData(bizId, preset);
  return getBusiness(biz.id);
}

export function createUser({ email, password, name = '', role = 'owner', businessId = null }) {
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Valid email required');
  if (!password || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (get('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'A user with this email already exists');
  return insert('users', { email: email.trim(), password_hash: hashPassword(password), name, role, business_id: businessId });
}

export function setPassword(userId, password) {
  if (!password || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), userId);
}

/** First boot: create the agency super-admin from ADMIN_EMAIL / ADMIN_PASSWORD. */
export function ensureSuperAdmin() {
  if (get('SELECT 1 FROM users LIMIT 1')) return null;
  const password = config.adminPassword || Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6).toUpperCase();
  createUser({ email: config.adminEmail, password, name: 'Admin', role: 'superadmin' });
  return { email: config.adminEmail, password, generated: !config.adminPassword };
}
