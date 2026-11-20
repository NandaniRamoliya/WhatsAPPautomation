import { useState } from 'preact/hooks';
import { html, api, act, useApi, useApp } from '../lib.js';
import { Page, Card, Badge, AsyncButton, Loading, ErrorBox, Alert, Field } from '../ui.js';

export function Templates() {
  const { biz, reloadBiz } = useApp();
  const { data, error, loading, reload } = useApi('/templates');
  const [cfg, setCfg] = useState(structuredClone(biz.settings.templates || {}));
  if (error) return html`<${Page} title="Message templates"><${ErrorBox} error=${error} retry=${reload} /><//>`;
  if (loading || !data) return html`<${Page} title="Message templates"><${Loading} /><//>`;
  const status = (name) => data.remote.find((t) => t.name === name)?.status;
  const save = async () => { if (await act(() => api('/business', { method: 'PUT', body: { settings: { templates: cfg } } }), 'Saved')) reloadBiz(); };
  const create = async () => {
    const r = await act(() => api('/templates/create', { method: 'POST', body: { lang: biz.language === 'hinglish' ? 'en' : 'en' } }));
    if (r) { r.results.forEach((x) => !x.ok && console.warn(x)); await reloadBiz(); reload(); setCfg(structuredClone((await api('/business')).business.settings.templates)); }
  };
  return html`<${Page} title="Message templates" subtitle="Needed for messages you send more than 24 hours after the customer's last message.">
    <${Alert}><b>Why?</b> WhatsApp lets your bot reply freely for 24 hours after a customer writes. Reminders, check-ins, recalls and late order updates are sent later, so Meta must approve their wording first (usually minutes to a day).
      The bot automatically uses these templates only when needed.<//>
    ${data.remoteError && html`<${Alert} tone="warn">Could not load templates from Meta: ${data.remoteError}<//>`}
    <${Card} title="One-click setup" actions=${html`<${AsyncButton} variant="primary" onClick=${create}>Submit all to Meta<//>`}>
      <p class="muted">Submits the recommended templates below to your WhatsApp Business Account and links them to the bot. Needs WhatsApp connected (with WABA ID).</p>
    <//>
    ${Object.entries(data.slots).map(([slot, t]) => html`<${Card} title=${html`${t.label} ${cfg[slot]?.name ? html`<${Badge} status=${status(cfg[slot].name) || 'PENDING'}>${status(cfg[slot].name) || 'Not found in Meta'}<//>` : html`<${Badge} tone="muted">Not set<//>`}`}>
      <p class="muted small">${t.usedFor} · Category: ${t.category}</p>
      <p><code>${t.body}</code></p>
      ${t.buttons.length > 0 && html`<p class="small">Quick reply buttons: ${t.buttons.map((b) => html`<${Badge} tone="info">${b}<//> `)}</p>`}
      <div class="form-grid">
        <${Field} f=${{ key: `${slot}.name`, label: 'Approved template name', placeholder: t.name }} value=${cfg[slot]?.name || ''} onChange=${(v) => setCfg({ ...cfg, [slot]: { ...cfg[slot], name: v } })} />
        <${Field} f=${{ key: `${slot}.lang`, label: 'Language code', placeholder: 'en' }} value=${cfg[slot]?.lang || 'en'} onChange=${(v) => setCfg({ ...cfg, [slot]: { ...cfg[slot], lang: v } })} />
      </div>
    <//>`)}
    <${AsyncButton} variant="primary" onClick=${save}>💾 Save template names<//>
  <//>`;
}
