import { useState, useEffect, useRef } from 'preact/hooks';
import { html, api, act, useApi, useApp, useInterval, fmtDateTime, ago, phoneFmt, store, toast } from '../lib.js';
import { Page, Badge, Button, Empty, Loading, Tabs } from '../ui.js';

function MediaLink({ id }) {
  const open = async () => {
    try {
      const r = await fetch(`/api/media/${id}`, { headers: { 'x-business-id': store.bizId } });
      if (!r.ok) throw new Error((await r.json()).error);
      window.open(URL.createObjectURL(await r.blob()), '_blank');
    } catch (e) { toast(e.message, 'error'); }
  };
  return html`<button class="link" onClick=${open}>📎 Open attachment</button>`;
}

export function Bubble({ m, tz }) {
  return html`<div class="bubble ${m.direction}">
    ${m.body}
    ${m.media_id && m.media_id !== 'sim-media' && html`<div><${MediaLink} id=${m.media_id} /></div>`}
    ${m.error && html`<div class="err">⚠️ ${m.error}</div>`}
    <div class="meta">${m.direction === 'out' ? `${m.sent_by && m.sent_by !== 'bot' ? `${m.sent_by} · ` : m.sent_by === 'bot' ? '🤖 · ' : ''}` : ''}${fmtDateTime(m.created_at, tz, { day: undefined, month: undefined })}${m.direction === 'out' && m.status ? ` · ${m.status}` : ''}</div>
  </div>`;
}

function Chat({ phone, onChanged }) {
  const { biz } = useApp();
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const body = useRef();
  const load = async () => { try { setData(await api(`/chats/${phone}/messages`)); } catch (e) { toast(e.message, 'error'); } };
  useEffect(() => { setData(null); load(); }, [phone]);
  useInterval(load, 5000);
  useEffect(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }, [data?.messages?.length]);
  const sendMsg = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await act(() => api(`/chats/${phone}/send`, { method: 'POST', body: { text } }))) { setText(''); load(); onChanged(); }
  };
  const post = (p, msg) => act(() => api(`/chats/${phone}/${p}`, { method: 'POST' }), msg).then(() => { load(); onChanged(); });
  if (!data) return html`<${Loading} />`;
  return html`<div class="chat-pane">
    <div class="chat-head">
      <div><strong>${data.customer?.name || phoneFmt(phone)}</strong> <span class="muted small">${phoneFmt(phone)}</span>
        ${data.paused ? html` <${Badge} tone="warn">Bot paused – you are chatting<//>` : html` <${Badge} tone="ok">Bot active<//>`}</div>
      <div class="row gap wrap">
        ${data.needsReply && html`<${Button} small onClick=${() => post('done', 'Marked as handled')}>✓ Mark handled<//>`}
        ${data.paused ? html`<${Button} small variant="primary" onClick=${() => post('resume', 'Bot resumed')}>▶ Hand back to bot<//>`
          : html`<${Button} small onClick=${() => post('pause', 'Bot paused for this chat')}>⏸ Pause bot<//>`}
      </div>
    </div>
    <div class="chat-body" ref=${body}>${data.messages.map((m) => html`<${Bubble} key=${m.id} m=${m} tz=${biz.timezone} />`)}</div>
    ${data.windowOpen ? html`<form class="chat-input" onSubmit=${sendMsg}>
        <input aria-label="Type a reply" placeholder="Type a reply… (the bot pauses while you chat)" value=${text} onInput=${(e) => setText(e.target.value)} />
        <${Button} variant="primary" type="submit">Send<//></form>`
      : html`<div class="alert alert-warn" style="margin:10px">⏰ More than 24 hours since this customer's last message. WhatsApp only allows approved templates now – you can reply as soon as they message again.</div>`}
  </div>`;
}

export function Inbox() {
  const initial = new URLSearchParams(location.hash.split('?')[1] || '').get('phone');
  const [active, setActive] = useState(initial);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const { data, loading, reload } = useApi(`/chats?filter=${filter}&q=${encodeURIComponent(q)}`, [filter, q]);
  useInterval(reload, 8000);
  return html`<${Page} title="Chats" subtitle="See every conversation. Reply yourself whenever a customer asks for a person.">
    <${Tabs} active=${filter} onChange=${setFilter} tabs=${[{ key: 'all', label: 'All chats' }, { key: 'attention', label: '🔴 Waiting for reply' }]} />
    <div class="inbox">
      <div class="chat-list">
        <div style="padding:8px"><input type="search" aria-label="Search chats" placeholder="Search name or number" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
        ${loading && !data ? html`<${Loading} />` : data?.chats.length === 0 ? html`<${Empty} icon="💬" title="No chats yet">Messages from customers will show up here.<//>`
          : data?.chats.map((c) => html`<button class="chat-item ${active === c.phone ? 'active' : ''}" onClick=${() => setActive(c.phone)}>
            <div class="row between gap"><strong>${c.name || phoneFmt(c.phone)}</strong><span class="muted small">${ago(c.last_at)}</span></div>
            <div class="last">${c.last_dir === 'out' ? '↪ ' : ''}${(c.last || '').split('\n')[0]}</div>
            <div class="row gap">${c.needs_reply && html`<${Badge} tone="danger">Needs reply<//>`}${c.paused && html`<${Badge} tone="warn">Bot paused<//>`}</div>
          </button>`)}
      </div>
      ${active ? html`<${Chat} phone=${active} onChanged=${reload} />` : html`<div class="chat-pane"><${Empty} icon="👈" title="Choose a chat" /></div>`}
    </div>
  <//>`;
}
