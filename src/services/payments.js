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
