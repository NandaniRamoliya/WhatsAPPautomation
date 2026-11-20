import { all, get, run, insert, tx, parseJson, now } from '../db/index.js';
import { randomToken } from '../lib/crypto.js';
import { money } from '../lib/util.js';
import { text } from '../engine/texts.js';
import * as B from '../whatsapp/builders.js';
import { send } from '../whatsapp/sender.js';
import { notifyOwner } from './notify.js';
import { slotTemplate } from './templates.js';
import { getCustomer, firstName } from './customers.js';

export const ORDER_STATUSES = ['NEW', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];

export const subtotalOf = (cart) => cart.reduce((a, l) => a + l.price * l.qty, 0);

export function deliveryFeeFor(biz, subtotal, fulfilment = 'delivery') {
  const o = biz.settings.ordering;
  if (fulfilment === 'pickup' || !o.delivery) return 0;
  return o.free_delivery_above > 0 && subtotal >= o.free_delivery_above ? 0 : Number(o.delivery_fee || 0);
}

export function totals(biz, cart, fulfilment) {
  const subtotal = subtotalOf(cart);
  const fee = deliveryFeeFor(biz, subtotal, fulfilment);
  return { subtotal, fee, total: subtotal + fee };
}

export const lineText = (biz, items) => items.map((l) => `• ${l.name} × ${l.qty} – ${money(l.price * l.qty, biz.currency)}`).join('\n');

/** Re-price cart lines from the database and drop anything no longer sold. */
export function refreshCart(bizId, cart) {
  const removed = [];
  const fresh = [];
  for (const l of cart) {
    const p = get('SELECT * FROM products WHERE business_id = ? AND id = ? AND active = 1 AND in_stock = 1', bizId, l.id);
    if (!p) { removed.push(l.name); continue; }
    fresh.push({ id: p.id, name: p.name, unit: p.unit, price: p.price, qty: l.qty });
  }
  return { cart: fresh, removed };
}

export function getOrder(bizId, id) {
  return parseJson(get('SELECT * FROM orders WHERE business_id = ? AND id = ?', bizId, Number(id)), ['items']);
}

export const getOrderByToken = (token) => parseJson(get('SELECT * FROM orders WHERE pay_token = ?', token), ['items']);

export function createOrder(biz, { phone, customerName, cart, fulfilment, address, notes, paymentMode }) {
  const t = totals(biz, cart, fulfilment);
  const customer = getCustomer(biz.id, phone);
  const cod = paymentMode === 'cod';
  const id = tx(() => {
    const { n } = get('SELECT COALESCE(MAX(order_no), 1000) + 1 AS n FROM orders WHERE business_id = ?', biz.id);
    return insert('orders', {
      business_id: biz.id, order_no: n, customer_id: customer?.id, phone, customer_name: customerName || customer?.name,
      items: JSON.stringify(cart), subtotal: t.subtotal, delivery_fee: t.fee, total: t.total, fulfilment,
      address: address || null, notes: notes || null, payment_mode: paymentMode,
      payment_status: cod ? 'COD' : 'PENDING', status: cod ? 'CONFIRMED' : 'NEW', pay_token: randomToken(18),
      created_at: now(), updated_at: now(),
    });
  });
  if (customer) run('UPDATE customers SET last_order_at = ? WHERE id = ?', now(), customer.id);
  return getOrder(biz.id, id);
}

export function paymentLabel(biz, order) {
  if (order.payment_mode === 'cod') return text(biz, order.fulfilment === 'pickup' ? 'pay_cod_pickup' : 'pay_cod');
  return text(biz, order.payment_mode === 'upi' ? 'pay_upi' : 'pay_online') + (order.payment_status === 'PAID' ? ' ✅' : '');
}

export function fulfilmentLine(biz, order) {
  return order.fulfilment === 'pickup'
    ? text(biz, 'fulfil_pickup', { address: biz.address || biz.name })
    : text(biz, 'fulfil_delivery', { address: order.address || '-' });
}

export function ownerOrderAlert(biz, order) {
  return notifyOwner(biz, text(biz, 'owner_new_order', {
    order_no: order.order_no, customer: order.customer_name || 'Customer', phone: order.phone,
    lines: lineText(biz, order.items), total: money(order.total, biz.currency), payment: paymentLabel(biz, order),
    fulfilment: fulfilmentLine(biz, order),
  }));
}

/** Idempotent: only acts when the order is still NEW. Safe for double webhooks / double clicks. */
export async function confirmPayment(biz, orderId, ref = null) {
  const changed = run(`UPDATE orders SET status = 'CONFIRMED', payment_status = 'PAID', payment_ref = COALESCE(?, payment_ref), updated_at = ?
                       WHERE business_id = ? AND id = ? AND status = 'NEW'`, ref, now(), biz.id, Number(orderId)).changes;
  if (!changed) return false;
  const order = getOrder(biz.id, orderId);
  await send(biz, order.phone, B.text(text(biz, 'order_paid', {
    order_no: order.order_no, lines: lineText(biz, order.items), total: money(order.total, biz.currency), eta: biz.settings.ordering.eta_text,
  })), { fallbackTemplate: slotTemplate(biz, 'order_update', [firstName(order.customer_name) || 'there', `Payment received, order #${order.order_no} is confirmed.`]) });
  await ownerOrderAlert(biz, order);
  return true;
}

/** Move an order to a new status and tell the customer. */
export async function setOrderStatus(biz, orderId, status, { reason } = {}) {
  if (!ORDER_STATUSES.includes(status)) throw new Error('invalid status');
  const order = getOrder(biz.id, orderId);
  if (!order) throw new Error('order not found');
  if (order.status === status) return order;
  run('UPDATE orders SET status = ?, cancel_reason = COALESCE(?, cancel_reason), updated_at = ? WHERE id = ?', status, reason || null, now(), order.id);
  const msg = text(biz, `order_status_${status}`, {
    order_no: order.order_no,
    cod_note: order.payment_status === 'COD' ? text(biz, 'cod_note', { total: money(order.total, biz.currency) }) : '',
    reason: reason ? ` ${reason}` : '',
  });
  await send(biz, order.phone, B.text(msg), {
    fallbackTemplate: slotTemplate(biz, 'order_update', [firstName(order.customer_name) || 'there', msg]),
  });
  return getOrder(biz.id, order.id);
}

export async function markPaidManually(biz, orderId) {
  const order = getOrder(biz.id, orderId);
  if (!order) throw new Error('order not found');
  if (order.status === 'NEW') return confirmPayment(biz, orderId, 'manual');
  run(`UPDATE orders SET payment_status = 'PAID', payment_ref = COALESCE(payment_ref, 'manual'), updated_at = ? WHERE id = ?`, now(), order.id);
  return true;
}

export const recentOrders = (bizId, phone, n = 3) =>
  all('SELECT * FROM orders WHERE business_id = ? AND phone = ? ORDER BY id DESC LIMIT ?', bizId, phone, n).map((o) => parseJson(o, ['items']));
