import { useState, useEffect } from 'preact/hooks';
import { html, api, act, useApi, useApp, fmtDateTime, useInterval } from '../lib.js';
import { Page, Card, Badge, AsyncButton, Empty, Loading, Field, Toggle, Alert } from '../ui.js';

export function Broadcasts() {
  const { biz } = useApp();
  const { data, loading, reload } = useApi('/broadcasts');
  const templates = useApi('/templates');
  const [f, setF] = useState({ name: '', template_name: '', template_lang: 'en', params: '', audience: { tag: '', marketing_only: true } });
  const [count, setCount] = useState(null);
  useInterval(reload, 10000);
  useEffect(() => { api('/broadcasts/preview', { method: 'POST', body: { audience: f.audience } }).then((r) => setCount(r.count)).catch(() => setCount(null)); }, [f.audience.tag, f.audience.marketing_only]);
  const approved = (templates.data?.remote || []).filter((t) => t.status === 'APPROVED');
  const send = async () => {
    if (!confirm(`Send "${f.template_name}" to ${count} customers now?`)) return;
    const body = { ...f, params: f.params ? f.params.split('|').map((s) => s.trim()) : [] };
    if (await act(() => api('/broadcasts', { method: 'POST', body }), 'Broadcast started')) reload();
  };
  return html`<${Page} title="Broadcasts" subtitle="Send an approved template (offers, festival wishes, announcements) to opted-in customers.">
    <${Alert} tone="warn">⚠️ WhatsApp only allows bulk messages using <b>approved templates</b>, and only to customers who <b>agreed to receive them</b>. Sending unwanted messages lowers your number's quality and can get it blocked. Marketing templates are charged per message by Meta.<//>
    <${Card} title="New broadcast">
      <div class="form-grid">
        <${Field} f=${{ key: 'name', label: 'Campaign name (internal)', placeholder: 'Diwali offer' }} value=${f.name} onChange=${(v) => setF({ ...f, name: v })} />
        ${approved.length ? html`<${Field} f=${{ key: 't', label: 'Approved template', type: 'select', options: [{ value: '', label: 'Choose…' }, ...approved.map((t) => ({ value: `${t.name}|${t.language}`, label: `${t.name} (${t.language}, ${t.category.toLowerCase()})` }))] }}
            value=${f.template_name ? `${f.template_name}|${f.template_lang}` : ''} onChange=${(v) => { const [n, l] = v.split('|'); setF({ ...f, template_name: n, template_lang: l || 'en' }); }} />`
          : html`<${Field} f=${{ key: 'template_name', label: 'Template name', help: 'Exact name of an APPROVED template in WhatsApp Manager.' }} value=${f.template_name} onChange=${(v) => setF({ ...f, template_name: v })} />`}
        <${Field} f=${{ key: 'params', label: 'Template values {{1}} | {{2}} …', placeholder: '{name} | 20% off this weekend', help: 'Separate with |. Use {name} for the customer\'s first name.', wide: true }} value=${f.params} onChange=${(v) => setF({ ...f, params: v })} />
        <${Field} f=${{ key: 'tag', label: 'Only customers with tag', type: 'select', options: [{ value: '', label: 'Everyone' }, ...(data?.tags || [])] }} value=${f.audience.tag} onChange=${(v) => setF({ ...f, audience: { ...f.audience, tag: v } })} />
      </div>
      <div style="margin:14px 0"><${Toggle} checked=${f.audience.marketing_only} onChange=${(v) => setF({ ...f, audience: { ...f.audience, marketing_only: v } })}
        label="Only customers who agreed to receive offers" help="Keep ON for promotional messages. Turn off only for important service announcements (utility templates)." /></div>
      <div class="row gap"><${AsyncButton} variant="primary" disabled=${!f.template_name || !count} onClick=${send}>📣 Send to ${count ?? '…'} customers<//></div>
    <//>
    <${Card} title="History">
      ${loading && !data ? html`<${Loading} />` : !data?.broadcasts.length ? html`<${Empty} icon="📣" title="No broadcasts yet" />`
        : html`<div class="table-wrap"><table class="table"><thead><tr><th>Campaign</th><th>Template</th><th>Status</th><th>Sent</th><th>Failed</th><th>Created</th></tr></thead><tbody>
        ${data.broadcasts.map((b) => html`<tr><td data-label="Campaign">${b.name}</td><td data-label="Template">${b.template_name}</td><td data-label="Status"><${Badge} status=${b.status} /></td>
          <td data-label="Sent">${b.sent} / ${b.total}</td><td data-label="Failed">${b.failed}</td><td data-label="Created">${fmtDateTime(b.created_at, biz.timezone)}</td></tr>`)}</tbody></table></div>`}
    <//>
  <//>`;
}
