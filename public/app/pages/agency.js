// Super-admin: all client businesses, create a new client in 30 seconds.
import { useState } from 'preact/hooks';
import { html, api, act, useApi, useApp, fmtDateTime } from '../lib.js';
import { Page, Badge, Button, AsyncButton, Modal, FormFields, Loading, ErrorBox, Empty, Stat } from '../ui.js';

export function Agency() {
  const { me, reloadMe, switchBiz } = useApp();
  const { data, error, loading, reload } = useApi('/admin/businesses');
  const [creating, setCreating] = useState(null);
  if (me.user.role !== 'superadmin') return html`<${Page} title="Agency"><p>Only for the agency administrator.</p><//>`;
  if (error) return html`<${Page} title="All businesses"><${ErrorBox} error=${error} retry=${reload} /><//>`;
  if (loading || !data) return html`<${Page} title="All businesses"><${Loading} /><//>`;
  const create = async () => {
    const r = await act(() => api('/admin/businesses', { method: 'POST', body: creating }), 'Business created');
    if (r) { setCreating(null); await reloadMe(); reload(); switchBiz(String(r.id)); location.hash = '#/setup'; }
  };
  const toggle = (b) => act(() => api(`/admin/businesses/${b.id}`, { method: 'PUT', body: { active: !b.active } }), b.active ? 'Paused – bot stops replying' : 'Activated').then(reload);
  const del = async (b) => {
    const typed = prompt(`This permanently deletes ${b.name} and ALL its data. Type "${b.slug}" to confirm:`);
    if (typed === b.slug && await act(() => api(`/admin/businesses/${b.id}`, { method: 'DELETE', body: { confirm: typed } }), 'Deleted')) { await reloadMe(); reload(); }
  };
  const tot = (k) => data.businesses.reduce((a, b) => a + (b[k] || 0), 0);
  return html`<${Page} title="All businesses" subtitle="Every client on this server. Each has its own WhatsApp number, data and logins."
    actions=${html`<${Button} variant="primary" onClick=${() => setCreating({ name: '', preset: 'grocery', sampleData: true, owner_email: '', owner_password: '', owner_phone: '', language: 'en' })}>+ New client business<//>`}>
    <div class="stats"><${Stat} label="Businesses" value=${data.businesses.length} /><${Stat} label="Connected to WhatsApp" value=${data.businesses.filter((b) => b.connected).length} />
      <${Stat} label="Messages (30 days)" value=${tot('messages_30d')} /><${Stat} label="Orders" value=${tot('orders')} /><${Stat} label="Appointments" value=${tot('appointments')} /></div>
    ${data.businesses.length === 0 ? html`<${Empty} icon="🏢" title="No businesses yet">Create your first client business.<//>` : html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Business</th><th>Type</th><th>WhatsApp</th><th>Usage</th><th>Status</th><th class="right"></th></tr></thead>
      <tbody>${data.businesses.map((b) => html`<tr>
        <td data-label="Business"><strong>${b.name}</strong><div class="small muted">${b.slug} · since ${fmtDateTime(b.created_at, 'Asia/Kolkata', { hour: undefined, minute: undefined, year: 'numeric' })}</div></td>
        <td data-label="Type">${data.presets.find((p) => p.key === b.preset)?.label || b.preset}<div class="small muted">${(b.modules || []).join(', ')}</div></td>
        <td data-label="WhatsApp">${b.connected ? html`<${Badge} tone="ok">+${b.wa_display_phone || 'connected'}<//>` : html`<${Badge} tone="warn">Not connected<//>`}</td>
        <td data-label="Usage" class="small">${b.customers} customers · ${b.orders} orders · ${b.appointments} appts · ${b.messages_30d} msgs/30d · ${b.users} logins</td>
        <td data-label="Status">${b.active ? html`<${Badge} tone="ok">Active<//>` : html`<${Badge} tone="muted">Paused<//>`} ${!b.setup_done && html`<${Badge} tone="warn">Setup pending<//>`}</td>
        <td class="right nowrap"><${Button} small variant="primary" onClick=${() => switchBiz(String(b.id))}>Open<//> <${Button} small onClick=${() => toggle(b)}>${b.active ? 'Pause' : 'Activate'}<//> <${Button} small variant="ghost danger" onClick=${() => del(b)}>Delete<//></td>
      </tr>`)}</tbody></table></div>`}
    ${creating && html`<${Modal} title="New client business" onClose=${() => setCreating(null)} wide
      footer=${html`<${Button} onClick=${() => setCreating(null)}>Cancel<//><${AsyncButton} variant="primary" onClick=${create}>Create & start setup<//>`}>
      <${FormFields} value=${creating} onChange=${setCreating} fields=${[
        { key: 'name', label: 'Business name', required: true },
        { key: 'preset', label: 'Business type', type: 'select', options: data.presets.map((p) => ({ value: p.key, label: `${p.icon} ${p.label}` })) },
        { key: 'owner_phone', label: 'Owner WhatsApp (alerts)', placeholder: '98765 43210' },
        { key: 'language', label: 'Bot language', type: 'select', options: [{ value: 'en', label: 'English' }, { value: 'hinglish', label: 'Hinglish' }] },
        { key: 'owner_email', label: 'Owner login email (optional)', type: 'email', help: 'Creates a dashboard login for the client.' },
        { key: 'owner_password', label: 'Owner password', type: 'password', help: 'At least 8 characters.', hidden: (v) => !v.owner_email },
        { key: 'sampleData', label: 'Add example data for a demo', type: 'toggle' },
      ]} />
    <//>`}
  <//>`;
}
