// First-time setup: pick business type -> details -> key settings -> test -> connect.
import { useState } from 'preact/hooks';
import { html, api, act, useApp } from '../lib.js';
import { Page, Card, FormFields, HoursEditor, Button, AsyncButton, Toggle, Alert } from '../ui.js';
import { businessFields, orderingFields, bookingFields } from './settings.js';

const STEPS = ['Business type', 'Details', 'Opening hours', 'How it works', 'Test & go live'];

export function Wizard() {
  const { biz, reloadBiz } = useApp();
  const [step, setStep] = useState(0);
  const [preset, setPreset] = useState(biz.preset);
  const [sample, setSample] = useState(true);
  const [v, setV] = useState({ ...structuredClone(biz), secrets: {} });
  const presets = biz.meta.presets;

  const saveAll = async (extra = {}) => {
    const secrets = Object.fromEntries(Object.entries(v.secrets || {}).filter(([, x]) => x));
    const r = await act(() => api('/business', { method: 'PUT', body: { ...v, secrets, ...extra } }));
    if (r) { setV({ ...structuredClone(r.business), secrets: {}, meta: biz.meta }); await reloadBiz(); }
    return r;
  };
  const choosePreset = async () => {
    const r = await act(() => api('/business/preset', { method: 'POST', body: { preset, sampleData: sample } }), 'Business type applied');
    if (r) { await reloadBiz(); setV({ ...structuredClone(r.business), secrets: {}, meta: biz.meta }); setStep(1); }
  };
  const next = async () => { if (await saveAll()) setStep(step + 1); };
  const has = (m) => v.modules?.includes(m);
  const nav = html`<div class="row gap" style="margin-top:18px">
    ${step > 0 && html`<${Button} onClick=${() => setStep(step - 1)}>← Back<//>`}
    ${step === 0 ? html`<${AsyncButton} variant="primary" onClick=${choosePreset}>Continue →<//>`
      : step < STEPS.length - 1 ? html`<${AsyncButton} variant="primary" onClick=${next}>Save & continue →<//>` : null}
  </div>`;

  return html`<${Page} title="Set up your WhatsApp assistant" subtitle="5 quick steps. You can change everything later in Settings.">
    <div class="steps" aria-label="Progress">${STEPS.map((s, i) => html`<span class=${i === step ? 'active' : i < step ? 'done' : ''}>${i < step ? '✓ ' : `${i + 1}. `}${s}</span>`)}</div>

    ${step === 0 && html`<${Card} title="What kind of business is this?">
      <div class="preset-grid">${presets.map((p) => html`<button class="preset ${preset === p.key ? 'selected' : ''}" onClick=${() => setPreset(p.key)} aria-pressed=${preset === p.key}>
        <div class="icon" aria-hidden="true">${p.icon}</div><h3>${p.label}</h3><p>${p.description}</p><p style="margin-top:6px"><i>${p.examples}</i></p></button>`)}</div>
      <div style="margin-top:16px"><${Toggle} checked=${sample} onChange=${setSample} label="Add example products / services / FAQs" help="Great for a demo. Edit or delete them later." /></div>
      ${nav}<//>`}

    ${step === 1 && html`<${Card} title="Business details"><${FormFields} fields=${businessFields(biz.meta).filter((f) => !['about', 'website', 'currency'].includes(f.key))} value=${v} onChange=${setV} />${nav}<//>`}

    ${step === 2 && html`<${Card} title="Opening hours"><${HoursEditor} value=${v.settings.hours} onChange=${(h) => setV({ ...v, settings: { ...v.settings, hours: h } })} />${nav}<//>`}

    ${step === 3 && html`<div>
      ${has('ordering') && html`<${Card} title="🛒 Ordering & payments"><${FormFields} fields=${orderingFields.slice(0, 11)} value=${v} onChange=${setV} /><//>`}
      ${has('booking') && html`<${Card} title="📅 Appointments"><${FormFields} fields=${bookingFields} value=${v} onChange=${setV} />
        <p class="muted small">Services, staff and triage questions: <a href="#/services">Services & staff</a> and Settings → Appointments.</p><//>`}
      ${!has('ordering') && !has('booking') && html`<${Card}><p>Your bot answers FAQs, collects enquiries and hands chats to you. Add FAQs in the <a href="#/faqs">FAQs</a> page.</p><//>`}
      ${nav}</div>`}

    ${step === 4 && html`<${Card} title="You're almost live 🎉">
      <ol class="col" style="padding-left:18px">
        <li><b>Check your ${has('ordering') ? 'products' : has('booking') ? 'services & staff' : 'FAQs'}:</b> <a href=${has('ordering') ? '#/catalogue' : has('booking') ? '#/services' : '#/faqs'}>open →</a></li>
        <li><b>Try the bot yourself</b> in the phone simulator: <a href="#/test">Test the bot →</a></li>
        <li><b>Connect your WhatsApp number</b> (your developer usually does this): <a href="#/settings?tab=whatsapp">Settings → WhatsApp →</a></li>
        <li><b>Approve message templates</b> so reminders & updates work after 24 hours: <a href="#/templates">Templates →</a></li>
        <li><b>Print your QR code</b> from the Home page and put it on the counter.</li>
      </ol>
      <${Alert} tone="ok">Tip: keep your phone's WhatsApp for personal use – the bot runs on a separate business number.<//>
      <div class="row gap"><${Button} onClick=${() => setStep(3)}>← Back<//>
        <${AsyncButton} variant="primary" onClick=${async () => { if (await saveAll({ setup_done: 1 })) location.hash = '#/overview'; }}>Finish setup ✓<//></div>
    <//>`}
  <//>`;
}
