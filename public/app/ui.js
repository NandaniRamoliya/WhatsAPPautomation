// Reusable UI components (forms, tables, modals...). Plain-language, mobile friendly.
import { useState, useEffect } from 'preact/hooks';
import { html, api, act, useApi, money, toMinor, fromMinor, useApp, titleCase } from './lib.js';

export const Page = ({ title, subtitle, actions, children }) => html`
  <section class="page">
    <header class="page-head">
      <div><h1>${title}</h1>${subtitle && html`<p class="muted">${subtitle}</p>`}</div>
      ${actions && html`<div class="page-actions">${actions}</div>`}
    </header>
    ${children}
  </section>`;

export const Card = ({ title, children, actions, className = '' }) => html`
  <div class="card ${className}">
    ${(title || actions) && html`<div class="card-head">${title && html`<h2>${title}</h2>`}${actions && html`<div class="row gap">${actions}</div>`}</div>`}
    ${children}
  </div>`;

export const Stat = ({ label, value, hint, tone = '' }) => html`
  <div class="stat ${tone}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div>${hint && html`<div class="stat-hint">${hint}</div>`}</div>`;

const TONES = {
  NEW: 'warn', PENDING: 'warn', BOOKED: 'info', CONFIRMED: 'ok', PREPARING: 'info', READY: 'ok', OUT_FOR_DELIVERY: 'info', DELIVERED: 'done',
  COMPLETED: 'done', CANCELLED: 'muted', NO_SHOW: 'danger', PAID: 'ok', COD: 'info', CONTACTED: 'info', WON: 'ok', LOST: 'muted',
  QUEUED: 'warn', RUNNING: 'info', DONE: 'done', FAILED: 'danger', APPROVED: 'ok', REJECTED: 'danger',
};
// Product wordmark: plain gradient text, no icon before the name (Indrix brand rule)
export const Wordmark = ({ about, size = '' }) => html`<span class="wordmark ${size}"><b>${about?.brand?.name || 'Replix'}</b><small>by ${about?.brand?.company || 'Indrix'}</small></span>`;

export const Badge = ({ status, children, tone }) => html`<span class="badge badge-${tone || TONES[status] || 'muted'}">${children || titleCase(status)}</span>`;

export const Button = ({ children, variant = '', small, ...p }) => html`<button type="button" class="btn ${variant} ${small ? 'sm' : ''}" ...${p}>${children}</button>`;

/** Button that shows a spinner while its async onClick runs. */
export function AsyncButton({ onClick, children, ...p }) {
  const [busy, setBusy] = useState(false);
  return html`<${Button} ...${p} disabled=${busy || p.disabled} onClick=${async (e) => { setBusy(true); try { await onClick(e); } finally { setBusy(false); } }}>${busy ? '…' : children}<//>`;
}

export const Toggle = ({ checked, onChange, label, help }) => html`
  <label class="toggle">
    <input type="checkbox" checked=${!!checked} onChange=${(e) => onChange(e.target.checked)} />
    <span class="track"><span class="thumb"></span></span>
    <span><span class="toggle-label">${label}</span>${help && html`<small class="help">${help}</small>`}</span>
  </label>`;

export const Empty = ({ icon = '📭', title, children }) => html`<div class="empty"><div class="empty-icon">${icon}</div><h3>${title}</h3>${children && html`<div class="muted">${children}</div>`}</div>`;
export const Loading = () => html`<div class="loading" aria-live="polite"><span class="spinner"></span> Loading…</div>`;
export const ErrorBox = ({ error, retry }) => html`<div class="alert alert-danger">⚠️ ${error} ${retry && html`<${Button} small onClick=${retry}>Try again<//>`}</div>`;
export const Alert = ({ tone = 'info', children }) => html`<div class="alert alert-${tone}">${children}</div>`;

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return html`
    <div class="modal-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label=${title}>
        <div class="modal-head"><h2>${title}</h2><button class="icon-btn" aria-label="Close" onClick=${onClose}>✕</button></div>
        <div class="modal-body">${children}</div>
        ${footer && html`<div class="modal-foot">${footer}</div>`}
      </div>
    </div>`;
}

export function Tabs({ tabs, active, onChange }) {
  return html`<div class="tabs" role="tablist">${tabs.filter(Boolean).map((t) => html`
    <button role="tab" aria-selected=${active === t.key} class=${active === t.key ? 'active' : ''} onClick=${() => onChange(t.key)}>${t.label}</button>`)}</div>`;
}

// ---------- schema-driven forms ----------
export const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
export function setPath(o, p, v) {
  const out = structuredClone(o || {});
  const keys = p.split('.');
  let cur = out;
  keys.slice(0, -1).forEach((k) => { cur[k] = cur[k] && typeof cur[k] === 'object' ? cur[k] : {}; cur = cur[k]; });
  cur[keys.at(-1)] = v;
  return out;
}

export function Field({ f, value, onChange }) {
  const id = `f-${f.key.replace(/\./g, '-')}`;
  const common = { id, name: f.key, placeholder: f.placeholder || '', required: f.required, disabled: f.disabled };
  let input;
  switch (f.type) {
    case 'toggle': return html`<div class="field">${html`<${Toggle} checked=${value} onChange=${onChange} label=${f.label} help=${f.help} />`}</div>`;
    case 'textarea': input = html`<textarea ...${common} rows=${f.rows || 4} value=${value ?? ''} onInput=${(e) => onChange(e.target.value)} />`; break;
    case 'select': input = html`<select ...${common} value=${value ?? ''} onChange=${(e) => onChange(f.numeric ? Number(e.target.value) : e.target.value)}>
      ${f.options.map((o) => html`<option value=${o.value ?? o}>${o.label ?? o}</option>`)}</select>`; break;
    case 'money': input = html`<div class="input-prefix"><span>₹</span><input ...${common} inputmode="decimal" value=${fromMinor(value)} onInput=${(e) => onChange(e.target.value === '' ? (f.nullable ? null : 0) : toMinor(e.target.value))} /></div>`; break;
    case 'number': input = html`<input ...${common} type="number" min=${f.min} max=${f.max} step=${f.step || 1} value=${value ?? ''} onInput=${(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />`; break;
    case 'checks': input = html`<div class="checks">${f.options.map((o) => html`<label class="check"><input type="checkbox" checked=${(value || []).includes(o.value)}
      onChange=${(e) => onChange(e.target.checked ? [...(value || []), o.value] : (value || []).filter((x) => x !== o.value))} /> ${o.label}</label>`)}</div>`; break;
    case 'custom': input = f.render(value, onChange); break;
    default: input = html`<input ...${common} type=${f.type || 'text'} autocomplete=${f.autocomplete || 'off'} value=${value ?? ''} onInput=${(e) => onChange(e.target.value)} />`;
  }
  return html`<div class="field ${f.wide ? 'wide' : ''}">
    <label for=${id}>${f.label}${f.required && html`<span class="req" aria-hidden="true"> *</span>`}</label>
    ${input}
    ${f.help && html`<small class="help">${f.help}</small>`}
  </div>`;
}

export const FormFields = ({ fields, value, onChange }) => html`<div class="form-grid">
  ${fields.filter((f) => !f.hidden?.(value)).map((f) => html`<${Field} key=${f.key} f=${f} value=${getPath(value, f.key)} onChange=${(v) => onChange(setPath(value, f.key, v))} />`)}
</div>`;

// ---------- weekly hours editor ----------
const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
export function HoursEditor({ value = {}, onChange }) {
  const set = (d, ranges) => onChange({ ...value, [d]: ranges });
  return html`<div class="hours">${DAYS.map(([d, label]) => {
    const ranges = value[d] || [];
    return html`<div class="hours-row">
      <div class="hours-day"><${Toggle} checked=${ranges.length > 0} onChange=${(on) => set(d, on ? [['09:00', '18:00']] : [])} label=${label} /></div>
      <div class="hours-ranges">
        ${ranges.length === 0 && html`<span class="muted">Closed</span>`}
        ${ranges.map(([a, b], i) => html`<span class="range">
          <input type="time" aria-label="${label} opens" value=${a} onInput=${(e) => set(d, ranges.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
          <span>to</span>
          <input type="time" aria-label="${label} closes" value=${b} onInput=${(e) => set(d, ranges.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
          <button class="icon-btn" aria-label="Remove time range" onClick=${() => set(d, ranges.filter((_, j) => j !== i))}>✕</button>
        </span>`)}
        ${ranges.length > 0 && ranges.length < 3 && html`<button class="link" onClick=${() => set(d, [...ranges, ['17:00', '20:00']])}>+ add break / 2nd shift</button>`}
      </div>
    </div>`;
  })}</div>`;
}

// ---------- question list editor (triage / lead questions) ----------
export function QuestionsEditor({ value = [], onChange, hint }) {
  const upd = (i, patch) => onChange(value.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return html`<div class="questions">
    ${hint && html`<p class="help">${hint}</p>`}
    ${value.map((q, i) => html`<div class="question">
      <div class="q-num">${i + 1}</div>
      <div class="q-body">
        <input aria-label="Question ${i + 1}" placeholder="Question the customer is asked" value=${q.question} onInput=${(e) => upd(i, { question: e.target.value })} />
        <div class="row gap wrap">
          <input aria-label="Short label" class="sm-input" placeholder="Short label (e.g. Budget)" value=${q.key || ''} onInput=${(e) => upd(i, { key: e.target.value })} />
          <input aria-label="Answer buttons" class="grow" placeholder="Answer buttons, comma separated (leave empty = customer types)" value=${(q.options || []).join(', ')}
            onInput=${(e) => upd(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </div>
      </div>
      <div class="q-tools">
        <button class="icon-btn" aria-label="Move up" disabled=${i === 0} onClick=${() => { const a = [...value]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(a); }}>↑</button>
        <button class="icon-btn" aria-label="Remove" onClick=${() => onChange(value.filter((_, j) => j !== i))}>✕</button>
      </div>
    </div>`)}
    <${Button} small onClick=${() => onChange([...value, { key: '', question: '', options: [] }])}>+ Add question<//>
  </div>`;
}

// ---------- generic list + edit modal (products, services, staff, FAQs...) ----------
export function ResourceManager({ path, singular, fields, columns, defaults = {}, empty, toolbar, filter, onChanged, rowActions }) {
  const { data, error, loading, reload } = useApi(`/${path}`);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const save = async () => {
    const isNew = !editing.id;
    const r = await act(() => api(isNew ? `/${path}` : `/${path}/${editing.id}`, { method: isNew ? 'POST' : 'PUT', body: editing }), `${singular} saved`);
    if (r) { setEditing(null); reload(); onChanged?.(); }
  };
  const remove = async (item) => {
    if (!confirm(`Delete this ${singular.toLowerCase()}? This cannot be undone.`)) return;
    if (await act(() => api(`/${path}/${item.id}`, { method: 'DELETE' }), 'Deleted')) { reload(); onChanged?.(); }
  };
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const items = (data?.items || []).filter((it) => !q || JSON.stringify(it).toLowerCase().includes(q.toLowerCase())).filter(filter || (() => true));
  return html`<div>
    <div class="toolbar">
      <input class="search" type="search" placeholder="Search…" aria-label="Search" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="row gap wrap">${toolbar?.(reload)}<${Button} variant="primary" onClick=${() => setEditing({ ...defaults })}>+ Add ${singular.toLowerCase()}<//></div>
    </div>
    ${items.length === 0 ? html`<${Empty} title=${`No ${singular.toLowerCase()}s yet`}>${empty}<//>` : html`
    <div class="table-wrap"><table class="table">
      <thead><tr>${columns.map((c) => html`<th>${c.label}</th>`)}<th class="right">Actions</th></tr></thead>
      <tbody>${items.map((it) => html`<tr>
        ${columns.map((c) => html`<td data-label=${c.label}>${c.render ? c.render(it, reload) : it[c.key]}</td>`)}
        <td class="right nowrap">${rowActions?.(it, reload)}<${Button} small onClick=${() => setEditing(structuredClone(it))}>Edit<//> <${Button} small variant="ghost danger" onClick=${() => remove(it)}>Delete<//></td>
      </tr>`)}</tbody>
    </table></div>`}
    ${editing && html`<${Modal} title=${editing.id ? `Edit ${singular.toLowerCase()}` : `Add ${singular.toLowerCase()}`} onClose=${() => setEditing(null)}
      footer=${html`<${Button} onClick=${() => setEditing(null)}>Cancel<//><${AsyncButton} variant="primary" onClick=${save}>Save<//>`}>
      <${FormFields} fields=${fields} value=${editing} onChange=${setEditing} />
    <//>`}
  </div>`;
}

/** Inline in-stock / active switch for tables. */
export function QuickToggle({ path, item, field, onDone, label }) {
  return html`<${Toggle} checked=${item[field]} label=${label} onChange=${async (v) => { if (await act(() => api(`/${path}/${item.id}`, { method: 'PUT', body: { [field]: v } }))) onDone(); }} />`;
}

export const Money = ({ value }) => {
  const { biz } = useApp();
  return html`<span class="nowrap">${money(value, biz?.currency)}</span>`;
};

/** Copyable value box. */
export function Copy({ value, label }) {
  return html`<div class="copy">
    ${label && html`<span class="copy-label">${label}</span>`}
    <code>${value || '—'}</code>
    ${value && html`<button class="btn sm" onClick=${() => navigator.clipboard?.writeText(value).then(() => import('./lib.js').then((m) => m.toast('Copied')))}>Copy</button>`}
  </div>`;
}
