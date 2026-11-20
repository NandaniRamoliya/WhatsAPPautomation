import { useState } from 'preact/hooks';
import { html, api, act, useApi, useApp } from '../lib.js';
import { Page, Tabs, Loading, ErrorBox, AsyncButton, Alert, Card } from '../ui.js';

const PREVIEW = { business: 'Your Shop', name_sp: ' Neha', name: 'Neha', order_no: '1024', total: '₹450', service: 'Consultation', staff: 'Dr. Mehta', date: 'Sat, 21 Nov', time: '10:30 AM', product: 'Atta 5kg', qty: '2' };

export function BotMessages() {
  const { biz } = useApp();
  const [lang, setLang] = useState(biz.language);
  const { data, error, loading, reload } = useApi(`/texts?lang=${lang}`, [lang]);
  const [group, setGroup] = useState('General');
  const [edits, setEdits] = useState({});
  const [q, setQ] = useState('');
  if (error) return html`<${Page} title="Bot messages"><${ErrorBox} error=${error} retry=${reload} /><//>`;
  if (loading || !data) return html`<${Page} title="Bot messages"><${Loading} /><//>`;
  const value = (k) => (k in edits ? edits[k] : data.overrides[k] ?? data.defaults[k]);
  const changed = Object.keys(edits).length;
  const save = async () => {
    const body = Object.fromEntries(Object.entries(edits).map(([k, v]) => [k, v === data.defaults[k] ? null : v]));
    if (await act(() => api(`/texts?lang=${lang}`, { method: 'PUT', body }), 'Messages saved')) { setEdits({}); reload(); }
  };
  const keys = (q ? Object.values(data.groups).flat() : data.groups[group]).filter((k) => !q || `${k} ${value(k)}`.toLowerCase().includes(q.toLowerCase()));
  const groups = Object.keys(data.groups).filter((g) => g === 'General' || (g === 'Ordering' && biz.modules.includes('ordering')) || (g === 'Booking' && biz.modules.includes('booking')) || (g === 'Enquiry'));
  return html`<${Page} title="Bot messages" subtitle="Change any word the bot says. Leave a message as it is to use the default."
    actions=${html`<${AsyncButton} variant="primary" disabled=${!changed} onClick=${save}>💾 Save ${changed || ''} change${changed === 1 ? '' : 's'}<//>`}>
    <${Alert}>Words in <code>{curly}</code> braces are filled in automatically (e.g. <code>{business}</code>, <code>{total}</code>, <code>{date}</code>) – keep them. Use <code>*bold*</code> and <code>_italic_</code> like in WhatsApp. Button labels must be <b>20 characters or less</b>, list items 24.<//>
    <div class="toolbar"><input class="search" type="search" placeholder="Search all messages…" aria-label="Search messages" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <label class="row gap small">Language <select aria-label="Language" value=${lang} onChange=${(e) => { if (!changed || confirm('Discard unsaved changes?')) { setEdits({}); setLang(e.target.value); } }} style="width:auto">
        ${Object.entries(data.languages).map(([k, l]) => html`<option value=${k}>${l}${k === data.primary ? ' (main)' : ''}</option>`)}</select></label></div>
    ${!q && html`<${Tabs} active=${group} onChange=${setGroup} tabs=${groups.map((g) => ({ key: g, label: g }))} />`}
    <${Card}>
      ${keys.map((k) => {
        const val = value(k);
        const isBtn = k.startsWith('btn_') || (k.startsWith('menu_') && !k.endsWith('_desc'));
        const tooLong = isBtn && val.replace(/\{\w+\}/g, 'xxxx').length > (k.startsWith('menu_') ? 24 : 20);
        const custom = k in data.overrides || (k in edits && edits[k] !== data.defaults[k]);
        return html`<div class="texts-row ${k in edits ? 'changed' : ''}">
          <div><div class="text-key">${k}</div>${custom && html`<span class="badge badge-info">customised</span>`}</div>
          <div><textarea aria-label=${k} rows=${Math.min(6, Math.max(1, val.split('\n').length))} value=${val} onInput=${(e) => setEdits({ ...edits, [k]: e.target.value })} />
            ${tooLong && html`<div class="help" style="color:var(--danger)">Too long for a WhatsApp button – it will be cut.</div>`}
            <div class="help">Preview: ${val.replace(/\{(\w+)\}/g, (_, x) => PREVIEW[x] ?? `[${x}]`).slice(0, 160)}</div></div>
          <div>${custom && html`<button class="link" onClick=${() => setEdits({ ...edits, [k]: data.defaults[k] })}>Reset</button>`}</div>
        </div>`;
      })}
    <//>
  <//>`;
}
