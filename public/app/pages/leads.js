import { html, api, act, useApi, useApp, fmtDateTime, phoneFmt, download } from '../lib.js';
import { Page, Button, Empty, Loading, ErrorBox } from '../ui.js';

const STATUSES = ['NEW', 'CONTACTED', 'WON', 'LOST'];

export function Leads() {
  const { biz } = useApp();
  const { data, error, loading, reload } = useApi('/leads');
  const set = (l, patch) => act(() => api(`/leads/${l.id}`, { method: 'PUT', body: { status: l.status, notes: l.notes, ...patch } }), 'Saved').then(reload);
  return html`<${Page} title="Enquiries" subtitle="Details customers shared through the enquiry form in WhatsApp."
    actions=${html`<${Button} onClick=${() => download('/leads-export.csv')}>⬇ Export<//>`}>
    ${error ? html`<${ErrorBox} error=${error} retry=${reload} />` : loading && !data ? html`<${Loading} />`
      : data.leads.length === 0 ? html`<${Empty} icon="📝" title="No enquiries yet">Edit the questions in Settings → Enquiry.<//>`
        : html`<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Customer</th><th>Answers</th><th>Status</th><th>Notes</th></tr></thead><tbody>
        ${data.leads.map((l) => html`<tr>
          <td data-label="When" class="nowrap">${fmtDateTime(l.created_at, biz.timezone)}</td>
          <td data-label="Customer"><strong>${l.name || '—'}</strong><div><a href=${`#/inbox?phone=${l.phone}`}>${phoneFmt(l.phone)}</a></div></td>
          <td data-label="Answers">${Object.entries(l.answers || {}).map(([k, v]) => html`<div><span class="muted">${k}:</span> ${v}</div>`)}</td>
          <td data-label="Status"><select aria-label="Status" value=${l.status} onChange=${(e) => set(l, { status: e.target.value })}>${STATUSES.map((s) => html`<option value=${s}>${s[0] + s.slice(1).toLowerCase()}</option>`)}</select></td>
          <td data-label="Notes"><input aria-label="Notes" value=${l.notes || ''} placeholder="Add a note…" onChange=${(e) => set(l, { notes: e.target.value })} /></td>
        </tr>`)}</tbody></table></div>`}
  <//>`;
}
