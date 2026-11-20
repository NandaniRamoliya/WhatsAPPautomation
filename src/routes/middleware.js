import { get, run, now } from '../db/index.js';
import { signToken, verifyToken } from '../lib/crypto.js';
import { HttpError } from '../lib/util.js';
import { getBusiness } from '../services/business.js';
import { config } from '../config.js';

export const COOKIE = 'wak_session';
const TTL = 7 * 24 * 3600;

export function setSessionCookie(res, user) {
  const token = signToken({ uid: user.id }, TTL);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.publicUrl.startsWith('https'), maxAge: TTL * 1000, path: '/' });
}

export const clearSessionCookie = (res) => res.clearCookie(COOKIE, { path: '/' });

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Loads req.user; for API mutations requires the X-Requested-With header (CSRF protection). */
export function auth(req, _res, next) {
  const payload = verifyToken(readCookie(req, COOKIE));
  const user = payload && get('SELECT id, business_id, email, name, role, active FROM users WHERE id = ?', payload.uid);
  if (!user || !user.active) throw new HttpError(401, 'Please log in');
  if (req.method !== 'GET' && req.get('x-requested-with') !== 'wak') throw new HttpError(403, 'Missing request header');
  req.user = user;
  next();
}

/** Resolves req.biz: business users -> their business; super-admin -> X-Business-Id header. */
export function business(req, _res, next) {
  let id = req.user.business_id;
  if (req.user.role === 'superadmin') id = Number(req.get('x-business-id')) || null;
  if (!id) throw new HttpError(400, 'Select a business first');
  const biz = getBusiness(id);
  if (!biz) throw new HttpError(404, 'Business not found');
  req.biz = biz;
  next();
}

export const role = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) throw new HttpError(403, 'Not allowed for your role');
  next();
};

export function audit(req, action, details = {}) {
  run('INSERT INTO audit_log (business_id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)',
    req.biz?.id || null, req.user?.id || null, action, JSON.stringify(details), now());
}

// Tiny in-memory rate limiter (per IP + key)
const hits = new Map();
export const rateLimit = (key, max, windowMs) => (req, _res, next) => {
  const k = `${key}:${req.ip}`;
  const t = Date.now();
  const arr = (hits.get(k) || []).filter((x) => t - x < windowMs);
  arr.push(t);
  hits.set(k, arr);
  if (arr.length > max) throw new HttpError(429, 'Too many attempts, please wait a few minutes');
  next();
};
