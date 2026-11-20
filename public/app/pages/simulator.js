import { useState, useEffect, useRef } from 'preact/hooks';
import { html, api, act, useApp, toast } from '../lib.js';
import { Page, Button, Card, Alert } from '../ui.js';

function SimBubble({ m, onChoose, last }) {
  const p = m.payload || {};
  const i = p.interactive;
  const [sheet, setSheet] = useState(false);
  let content = m.body;
  let extra = null;
  if (m.direction === 'out' && i) {
    content = [i.header?.text && `*${i.header.text}*`, i.body?.text, i.footer?.text].filter(Boolean).join('\n');
    if (i.type === 'button') extra = html`<div class="bubble-btns">${i.action.buttons.map((b) => html`<button disabled=${!last} onClick=${() => onChoose({ id: b.reply.id, title: b.reply.title })}>${b.reply.title}</button>`)}</div>`;
    if (i.type === 'list') extra = html`<div class="bubble-btns"><button disabled=${!last} onClick=${() => setSheet(true)}>☰ ${i.action.button}</button></div>
      ${sheet && html`<div class="list-sheet" role="dialog" aria-label=${i.action.button}><h3>${i.action.button}<button class="icon-btn" aria-label="Close" onClick=${() => setSheet(false)}>✕</button></h3>
        ${i.action.sections.map((s) => html`${s.title && html`<div class="section">${s.title}</div>`}${s.rows.map((r) => html`<button class="row-opt" onClick=${() => { setSheet(false); onChoose({ id: r.id, title: r.title, list: true }); }}>
          <div>${r.title}</div>${r.description && html`<div class="desc">${r.description}</div>`}</button>`)}`)}</div>`}`;
    if (i.type === 'cta_url') extra = html`<div class="bubble-btns"><a class="btn sm" href=${i.action.parameters.url} target="_blank" rel="noopener">🔗 ${i.action.parameters.display_text}</a></div>`;
  }
  if (m.direction === 'out' && p.type === 'template') {
    const btns = (p.template.components || []).filter((c) => c.type === 'button');
    extra = btns.length ? html`<div class="bubble-btns">${btns.map((b, k) => html`<button disabled=${!last} onClick=${() => onChoose({ id: b.parameters[0].payload, title: `Option ${k + 1}` })}>Quick reply ${k + 1}</button>`)}</div>` : null;
  }
  if (m.direction === 'out' && p.type === 'image') content = html`<img src=${p.image.link} alt="" style="max-width:100%;border-radius:8px" />${p.image.caption ? `\n${p.image.caption}` : ''}`;
  return html`<div class="bubble ${m.direction}">${content}${extra}<div class="meta">${new Date(m.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</div></div>`;
}

export function Simulator() {
  const { biz } = useApp();
  const [msgs, setMsgs] = useState([]);
  const [session, setSession] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const body = useRef();
  const load = async () => { const r = await api('/sim/messages'); setMsgs(r.messages); setSession(r.session); };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }, [msgs.length]);
  const send = async (payload) => {
    setBusy(true);
    try { await api('/sim/message', { method: 'POST', body: payload }); await load(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const submit = (e) => { e.preventDefault(); if (text.trim()) { send({ text }); setText(''); } };
  const lastOut = msgs.length - 1 - [...msgs].reverse().findIndex((m) => m.direction === 'out');

  return html`<${Page} title="Test the bot" subtitle="Chat with your bot exactly like a customer would – no WhatsApp setup needed. Test orders and bookings are marked 'Test'.">
    <div class="sim-layout">
      <div class="phone">
        <div class="chat-head"><div><strong>${biz.name}</strong><div class="muted small">${busy ? 'typing…' : 'online'}</div></div></div>
        <div class="chat-body" ref=${body}>
          ${msgs.length === 0 && html`<div class="bubble out">Say <b>Hi</b> to start 👋</div>`}
          ${msgs.map((m, idx) => html`<${SimBubble} key=${m.id} m=${m} last=${idx === lastOut} onChoose=${(choice) => send({ choice })} />`)}
        </div>
        <form class="chat-input" onSubmit=${submit}>
          <button type="button" class="icon-btn" title="Share location" aria-label="Share location" onClick=${() => send({ location: true })}>📍</button>
          <button type="button" class="icon-btn" title="Send a photo" aria-label="Send a photo" onClick=${() => send({ media: 'image' })}>📷</button>
          <input aria-label="Message" placeholder="Type a message" value=${text} onInput=${(e) => setText(e.target.value)} disabled=${busy} />
          <${Button} variant="primary" type="submit" disabled=${busy}>➤<//>
        </form>
      </div>
      <div>
        <${Card} title="Tester tools">
          <div class="row gap wrap">
            <${Button} onClick=${() => send({ text: 'Hi' })}>👋 Say Hi<//>
            <${Button} onClick=${() => act(() => api('/sim/run-jobs', { method: 'POST' }), 'Due reminders / follow-ups sent').then(load)}>⏩ Fast-forward time<//>
            <${Button} variant="ghost danger" onClick=${() => act(() => api('/sim/reset', { method: 'POST' }), 'Test chat cleared').then(load)}>🗑 Reset test chat<//>
          </div>
          <p class="muted small">"Fast-forward time" sends this test chat's scheduled reminders, check-ins and recalls right now – so you can see the full journey in a minute. Complete a test appointment in <a href="#/appointments">Appointments</a> (switch on "Show test bookings") to trigger aftercare and the check-in.</p>
        <//>
        <${Card} title="Things to try">
          <ul class="small">
            <li>Type <b>hi</b>, <b>menu</b>, <b>cancel</b>, <b>talk to someone</b>, <b>STOP</b></li>
            ${biz.modules.includes('ordering') && html`<li>Type a product name (e.g. <b>milk</b>) to search, or type a number when asked for quantity</li><li>Place an order, then move it to "Out for delivery" in <a href="#/orders">Orders</a> (show test orders) and watch the update arrive here</li>`}
            ${biz.modules.includes('booking') && html`<li>Book an appointment, then tap "⏩ Fast-forward time" to receive the reminder</li>`}
            <li>Type a question that matches an FAQ keyword</li>
          </ul>
        <//>
        <${Card} title="What the bot remembers (for developers)">
          <pre class="small" style="white-space:pre-wrap;margin:0">${session ? JSON.stringify({ state: session.state, cart: session.cart, ctx: session.ctx }, null, 2) : 'No session yet'}</pre>
        <//>
        ${!biz.modules.length && html`<${Alert} tone="warn">No modules are switched on. Turn on Ordering, Booking or Enquiry in Settings.<//>`}
      </div>
    </div>
  <//>`;
}
