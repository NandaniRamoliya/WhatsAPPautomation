import { useState } from 'preact/hooks';
import { html, api, act, useApi, useApp, fmtDateTime, phoneFmt, download } from '../lib.js';
import { Page, Badge, Button, AsyncButton, Empty, Loading, ErrorBox, Modal, Field, Toggle, Alert } from '../ui.js';

function ImportModal({ onClose, onDone }) {
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState(null);
  const run = async () => { const r = await act(() => api('/customers/import', { method: 'POST', body: { csv } })); if (r) { setResult(r); onDone(); } };
  return html`<${Modal} title="Import existing customers / patients" onClose=${onClose} wide footer=${html`<${Button} onClick=${onClose}>Close<//><${AsyncButton} variant="primary" disabled=${!csv} onClick=${run}>Import<//>`}>
    <p class="muted">Upload a CSV file (from Excel: File → Save as → CSV). Columns: <code>phone,name,tags,notes,last_visit,service,marketing_opt_in</code>.
      If <b>last_visit</b> (YYYY-MM-DD) and <b>service</b> are filled, and that service has a recall period, a recall message is scheduled automatically.</p>
    <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange=${async (e) => setCsv(await e.target.files[0]?.text())} />
    <${Field} f=${{ key: 'csv', label: 'Or paste CSV here', type: 'textarea', rows: 6, placeholder: 'phone,name,tags,last_visit,service\n9876543210,Neha Sharma,vip|dental,2026-05-20,Cleaning & Scaling' }} value=${csv} onChange=${setCsv} />
    ${result && html`<${Alert} tone=${result.errors.length ? 'warn' : 'ok'}>Imported ${result.imported} customers, scheduled ${result.recalls} recalls.${result.errors.length ? html`<br />${result.errors.slice(0, 10).join(', ')}` : ''}<//>`}
  <//>`;
}

export function Customers() {
  const { biz } = useApp();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [edit, setEdit] = useState(null);
  const [importing, setImporting] = useState(false);
  const { data, error, loading, reload } = useApi(`/customers?q=${encodeURIComponent(q)}&tag=${encodeURIComponent(tag)}`, [q, tag]);
  const save = async () => { if (await act(() => api(`/customers/${edit.id}`, { method: 'PUT', body: edit }), 'Saved')) { setEdit(null); reload(); } };
  const del = async () => {
    if (!confirm('Delete this customer and their chat history? (Use this when a customer asks for their data to be deleted.)')) return;
    if (await act(() => api(`/customers/${edit.id}`, { method: 'DELETE' }), 'Customer deleted')) { setEdit(null); reload(); }
  };
  return html`<${Page} title="Customers" subtitle="Everyone who messaged you, with tags, notes and history."
    actions=${html`<${Button} onClick=${() => setImporting(true)}>⬆ Import CSV<//><${Button} onClick=${() => download('/customers-export.csv')}>⬇ Export<//>`}>
    <div class="toolbar">
      <input class="search" type="search" aria-label="Search customers" placeholder="Search name or phone" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <select aria-label="Filter by tag" value=${tag} onChange=${(e) => setTag(e.target.value)} style="width:auto"><option value="">All tags</option>${(data?.tags || []).map((t) => html`<option>${t}</option>`)}</select>
    </div>
    ${error ? html`<${ErrorBox} error=${error} retry=${reload} />` : loading && !data ? html`<${Loading} />`
      : data.customers.length === 0 ? html`<${Empty} icon="👥" title="No customers yet">They are added automatically when they message you.<//>`
        : html`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Phone</th><th>Tags</th><th>Orders / visits</th><th>Last message</th><th>Updates</th><th></th></tr></thead>
        <tbody>${data.customers.map((c) => html`<tr>
          <td data-label="Name"><strong>${c.name || '—'}</strong>${c.notes && html`<div class="small muted">${c.notes}</div>`}</td>
          <td data-label="Phone"><a href=${`#/inbox?phone=${c.phone}`}>${phoneFmt(c.phone)}</a></td>
          <td data-label="Tags">${(c.tags || []).map((t) => html`<${Badge} tone="info">${t}<//> `)}</td>
          <td data-label="Orders / visits">${c.orders_count} / ${c.visits_count}</td>
          <td data-label="Last message">${fmtDateTime(c.last_inbound_at, biz.timezone) || '—'}</td>
          <td data-label="Updates">${c.opted_in ? html`<${Badge} tone="ok">Subscribed<//>` : html`<${Badge} tone="danger">Opted out<//>`} ${c.marketing_opt_in ? html`<${Badge} tone="info">Offers OK<//>` : ''}</td>
          <td class="right"><${Button} small onClick=${() => setEdit({ ...c })}>Edit<//></td>
        </tr>`)}</tbody></table></div>`}
    ${edit && html`<${Modal} title=${edit.name || phoneFmt(edit.phone)} onClose=${() => setEdit(null)}
      footer=${html`<${Button} variant="ghost danger" onClick=${del}>Delete data<//><span class="grow"></span><${Button} onClick=${() => setEdit(null)}>Cancel<//><${AsyncButton} variant="primary" onClick=${save}>Save<//>`}>
      <div class="form-grid">
        <${Field} f=${{ key: 'name', label: 'Name' }} value=${edit.name} onChange=${(v) => setEdit({ ...edit, name: v })} />
        <${Field} f=${{ key: 'tags', label: 'Tags', help: 'Comma separated, e.g. vip, diabetic, wholesale' }} value=${(edit.tags || []).join(', ')} onChange=${(v) => setEdit({ ...edit, tags: v.split(',').map((s) => s.trim()) })} />
        <${Field} f=${{ key: 'address', label: 'Address', type: 'textarea', rows: 2, wide: true }} value=${edit.address} onChange=${(v) => setEdit({ ...edit, address: v })} />
        <${Field} f=${{ key: 'notes', label: 'Private notes', type: 'textarea', rows: 3, wide: true }} value=${edit.notes} onChange=${(v) => setEdit({ ...edit, notes: v })} />
      </div>
      <div class="col" style="margin-top:14px">
        <${Toggle} checked=${edit.opted_in} onChange=${(v) => setEdit({ ...edit, opted_in: v })} label="Receives reminders & updates" help="Customers can turn this off by sending STOP." />
        <${Toggle} checked=${edit.marketing_opt_in} onChange=${(v) => setEdit({ ...edit, marketing_opt_in: v })} label="Agreed to receive offers (broadcasts)" help="Only switch on if the customer agreed. WhatsApp blocks numbers that spam." />
      </div>
    <//>`}
    ${importing && html`<${ImportModal} onClose=${() => setImporting(false)} onDone=${reload} />`}
  <//>`;
}
