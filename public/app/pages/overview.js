import { useState, useEffect } from 'preact/hooks';
import { html, api, useApi, useApp, money } from '../lib.js';
import { Page, Card, Stat, Loading, ErrorBox, Button, Copy } from '../ui.js';

function Bars({ series, field, format = (v) => v }) {
  const max = Math.max(1, ...series.map((d) => d[field]));
  return html`<div class="bars" role="img" aria-label=${`Last 7 days: ${series.map((d) => `${d.date} ${format(d[field])}`).join(', ')}`}>
    ${series.map((d) => html`<div class="bar">
      <span class="val">${d[field] ? format(d[field]) : ''}</span>
      <div class="fill" style=${`height:${(d[field] / max) * 100}%`}></div>
      <span class="lbl">${new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short' })}</span>
    </div>`)}
  </div>`;
}

export function Overview() {
  const { biz } = useApp();
  const { data, error, loading, reload } = useApi('/stats');
  const links = useApi('/links');
  const [qr, setQr] = useState(null);
  useEffect(() => { if (links.data?.waLink) api('/qr').then((r) => setQr(r.dataUrl)).catch(() => {}); }, [links.data?.waLink]);

  if (error) return html`<${Page} title="Home"><${ErrorBox} error=${error} retry=${reload} /><//>`;
  if (loading && !data) return html`<${Page} title="Home"><${Loading} /><//>`;
  const t = data.today;
  const c = data.checklist;
  const has = (m) => biz.modules.includes(m);
  const steps = [
    ['Business details (name, address, owner phone)', c.details, '#/settings'],
    has('ordering') && ['Add your products & prices', c.catalogue, '#/catalogue'],
    has('booking') && ['Add services, staff & working hours', c.services, '#/services'],
    ['Add common questions (FAQs)', c.faqs, '#/faqs'],
    ['Try the bot in the tester', c.tested, '#/test'],
    ['Connect your WhatsApp number', c.whatsapp, '#/settings?tab=whatsapp'],
    ['Get message templates approved (reminders, updates)', c.templates, '#/templates'],
    ['First real customer message received', c.live, '#/inbox'],
  ].filter(Boolean);
  const done = steps.filter((s) => s[1]).length;

  return html`<${Page} title=${`Hello, ${biz.name} 👋`} subtitle="Here is what is happening today."
    actions=${html`<${Button} onClick=${reload}>↻ Refresh<//><a class="btn primary" href="#/test">📱 Test the bot</a>`}>
    <div class="stats">
      ${has('ordering') && html`<${Stat} label="Orders today" value=${t.orders} hint=${`${t.pendingOrders} in progress`} />`}
      ${has('ordering') && html`<${Stat} label="Sales today" value=${money(t.revenue, biz.currency)} hint=${t.unpaidUpi ? `${t.unpaidUpi} waiting for UPI payment` : 'confirmed orders'} />`}
      ${has('booking') && html`<${Stat} label="Appointments today" value=${t.appointments} hint=${`${t.upcomingAppointments} upcoming in total`} />`}
      ${has('booking') && html`<${Stat} label="No-shows (30 days)" value=${t.noShows30d} hint=${`${t.completed30d} visits completed`} />`}
      <${Stat} label="Chats waiting for you" value=${t.needsReply} tone=${t.needsReply ? 'alert' : ''} hint=${html`<a href="#/inbox">Open chats →</a>`} />
      ${has('enquiry') && html`<${Stat} label="New enquiries" value=${t.newLeads} hint=${html`<a href="#/leads">View →</a>`} />`}
      <${Stat} label="Customers" value=${t.customers} hint=${`+${t.newCustomers7d} this week`} />
    </div>
    ${t.failedMessages24h > 0 && html`<div class="alert alert-warn">⚠️ ${t.failedMessages24h} message(s) could not be delivered in the last 24 hours. Open <a href="#/inbox">Chats</a> to see why (usually: a template is needed, or WhatsApp is not connected yet).</div>`}
    <div class="grid grid-2">
      <${Card} title=${`Go-live checklist (${done}/${steps.length})`}>
        <ul class="checklist">${steps.map(([label, ok, href]) => html`<li class=${ok ? 'done' : ''}><span class="tick" aria-hidden="true">${ok ? '✓' : ''}</span>
          <span>${label}</span>${!ok && html`<a href=${href}>Do it →</a>`}</li>`)}</ul>
      <//>
      <${Card} title="Last 7 days">
        ${has('ordering') && html`<h3 class="muted small">Orders</h3><${Bars} series=${data.series} field="orders" />`}
        ${has('booking') && html`<h3 class="muted small">Appointments</h3><${Bars} series=${data.series} field="appointments" />`}
        <h3 class="muted small">People who messaged</h3><${Bars} series=${data.series} field="chats" />
      <//>
      <${Card} title="Share your WhatsApp link">
        ${links.data?.waLink ? html`<div class="row gap wrap" style="align-items:flex-start">
          ${qr && html`<div class="qr"><img src=${qr} alt="QR code that opens a WhatsApp chat with your business" /></div>`}
          <div class="col" style="flex:1 1 240px;min-width:0">
            <p class="muted small">Print this QR on your counter, bills, bags and posters. Customers scan it and say "Hi" — the bot does the rest.</p>
            <${Copy} label="Chat link" value=${links.data.waLink} />
            <${Copy} label="Short link" value=${links.data.shortLink} />
            <div class="row gap wrap"><a class="btn" href=${links.data.qrPng} target="_blank" rel="noopener">⬇ Download big QR (PNG)</a></div>
          </div></div>`
        : html`<p class="muted">Connect your WhatsApp number in <a href="#/settings?tab=whatsapp">Settings → WhatsApp</a> to get your QR code and chat link.</p>`}
      <//>
    </div>
  <//>`;
}
