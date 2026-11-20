import { config } from '../config.js';

const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', PKR: 'Rs ', BDT: '৳', NPR: 'Rs ', LKR: 'Rs ', SAR: 'SAR ' };

/** Minor units -> "₹1,250" / "₹99.50" */
export function money(minor, currency = 'INR') {
  const n = Number(minor || 0) / 100;
  const s = n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  return `${SYMBOLS[currency] ?? `${currency} `}${s}`;
}

/** "125.5" / "₹1,250" -> minor units integer */
export function toMinor(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Math.round(v * 100);
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Normalise a phone to WhatsApp format: digits only, with country code, no "+". */
export function normalizePhone(raw, cc = config.defaultCountryCode) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = cc + d.slice(1);
  if (d.length === 10 && cc) d = cc + d;
  return d;
}

export const clip = (s, n) => {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** Replace {placeholders} with values. Unknown placeholders become empty. */
export const fill = (tpl, vars = {}) => String(tpl ?? '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '').toString());

export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'business';

export function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? base : over;
  if (base && typeof base === 'object' && over && typeof over === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

/** Minimal RFC-4180 CSV parser -> array of objects keyed by lower-cased header. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!clean.length) return [];
  const head = clean[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return clean.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
}

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
