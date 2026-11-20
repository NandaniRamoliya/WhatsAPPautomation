// Payments: UPI deep-link page (free, manual confirmation) and Razorpay
// payment links (automatic confirmation by signed webhook).
import QRCode from 'qrcode';
import { config } from '../config.js';
import { decrypt, hmacHex, safeEqual } from '../lib/crypto.js';
import { escapeHtml, money } from '../lib/util.js';

export function upiUri(biz, order) {
  const s = biz.settings.ordering;
  const p = new URLSearchParams({
    pa: s.upi_id, pn: s.upi_name || biz.name, am: (order.total / 100).toFixed(2), cu: biz.currency || 'INR',
    tn: `Order ${order.order_no} ${biz.name}`.slice(0, 50),
  });
  return `upi://pay?${p.toString().replace(/\+/g, '%20')}`;
}

export const payPageUrl = (order) => `${config.publicUrl}/pay/${order.pay_token}`;

export async function payPageHtml(biz, order) {
  const paid = order.payment_status === 'PAID';
  const uri = upiUri(biz, order);
  const qr = paid ? '' : await QRCode.toDataURL(uri, { margin: 1, width: 260 });
  const amount = money(order.total, biz.currency);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay ${escapeHtml(biz.name)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f5;margin:0;padding:24px;color:#14261c}
.card{max-width:380px;margin:auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center}
h1{font-size:34px;margin:8px 0}.muted{color:#5d6b63;font-size:14px}.btn{display:block;background:#128c4a;color:#fff;padding:16px;border-radius:12px;text-decoration:none;font-weight:600;margin:18px 0}
.ok{background:#e7f6ed;color:#0d6b37;padding:14px;border-radius:12px;font-weight:600}img{margin:8px auto;display:block}</style></head>
<body><div class="card"><div class="muted">${escapeHtml(biz.name)}</div><div>Order #${order.order_no}</div><h1>${amount}</h1>
${paid ? '<div class="ok">✅ Payment received. Thank you!</div>' : `
<a class="btn" href="${escapeHtml(uri)}">Pay with any UPI app</a>
<div class="muted">or scan this QR from another phone</div><img src="${qr}" width="220" height="220" alt="UPI QR">
<div class="muted">UPI ID: <b>${escapeHtml(biz.settings.ordering.upi_id)}</b></div>
<p class="muted">After paying, ${escapeHtml(biz.name)} will confirm your order on WhatsApp.</p>`}
</div></body></html>`;
}

export const razorpayEnabled = (biz) => Boolean(biz.settings.ordering.razorpay_key_id && biz.settings.ordering.razorpay_key_secret_enc);

/** Create a Razorpay payment link; returns short_url. */
export async function createRazorpayLink(biz, order) {
  const s = biz.settings.ordering;
  const auth = Buffer.from(`${s.razorpay_key_id}:${decrypt(s.razorpay_key_secret_enc)}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: order.total, currency: biz.currency || 'INR', reference_id: `${biz.id}-${order.id}`,
      description: `Order #${order.order_no} - ${biz.name}`.slice(0, 2048),
      customer: { contact: `+${order.phone}`, ...(order.customer_name ? { name: order.customer_name } : {}) },
      notify: { sms: false, email: false }, reminder_enable: false,
      notes: { business_id: String(biz.id), order_id: String(order.id) },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.description || `Razorpay error ${res.status}`);
  return data.short_url;
}

export function verifyRazorpaySignature(biz, rawBody, signature) {
  const secret = decrypt(biz.settings.ordering.razorpay_webhook_secret_enc);
  if (!secret || !signature) return false;
  return safeEqual(hmacHex(secret, rawBody), signature);
}

// ---------------- Stripe Checkout (cards, Apple Pay, Google Pay - international) ----------------
export const stripeEnabled = (biz) => Boolean(biz.settings.ordering.stripe_secret_key_enc);

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'UGX', 'XAF', 'XOF', 'RWF', 'KMF', 'GNF', 'MGA', 'BIF', 'DJF', 'VUV', 'XPF']);

/** Create a Stripe Checkout Session for an order; returns the hosted payment URL. */
export async function createStripeCheckout(biz, order) {
  const key = decrypt(biz.settings.ordering.stripe_secret_key_enc);
  const cur = (biz.currency || 'INR').toUpperCase();
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('success_url', `${config.publicUrl}/paid/${order.pay_token}`);
  p.set('cancel_url', `${config.publicUrl}/paid/${order.pay_token}`);
  p.set('client_reference_id', `${biz.id}-${order.id}`);
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', cur.toLowerCase());
  p.set('line_items[0][price_data][unit_amount]', String(ZERO_DECIMAL.has(cur) ? Math.round(order.total / 100) : order.total));
  p.set('line_items[0][price_data][product_data][name]', `Order #${order.order_no} – ${biz.name}`.slice(0, 250));
  p.set('metadata[business_id]', String(biz.id));
  p.set('metadata[order_id]', String(order.id));
  p.set('payment_intent_data[metadata][order_id]', String(order.id));
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: p, signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  return data.url;
}

/** Verify the Stripe-Signature header (t=...,v1=...) against the raw body, 5 minute tolerance. */
export function verifyStripeSignature(biz, rawBody, header, nowSec = Math.floor(Date.now() / 1000)) {
  const secret = decrypt(biz.settings.ordering.stripe_webhook_secret_enc);
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((kv) => kv.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = String(header).split(',').filter((kv) => kv.trim().startsWith('v1=')).map((kv) => kv.trim().slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(nowSec - t) > 300 || !sigs.length) return false;
  const expected = hmacHex(secret, `${t}.${rawBody}`);
  return sigs.some((s) => safeEqual(s, expected));
}

// ---------------- Generic payment link (PayPal.me, Instamojo, bank page...) ----------------
export const payLinkEnabled = (biz) => Boolean(biz.settings.ordering.pay_link_template);
export function payLinkFor(biz, order) {
  const amount = (order.total / 100).toFixed(2);
  return biz.settings.ordering.pay_link_template
    .replace(/\{amount\}/g, amount).replace(/\{order_no\}/g, String(order.order_no))
    .replace(/\{currency\}/g, biz.currency || 'INR').replace(/\{phone\}/g, order.phone);
}

/** Small status page shown after card / link payments. */
export function paidPageHtml(biz, order) {
  const paid = order.payment_status === 'PAID';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(biz.name)}</title><style>body{font-family:system-ui,sans-serif;background:#f4f6f5;margin:0;padding:24px;color:#14261c}
.card{max-width:380px;margin:auto;background:#fff;border-radius:16px;padding:28px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.big{font-size:44px}.muted{color:#5d6b63}</style></head><body><div class="card">
<div class="big">${paid ? '✅' : '⏳'}</div><h2>${paid ? 'Payment received' : 'Confirming your payment…'}</h2>
<p class="muted">${escapeHtml(biz.name)} · Order #${order.order_no} · ${money(order.total, biz.currency)}</p>
<p>${paid ? 'Thank you! Your order confirmation is on WhatsApp.' : 'You will get a confirmation on WhatsApp as soon as the payment is confirmed. You can close this page.'}</p>
</div></body></html>`;
}
