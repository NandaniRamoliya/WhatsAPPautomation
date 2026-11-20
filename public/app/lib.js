// Shared front-end helpers: rendering, API calls, formatting, small hooks.
import { h, createContext } from 'preact';
import { useState, useEffect, useCallback, useContext, useRef } from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// ---------- API ----------
export const store = {
  get bizId() { try { return localStorage.getItem('wak_biz') || ''; } catch { return ''; } },
  set bizId(v) { try { v ? localStorage.setItem('wak_biz', v) : localStorage.removeItem('wak_biz'); } catch { /* private mode */ } },
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'wak', ...(store.bizId ? { 'x-business-id': store.bizId } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') { window.dispatchEvent(new Event('wak:logout')); }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const download = (path) => {
  const a = document.createElement('a');
  a.href = `/api${path}`;
  a.download = '';
  // business header can't be sent on a plain link -> pass via fetch + blob
  fetch(`/api${path}`, { headers: { 'x-business-id': store.bizId } }).then((r) => r.blob()).then((b) => {
    a.href = URL.createObjectURL(b);
    a.download = path.split('/').pop().replace('-export', '');
    a.click();
  }).catch((e) => toast(e.message, 'error'));
};

/** Load data with loading / error / reload. */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!path) return;
    try { setState((s) => ({ ...s, loading: true })); setState({ data: await api(path), error: null, loading: false }); } catch (e) { setState({ data: null, error: e.message, loading: false }); }
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

export function useInterval(fn, ms) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => { const t = setInterval(() => ref.current(), ms); return () => clearInterval(t); }, [ms]);
}

// ---------- toast ----------
export function toast(message, type = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3500);
  setTimeout(() => el.remove(), 4000);
}

/** Wrap an async action: shows success / error toast. */
export async function act(fn, success) {
  try { const r = await fn(); if (success) toast(success); return r; } catch (e) { toast(e.message, 'error'); return null; }
}

// ---------- formatting ----------
const SYM = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', PKR: 'Rs ' };
export const money = (minor, cur = 'INR') => `${SYM[cur] ?? `${cur} `}${(Number(minor || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const toMinor = (v) => Math.round(parseFloat(String(v).replace(/[^0-9.]/g, '') || '0') * 100);
export const fromMinor = (v) => (v === null || v === undefined || v === '' ? '' : String(Number(v) / 100));

export function fmtDateTime(iso, tz, opts = {}) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', ...opts }).format(new Date(iso));
}
export const fmtTime = (iso, tz) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const ymdIn = (tz, d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export function addDays(ymd, n) { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }

export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const phoneFmt = (p) => (String(p).startsWith('sim') ? 'Test chat' : `+${p}`);
export const titleCase = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function beep() {
  try {
    const c = new AudioContext();
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = 880; g.gain.value = 0.15;
    o.connect(g); g.connect(c.destination); o.start();
    setTimeout(() => { o.frequency.value = 1320; }, 150);
    setTimeout(() => { o.stop(); c.close(); }, 350);
  } catch { /* audio blocked until the user interacts */ }
}
