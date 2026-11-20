// Public (no login) routes: health check, UPI pay page, Razorpay webhook, QR/short links.
import express from 'express';
import QRCode from 'qrcode';
import { run } from '../db/index.js';
import { log } from '../lib/logger.js';
import { getBusiness, getBusinessBySlug, waLink } from '../services/business.js';
import { getOrderByToken, confirmPayment } from '../services/orders.js';
import { payPageHtml, verifyRazorpaySignature } from '../services/payments.js';

const r = express.Router();

r.get('/health', (_req, res) => res.type('text/plain').send('ok'));

r.get('/pay/:token', async (req, res) => {
  const order = getOrderByToken(req.params.token);
  if (!order) return res.status(404).type('text/plain').send('Payment link not found or expired.');
  const biz = getBusiness(order.business_id);
  res.set('Cache-Control', 'no-store').type('html').send(await payPageHtml(biz, order));
});

// Razorpay -> "payment_link.paid" webhook. Configure URL: PUBLIC_URL/webhooks/razorpay/<business id>
r.post('/webhooks/razorpay/:bizId', async (req, res) => {
  const biz = getBusiness(Number(req.params.bizId));
  if (!biz || !verifyRazorpaySignature(biz, req.rawBody || '', req.get('x-razorpay-signature'))) return res.sendStatus(401);
  res.sendStatus(200);
  try {
    const eventId = req.get('x-razorpay-event-id') || `${req.body?.event}:${req.body?.payload?.payment_link?.entity?.id}`;
    if (!run('INSERT INTO processed_events (id) VALUES (?) ON CONFLICT DO NOTHING', `rzp:${eventId}`).changes) return;
    if (req.body?.event === 'payment_link.paid') {
      const ent = req.body.payload.payment_link.entity;
      const [bizId, orderId] = String(ent.reference_id).split('-').map(Number);
      if (bizId === biz.id) await confirmPayment(biz, orderId, req.body.payload.payment?.entity?.id || ent.id);
    }
  } catch (e) { log.error('razorpay webhook error', e); }
});

// Short link for posters/QR: /q/<slug> -> opens WhatsApp chat with "Hi" pre-filled
r.get('/q/:slug', (req, res) => {
  const biz = getBusinessBySlug(req.params.slug);
  const link = biz && waLink(biz, req.query.text || 'Hi');
  if (!link) return res.status(404).type('text/plain').send('This business has not connected WhatsApp yet.');
  res.redirect(link);
});

r.get('/q/:slug/qr.png', async (req, res) => {
  const biz = getBusinessBySlug(req.params.slug);
  const link = biz && waLink(biz, 'Hi');
  if (!link) return res.sendStatus(404);
  res.type('png').send(await QRCode.toBuffer(link, { width: Number(req.query.size) || 600, margin: 2 }));
});

export default r;
