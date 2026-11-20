import { useState } from 'preact/hooks';
import { html, api, act, useApi, useApp, useInterval, fmtDateTime, phoneFmt, download } from '../lib.js';
import { Page, Badge, Button, AsyncButton, Empty, Loading, ErrorBox, Tabs, Money, Toggle } from '../ui.js';

const FLOW = {
  delivery: { CONFIRMED: ['PREPARING', 'OUT_FOR_DELIVERY'], PREPARING: ['OUT_FOR_DELIVERY'], OUT_FOR_DELIVERY: ['DELIVERED'] },
  pickup: { CONFIRMED: ['PREPARING', 'READY'], PREPARING: ['READY'], READY: ['DELIVERED'] },
};
const MODE = { cod: 'Cash', upi: 'UPI', online: 'Online' };
const PAY = { PENDING: 'unpaid', PAID: 'paid ✓', COD: 'collect on delivery', REFUNDED: 'refunded' };
const LABEL = { PREPARING: '👨‍🍳 Preparing', OUT_FOR_DELIVERY: '🚚 Out for delivery', READY: '✅ Ready for pickup', DELIVERED: '📦 Delivered / Collected' };

function OrderCard({ o, reload }) {
  const { biz } = useApp();
  const setStatus = (status, reason) => act(() => api(`/orders/${o.id}/status`, { method: 'POST', body: { status, reason } }), 'Updated – customer notified').then(reload);
  const next = (FLOW[o.fulfilment] || FLOW.delivery)[o.status] || [];
  const cancel = () => {
    const reason = prompt('Reason for cancelling (sent to the customer, optional):', '');
    if (reason !== null) setStatus('CANCELLED', reason);
  };
  return html`<div class="order ${o.status === 'NEW' ? 'new' : ''}">
    <div class="row between wrap gap">
      <div class="row gap wrap"><strong>#${o.order_no}</strong><${Badge} status=${o.status} /><${Badge} status=${o.payment_status}>${MODE[o.payment_mode] || o.payment_mode} · ${PAY[o.payment_status] || o.payment_status}<//>
        ${o.phone.startsWith('sim') && html`<${Badge} tone="muted">Test<//>`}</div>
      <span class="muted small">${fmtDateTime(o.created_at, biz.timezone)}</span>
    </div>
    <div class="row between wrap gap" style="margin-top:6px">
      <div><strong>${o.customer_name || 'Customer'}</strong> · <a href=${`#/inbox?phone=${o.phone}`}>${phoneFmt(o.phone)}</a></div>
      <strong><${Money} value=${o.total} /></strong>
    </div>
    <ul class="order-items">${o.items.map((l) => html`<li>${l.name} × ${l.qty} <span class="muted">(<${Money} value=${l.price * l.qty} />)</span></li>`)}</ul>
    <div class="small">${o.fulfilment === 'pickup' ? '🏪 Pickup' : html`🚚 ${o.address || 'No address'}`}${o.delivery_fee ? html` · delivery <${Money} value=${o.delivery_fee} />` : ''}</div>
    ${o.notes && html`<div class="small">📝 ${o.notes}</div>`}
    ${o.cancel_reason && html`<div class="small muted">Cancelled: ${o.cancel_reason}</div>`}
    <div class="row gap wrap" style="margin-top:10px">
      ${o.status === 'NEW' && html`<${AsyncButton} variant="primary" onClick=${() => act(() => api(`/orders/${o.id}/paid`, { method: 'POST' }), 'Marked paid – order confirmed').then(reload)}>✅ Payment received<//>`}
      ${next.map((s, i) => html`<${AsyncButton} variant=${i === 0 ? 'primary' : ''} onClick=${() => setStatus(s)}>${LABEL[s]}<//>`)}
      ${o.status !== 'NEW' && o.payment_status !== 'PAID' && o.payment_mode !== 'cod' && html`<${AsyncButton} onClick=${() => act(() => api(`/orders/${o.id}/paid`, { method: 'POST' }), 'Marked paid').then(reload)}>Mark paid<//>`}
      ${!['DELIVERED', 'CANCELLED'].includes(o.status) && html`<${Button} variant="ghost danger" onClick=${cancel}>Cancel order<//>`}
    </div>
  </div>`;
}

export function Orders() {
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const [test, setTest] = useState(false);
  const status = { active: 'active', new: 'NEW', delivered: 'DELIVERED', cancelled: 'CANCELLED', all: '' }[tab];
  const { data, error, loading, reload } = useApi(`/orders?status=${status}&q=${encodeURIComponent(q)}&test=${test ? 1 : 0}`, [tab, q, test]);
  useInterval(reload, 10000);
  return html`<${Page} title="Orders" subtitle="Tap a button to move an order forward – the customer gets a WhatsApp update automatically."
    actions=${html`<${Button} onClick=${() => download('/orders-export.csv')}>⬇ Export CSV<//>`}>
    <${Tabs} active=${tab} onChange=${setTab} tabs=${[{ key: 'active', label: 'In progress' }, { key: 'new', label: 'Awaiting payment' }, { key: 'delivered', label: 'Delivered' }, { key: 'cancelled', label: 'Cancelled' }, { key: 'all', label: 'All' }]} />
    <div class="toolbar"><input class="search" type="search" placeholder="Search name, phone or order #" aria-label="Search orders" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <${Toggle} checked=${test} onChange=${setTest} label="Show test orders" /></div>
    ${error ? html`<${ErrorBox} error=${error} retry=${reload} />` : loading && !data ? html`<${Loading} />`
      : data.orders.length === 0 ? html`<${Empty} icon="🛒" title="No orders here">New WhatsApp orders appear here instantly, with a sound alert.<//>`
        : data.orders.map((o) => html`<${OrderCard} key=${o.id} o=${o} reload=${reload} />`)}
  <//>`;
}
