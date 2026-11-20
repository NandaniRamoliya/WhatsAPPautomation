// ORDERING flow: categories -> items -> quantity -> cart -> delivery/pickup ->
// address -> notes -> payment (COD / UPI page / Razorpay link) -> confirmation.
import * as B from '../../whatsapp/builders.js';
import { money, clip } from '../../lib/util.js';
import { fmtDate } from '../../lib/time.js';
import { categories, productsIn, product, search } from '../../services/catalog.js';
import {
  totals, refreshCart, createOrder, lineText, paymentLabel, fulfilmentLine, ownerOrderAlert, recentOrders, getOrder,
} from '../../services/orders.js';
import { payPageUrl, createRazorpayLink, razorpayEnabled } from '../../services/payments.js';
import { setCustomerField } from '../../services/customers.js';
import { parseOrderText, aiEnabled } from '../../services/ai.js';
import { log } from '../../lib/logger.js';
import { get } from '../../db/index.js';

const cur = (c, v) => money(v, c.biz.currency);
const enc = (s) => encodeURIComponent(s).slice(0, 150);

export const ordering = {
  module: 'ordering',
  prefix: 'ord',
  states: ['ORD_BROWSE', 'ORD_QTY', 'ORD_CART', 'ORD_FULFIL', 'ORD_ADDRESS', 'ORD_NOTES', 'ORD_PAY'],

  menuItems(c) {
    return [
      { id: 'ord:start', title: c.t('menu_order'), description: c.t('menu_order_desc') },
      { id: 'ord:my', title: c.t('menu_my_orders'), description: c.t('menu_my_orders_desc') },
    ];
  },

  async onChoice(c, [action, a1, a2]) {
    switch (action) {
      case 'start': case 'more': return showCategories(c, 0);
      case 'cats': return showCategories(c, Number(a1) || 0);
      case 'cat': return showProducts(c, decodeURIComponent(a1), Number(a2) || 0);
      case 'p': return askQty(c, Number(a1));
      case 'q': return addToCart(c, Number(a1));
      case 'cart': return showCart(c);
      case 'clear': c.cart = []; c.reset(); return c.buttons(c.t('cart_cleared'), [{ id: 'ord:start', title: c.t('menu_order') }, { id: 'menu', title: c.t('btn_menu') }]);
      case 'checkout': return startCheckout(c);
      case 'ful': c.ctx.fulfil = a1 === 'pickup' ? 'pickup' : 'delivery'; return afterFulfilment(c);
      case 'addr':
        if (a1 === 'same') { c.ctx.address = c.customer.address; return afterAddress(c); }
        c.setState('ORD_ADDRESS'); return c.say(c.t('ask_address'));
      case 'notes': c.ctx.notes = ''; return askPayment(c);
      case 'pay': return placeOrder(c, a1);
      case 'my': return myOrders(c);
      case 'reorder': return reorder(c);
      default: return false;
    }
  },

  async onText(c) {
    const t = c.input.text;
    const kw = t.toLowerCase();
    if (['cart', 'my cart', 'view cart', 'cart dekho', 'basket'].includes(kw)) return showCart(c);
    if (['checkout', 'place order', 'done', 'order karo', 'bas'].includes(kw) && c.cart.length) return startCheckout(c);
    if (c.state === 'ORD_QTY') {
      if (/^\d{1,2}$/.test(t) && Number(t) > 0) return addToCart(c, Number(t));
      if (/^\d+$/.test(t)) return c.say(c.t('qty_invalid'));
    }
    if (c.state === 'ORD_ADDRESS') {
      if (t.length < 10) return c.say(c.t('address_too_short'));
      c.ctx.address = t;
      setCustomerField(c.customer.id, 'address', t);
      c.customer.address = t;
      return afterAddress(c);
    }
    if (c.state === 'ORD_NOTES') { c.ctx.notes = t.slice(0, 500); return askPayment(c); }
    // Anything else typed while shopping = product search / AI understanding
    return this.onFreeText(c, true);
  },

  async onLocation(c) {
    if (c.state !== 'ORD_ADDRESS') return false;
    const l = c.input.location;
    const addr = [l.name, l.address].filter(Boolean).join(', ');
    c.ctx.address = `${addr ? `${addr} ` : ''}📍 https://maps.google.com/?q=${l.latitude},${l.longitude}`;
    setCustomerField(c.customer.id, 'address', c.ctx.address);
    c.customer.address = c.ctx.address;
    return afterAddress(c);
  },

  async onMedia(c) {
    if (!c.biz.settings.ordering.accept_prescriptions || !(c.state.startsWith('ORD_') || c.state === 'MENU')) return false;
    if (!['image', 'document'].includes(c.input.mediaType)) return false;
    c.ctx.attachments = [...(c.ctx.attachments || []), c.input.mediaId].slice(-5);
    c.needsAttention();
    await c.say(c.t('attachment_saved'));
    return c.cart.length ? showCart(c) : showCategories(c, 0);
  },

  /** Free text outside a step: AI order parsing (optional) -> keyword search. */
  async onFreeText(c, force = false) {
    const t = c.input.text || '';
    if (aiEnabled(c.biz, 'order_parsing') && t.split(/\s+/).length >= 2) {
      const parsed = await parseOrderText(c.biz, t).catch((e) => { log.warn('ai parse failed', { err: e.message }); return null; });
      if (parsed?.items?.length) {
        for (const it of parsed.items) mergeLine(c, product(c.biz.id, it.id), it.qty);
        await c.say(c.t('ai_cart_intro') + (parsed.unclear?.length ? `\n${c.t('ai_unclear', { items: parsed.unclear.join(', ') })}` : ''));
        return showCart(c);
      }
    }
    const found = search(c.biz.id, t);
    if (found.length) {
      c.setState('ORD_BROWSE');
      return c.pagedList(c.t('search_results', { query: clip(t, 40) }), c.t('items_button'), found.map((p) => productRow(c, p)));
    }
    if (force) { await c.say(c.t('search_none', { query: clip(t, 40) })); return showCategories(c, 0); }
    return false;
  },

  /** Order sent from WhatsApp's native catalogue (Commerce Manager). Product retailer id = our SKU or id. */
  async onNativeOrder(c) {
    for (const it of c.input.order?.product_items || []) {
      const id = String(it.product_retailer_id);
      const p = get(
        'SELECT * FROM products WHERE business_id = ? AND (sku = ? OR CAST(id AS TEXT) = ?) AND active = 1 AND in_stock = 1', c.biz.id, id, id);
      mergeLine(c, p, Number(it.quantity) || 1);
    }
    return showCart(c);
  },
};

function productRow(c, p) {
  return { id: `ord:p:${p.id}`, title: p.name, description: `${cur(c, p.price)} / ${p.unit}${p.description ? ` · ${p.description}` : ''}` };
}

async function showCategories(c, page) {
  const cats = categories(c.biz.id);
  if (!cats.length) { c.reset(); return c.buttons(c.t('no_products'), [{ id: 'menu', title: c.t('btn_menu') }, { id: 'human', title: c.t('menu_human') }]); }
  if (cats.length === 1) return showProducts(c, cats[0].category, 0);
  c.setState('ORD_BROWSE');
  const rows = cats.map((k) => ({ id: `ord:cat:${enc(k.category)}:0`, title: k.category, description: `${k.n} item${k.n > 1 ? 's' : ''}` }));
  return c.pagedList(c.t('choose_category'), c.t('categories_button'), rows, page, (n) => `ord:cats:${n}`);
}

async function showProducts(c, category, page) {
  const items = productsIn(c.biz.id, category);
  if (!items.length) return showCategories(c, 0);
  c.setState('ORD_BROWSE');
  return c.pagedList(c.t('choose_product', { category }), c.t('items_button'), items.map((p) => productRow(c, p)), page, (n) => `ord:cat:${enc(category)}:${n}`, clip(category, 24));
}

async function askQty(c, id) {
  const p = product(c.biz.id, id);
  if (!p || !p.active || !p.in_stock) { await c.say(c.t('out_of_stock', { product: p?.name || '' })); return showCategories(c, 0); }
  c.setState('ORD_QTY', { pending: p.id });
  if (c.biz.settings.ordering.show_images && p.image_url) await c.send(B.image(p.image_url, p.name));
  return c.buttons(c.t('ask_qty', { product: p.name, price: cur(c, p.price), unit: p.unit, description: p.description ? `\n${p.description}` : '' }),
    [1, 2, 5].map((n) => ({ id: `ord:q:${n}`, title: String(n) })));
}

function mergeLine(c, p, qty) {
  if (!p || !qty) return false;
  const line = c.cart.find((l) => l.id === p.id);
  if (line) line.qty = Math.min(99, line.qty + qty);
  else c.cart.push({ id: p.id, name: p.name, unit: p.unit, price: p.price, qty: Math.min(99, qty) });
  c.ctx.cartUpdatedAt = new Date().toISOString();
  delete c.ctx.nudged;
  return true;
}

async function addToCart(c, qty) {
  const p = product(c.biz.id, c.ctx.pending);
  if (!p || !p.in_stock || !p.active) { await c.say(c.t('out_of_stock', { product: p?.name || '' })); return showCategories(c, 0); }
  mergeLine(c, p, qty);
  c.setState('ORD_CART', { pending: undefined });
  const { subtotal } = totals(c.biz, c.cart, defaultFulfilment(c));
  return c.buttons(c.t('added', { qty, product: p.name, subtotal: cur(c, subtotal) }), [
    { id: 'ord:checkout', title: c.t('btn_checkout') },
    { id: 'ord:more', title: c.t('btn_add_more') },
    { id: 'ord:cart', title: c.t('btn_view_cart') },
  ]);
}

const defaultFulfilment = (c) => c.ctx.fulfil || (c.biz.settings.ordering.delivery ? 'delivery' : 'pickup');

async function syncCart(c) {
  const { cart, removed } = refreshCart(c.biz.id, c.cart);
  c.cart = cart;
  if (removed.length) await c.say(c.t('removed_unavailable', { items: removed.join(', ') }));
}

async function showCart(c) {
  await syncCart(c);
  if (!c.cart.length) {
    c.reset();
    return c.buttons(c.t('cart_empty'), [{ id: 'ord:start', title: c.t('menu_order') }, { id: 'menu', title: c.t('btn_menu') }]);
  }
  const o = c.biz.settings.ordering;
  const t = totals(c.biz, c.cart, defaultFulfilment(c));
  const deliveryLine = !o.delivery || defaultFulfilment(c) === 'pickup' ? '' : t.fee === 0 ? c.t('delivery_free')
    : c.t('delivery_fee_line', { fee: cur(c, t.fee), free_hint: o.free_delivery_above > 0 ? c.t('free_hint', { amount: cur(c, o.free_delivery_above) }) : '' });
  c.setState('ORD_CART');
  return c.buttons(c.t('cart', { lines: lineText(c.biz, c.cart), subtotal: cur(c, t.subtotal), delivery_line: deliveryLine, total: cur(c, t.total) }), [
    { id: 'ord:checkout', title: c.t('btn_checkout') },
    { id: 'ord:more', title: c.t('btn_add_more') },
    { id: 'ord:clear', title: c.t('btn_clear_cart') },
  ]);
}

async function startCheckout(c) {
  await syncCart(c);
  if (!c.cart.length) return showCart(c);
  const o = c.biz.settings.ordering;
  const { subtotal } = totals(c.biz, c.cart, 'pickup');
  if (o.min_order > 0 && subtotal < o.min_order) {
    return c.buttons(c.t('min_order', { min: cur(c, o.min_order) }), [{ id: 'ord:more', title: c.t('btn_add_more') }, { id: 'ord:cart', title: c.t('btn_view_cart') }]);
  }
  if (o.delivery && o.pickup) {
    c.setState('ORD_FULFIL');
    return c.buttons(c.t('ask_fulfilment'), [{ id: 'ord:ful:delivery', title: c.t('btn_delivery') }, { id: 'ord:ful:pickup', title: c.t('btn_pickup') }]);
  }
  c.ctx.fulfil = o.delivery ? 'delivery' : 'pickup';
  return afterFulfilment(c);
}

async function afterFulfilment(c) {
  if (c.ctx.fulfil === 'pickup') return afterAddress(c);
  c.setState('ORD_ADDRESS');
  if (c.customer.address) {
    return c.buttons(c.t('confirm_address', { address: c.customer.address }), [
      { id: 'ord:addr:same', title: c.t('btn_same_address') }, { id: 'ord:addr:new', title: c.t('btn_new_address') },
    ]);
  }
  return c.say(c.t('ask_address'));
}

async function afterAddress(c) {
  if (c.biz.settings.ordering.ask_notes) {
    c.setState('ORD_NOTES');
    return c.buttons(c.t('ask_notes'), [{ id: 'ord:notes:skip', title: c.t('btn_skip') }]);
  }
  return askPayment(c);
}

function paymentModes(biz) {
  const o = biz.settings.ordering;
  const modes = (o.payment_modes || []).filter((m) => (m === 'upi' ? Boolean(o.upi_id) : m === 'online' ? razorpayEnabled(biz) : m === 'cod'));
  return modes.length ? modes : ['cod'];
}

async function askPayment(c) {
  const modes = paymentModes(c.biz);
  if (modes.length === 1) return placeOrder(c, modes[0]);
  const t = totals(c.biz, c.cart, c.ctx.fulfil || defaultFulfilment(c));
  c.setState('ORD_PAY');
  const label = { cod: c.t(c.ctx.fulfil === 'pickup' ? 'btn_pay_cod_pickup' : 'btn_pay_cod'), upi: c.t('btn_pay_upi'), online: c.t('btn_pay_online') };
  return c.buttons(c.t('ask_payment', { total: cur(c, t.total) }), modes.map((m) => ({ id: `ord:pay:${m}`, title: label[m] })));
}

async function placeOrder(c, mode) {
  if (!paymentModes(c.biz).includes(mode)) return askPayment(c);
  await syncCart(c);
  if (!c.cart.length) return showCart(c);
  const fulfil = c.ctx.fulfil || defaultFulfilment(c);
  const attachments = c.ctx.attachments?.length ? `[${c.ctx.attachments.length} photo/document(s) sent in chat]` : '';
  const order = createOrder(c.biz, {
    phone: c.phone, customerName: c.customer.name, cart: c.cart, fulfilment: fulfil,
    address: fulfil === 'delivery' ? c.ctx.address || c.customer.address : null,
    notes: [c.ctx.notes, attachments].filter(Boolean).join(' ') || null, paymentMode: mode,
  });
  c.cart = [];
  c.reset();
  const vars = { order_no: order.order_no, lines: lineText(c.biz, order.items), total: cur(c, order.total), eta: c.biz.settings.ordering.eta_text };

  if (mode === 'cod') {
    await c.say(c.t('order_placed', { ...vars, payment: paymentLabel(c.biz, order), fulfilment: fulfilmentLine(c.biz, order) }));
    await ownerOrderAlert(c.biz, order);
    return true;
  }
  if (mode === 'online') {
    try {
      const url = await createRazorpayLink(c.biz, order);
      return c.cta(c.t('order_pay_link', vars), c.t('btn_pay_now'), url);
    } catch (e) {
      log.error('razorpay link failed', { err: e.message, order: order.id });
      if (!c.biz.settings.ordering.upi_id) { await c.say(c.t('error')); return ownerOrderAlert(c.biz, getOrder(c.biz.id, order.id)); }
    }
  }
  // UPI (manual): owner is alerted now and taps "Mark paid" after checking the bank app.
  await c.cta(c.t('order_pay_link', vars), c.t('btn_pay_now'), payPageUrl(order));
  return ownerOrderAlert(c.biz, order);
}

async function myOrders(c) {
  const list = recentOrders(c.biz.id, c.phone, 3);
  if (!list.length) return c.buttons(c.t('my_orders_none'), [{ id: 'ord:start', title: c.t('menu_order') }, { id: 'menu', title: c.t('btn_menu') }]);
  const lines = list.map((o) => `#${o.order_no} · ${fmtDate(o.created_at, c.biz.timezone)} · ${cur(c, o.total)} · ${o.status.replace(/_/g, ' ').toLowerCase()}`).join('\n');
  return c.buttons(c.t('my_orders', { lines }), [
    { id: 'ord:reorder', title: c.t('btn_reorder') }, { id: 'ord:start', title: c.t('menu_order') }, { id: 'menu', title: c.t('btn_menu') },
  ]);
}

async function reorder(c) {
  const [last] = recentOrders(c.biz.id, c.phone, 1);
  if (!last) return myOrders(c);
  for (const l of last.items) mergeLine(c, product(c.biz.id, l.id), l.qty);
  await c.say(c.t('reorder_added'));
  return showCart(c);
}
