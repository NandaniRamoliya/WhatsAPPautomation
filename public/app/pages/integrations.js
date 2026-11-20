// Integrations hub: Google Sheets, n8n/Make/Zapier webhooks, HubSpot, Airtable.
import { useState } from 'preact/hooks';
import { html, api, act, useApi, useApp, fmtDateTime } from '../lib.js';
import { Page, Card, Toggle, Field, AsyncButton, Alert, Badge, Loading, ErrorBox, Copy, Empty } from '../ui.js';

export function Integrations() {
  const { biz, reloadBiz, me } = useApp();
  const { data, error, loading, reload } = useApi('/integrations');
  const [cfg, setCfg] = useState(null);
  const [secrets, setSecrets] = useState({});
  if (error) return html`<${Page} title="Integrations"><${ErrorBox} error=${error} retry=${reload} /><//>`;
  if (loading || !data) return html`<${Page} title="Integrations"><${Loading} /><//>`;
  const c = cfg || structuredClone(data.config);
  const set = (target, patch) => setCfg({ ...c, [target]: { ...c[target], ...patch } });
  const canEdit = me.user.role !== 'staff';
  const save = async () => {
    const clean = structuredClone(c);
    const r = await act(() => api('/business', { method: 'PUT', body: { settings: { integrations: clean }, secrets: Object.fromEntries(Object.entries(secrets).filter(([, x]) => x)) } }), 'Integrations saved');
    if (r) { setSecrets({}); setCfg(null); await reloadBiz(); reload(); }
  };
  const test = (target) => act(() => api('/integrations/test', { method: 'POST', body: { target } }), 'Test event delivered ✅').then(reload);
  const testBtn = (t) => html`<${AsyncButton} small onClick=${() => test(t)}>Send test<//>`;
  return html`<${Page} title="Integrations" subtitle="Send every lead, order and booking to the tools you already use – automatically."
    actions=${canEdit && html`<${AsyncButton} variant="primary" onClick=${save}>💾 Save<//>`}>
    <${Alert}>Save first, then click <b>Send test</b>. Test chats from "Test the bot" are never sent to your tools.<//>
    <div class="grid grid-2">
      <${Card} title="📊 Google Sheets" actions=${testBtn('sheets')}>
        <${Toggle} checked=${c.sheets.enabled} label="Send to Google Sheets" onChange=${(x) => set('sheets', { enabled: x })} />
        <ol class="small" style="margin-top:10px">
          <li>Create a Google Sheet → <b>Extensions → Apps Script</b>.</li>
          <li>Delete what is there and paste the script below (set a secret word in TOKEN).</li>
          <li><b>Deploy → New deployment → Web app</b> · Execute as <b>Me</b> · Access <b>Anyone</b> → copy the Web app URL here.</li>
        </ol>
        <div class="form-grid">
          <${Field} f=${{ key: 'surl', label: 'Web app URL', type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec' }} value=${c.sheets.url} onChange=${(x) => set('sheets', { url: x })} />
          <${Field} f=${{ key: 'stok', label: 'Secret word (same as TOKEN in the script)' }} value=${c.sheets.token} onChange=${(x) => set('sheets', { token: x })} />
        </div>
        <details style="margin-top:10px"><summary class="small"><b>Show the Apps Script</b></summary>
          <pre class="small" style="white-space:pre-wrap;background:var(--panel-2);padding:10px;border-radius:8px;max-height:260px;overflow:auto">${data.sheetsScript}</pre>
          <button class="btn sm" onClick=${() => navigator.clipboard?.writeText(data.sheetsScript.replace(/const TOKEN = '.*?';/, `const TOKEN = '${c.sheets.token || ''}';`))}>Copy script</button>
        </details>
        <p class="small muted">Creates tabs automatically: Leads, Orders, Appointments, Customers, Handoffs, Feedback.</p>
      <//>
      <${Card} title="⚡ Webhook – n8n, Make, Zapier, any CRM" actions=${testBtn('webhook')}>
        <${Toggle} checked=${c.webhook.enabled} label="Send events to a webhook URL" onChange=${(x) => set('webhook', { enabled: x })} />
        <div class="form-grid" style="margin-top:10px">
          <${Field} f=${{ key: 'wurl', label: 'Webhook URL', type: 'url', wide: true, placeholder: 'https://n8n.yoursite.com/webhook/…', help: 'n8n "Webhook" node, Make "Custom webhook", Zapier "Catch Hook", or your own server.' }} value=${c.webhook.url} onChange=${(x) => set('webhook', { url: x })} />
          <${Field} f=${{ key: 'wsec', label: 'Signing secret (optional)', type: 'password', placeholder: c.webhook.secret_set ? '•••••• (saved)' : '', help: 'We send header X-WAK-Signature: sha256=HMAC(secret, body).' }} value=${secrets.webhook_secret || ''} onChange=${(x) => setSecrets({ ...secrets, webhook_secret: x })} />
        </div>
        <p class="small muted">Use this to reach Zoho, Pipedrive, GoHighLevel, Salesforce, Slack, email, Telegram… through n8n/Make.</p>
      <//>
      <${Card} title="🧡 HubSpot CRM" actions=${testBtn('hubspot')}>
        <${Toggle} checked=${c.hubspot.enabled} label="Create/update HubSpot contacts with a note for every event" onChange=${(x) => set('hubspot', { enabled: x })} />
        <div style="margin-top:10px"><${Field} f=${{ key: 'hs', label: 'Private app access token', type: 'password', placeholder: c.hubspot.token_set ? '•••••• (saved)' : 'pat-…', help: 'HubSpot → Settings → Integrations → Private apps → scopes: crm.objects.contacts.read/write.' }} value=${secrets.hubspot_token || ''} onChange=${(x) => setSecrets({ ...secrets, hubspot_token: x })} /></div>
      <//>
      <${Card} title="🗂️ Airtable" actions=${testBtn('airtable')}>
        <${Toggle} checked=${c.airtable.enabled} label="Add a row for every event" onChange=${(x) => set('airtable', { enabled: x })} />
        <div class="form-grid" style="margin-top:10px">
          <${Field} f=${{ key: 'at', label: 'Personal access token', type: 'password', placeholder: c.airtable.token_set ? '•••••• (saved)' : 'pat…' }} value=${secrets.airtable_token || ''} onChange=${(x) => setSecrets({ ...secrets, airtable_token: x })} />
          <${Field} f=${{ key: 'ab', label: 'Base ID', placeholder: 'appXXXXXXXX' }} value=${c.airtable.base_id} onChange=${(x) => set('airtable', { base_id: x })} />
          <${Field} f=${{ key: 'atb', label: 'Table name' }} value=${c.airtable.table} onChange=${(x) => set('airtable', { table: x })} />
        </div>
        <p class="small muted">Create columns: <code>Time, Event, Name, Phone, Summary, Details</code>.</p>
      <//>
    </div>
    <${Card} title="Which events to send">
      <div class="checks">${Object.entries(data.events).map(([k, label]) => html`<label class="check"><input type="checkbox" checked=${c.events.includes(k)}
        onChange=${(e) => setCfg({ ...c, events: e.target.checked ? [...c.events, k] : c.events.filter((x) => x !== k) })} /> ${label}</label>`)}</div>
    <//>
    <${Card} title="Delivery log (last 50)">
      ${data.log.length === 0 ? html`<${Empty} icon="📭" title="Nothing sent yet" />` : html`<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>To</th><th>Event</th><th>Result</th></tr></thead><tbody>
        ${data.log.map((l) => html`<tr><td data-label="When" class="nowrap">${fmtDateTime(l.created_at, biz.timezone)}</td><td data-label="To">${l.target}</td><td data-label="Event">${l.event}</td>
          <td data-label="Result">${l.status === 'ok' ? html`<${Badge} tone="ok">Delivered<//>` : html`<${Badge} tone="danger">Failed<//> <span class="small muted">${l.error}</span>`}</td></tr>`)}
      </tbody></table></div>`}
      <p class="small muted">Failed deliveries are retried automatically (3 attempts).</p>
    <//>
  <//>`;
}
