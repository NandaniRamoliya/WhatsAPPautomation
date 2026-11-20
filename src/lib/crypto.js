// Encryption at rest, password hashing and signed tokens - Node crypto only.
import crypto from 'node:crypto';
import { config } from '../config.js';

const key = crypto.createHash('sha256').update(config.encryptionKey).digest(); // 32 bytes

/** AES-256-GCM encrypt -> "v1:iv:tag:ciphertext" (base64url). Empty -> null. */
export function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join(':');
}

export function decrypt(blob) {
  if (!blob) return '';
  try {
    const [v, iv, tag, data] = blob.split(':');
    if (v !== 'v1') return '';
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return ''; // wrong ENCRYPTION_KEY or corrupted value
  }
}

/** Show only the last 4 characters of a secret. */
export const mask = (s) => (s ? `••••••${String(s).slice(-4)}` : '');

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64url'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, expected);
}

const hmac = (data) => crypto.createHmac('sha256', config.sessionSecret).update(data).digest('base64url');

/** Signed, expiring token: base64url(json).signature */
export function signToken(payload, ttlSeconds) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${hmac(body)}`;
}

export function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = hmac(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

export const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
