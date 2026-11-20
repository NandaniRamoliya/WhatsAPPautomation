import { useState } from 'preact/hooks';
import { html, useApi, useApp } from '../lib.js';
import { Page, ResourceManager, QuickToggle, Money, Tabs, HoursEditor, Toggle, Badge } from '../ui.js';

function StaffHours(value, onChange) {
  const { biz } = useApp();
  const custom = value && Object.keys(value).length > 0;
  return html`<div class="col">
    <${Toggle} checked=${custom} onChange=${(on) => onChange(on ? structuredClone(biz.settings.hours) : null)} label="Different hours from the business" help="Off = uses the business opening hours." />
    ${custom && html`<${HoursEditor} value=${value} onChange=${onChange} />`}
  </div>`;
}

export function Services() {
  const { biz } = useApp();
  const [tab, setTab] = useState('services');
  const services = useApi('/services');
  const staff = useApi('/staff');
  const label = biz.settings.booking.staff_label || 'Staff';
  const svcOptions = (services.data?.items || []).map((s) => ({ value: s.id, label: s.name }));
  return html`<${Page} title="Services & staff" subtitle="What can be booked, how long it takes, and who does it.">
    <${Tabs} active=${tab} onChange=${setTab} tabs=${[{ key: 'services', label: 'Services' }, { key: 'staff', label: `${label}s` }, { key: 'off', label: 'Holidays & leave' }]} />
    ${tab === 'services' && html`<${ResourceManager} path="services" singular="Service" onChanged=${services.reload} defaults=${{ duration_min: 30, price: 0, active: 1 }}
      empty="Add the services customers can book, e.g. Consultation, Haircut, Cleaning."
      columns=${[
        { label: 'Service', render: (s) => html`<strong>${s.name}</strong>${s.description && html`<div class="small muted">${s.description}</div>`}` },
        { label: 'Duration', render: (s) => `${s.duration_min} min` },
        { label: 'Price', render: (s) => (s.price ? html`<${Money} value=${s.price} />` : 'Free') },
        { label: 'Follow-ups', render: (s) => html`${s.aftercare ? html`<${Badge} tone="info">Aftercare<//> ` : ''}${s.recall_days ? html`<${Badge} tone="ok">Recall ${s.recall_days}d<//>` : ''}` },
        { label: 'Bookable', render: (s, reload) => html`<${QuickToggle} path="services" item=${s} field="active" onDone=${reload} />` },
      ]}
      fields=${[
        { key: 'name', label: 'Service name', required: true },
        { key: 'duration_min', label: 'Duration (minutes)', type: 'number', min: 5, required: true },
        { key: 'price', label: 'Price (shown to customer)', type: 'money' },
        { key: 'category', label: 'Category / tag', help: 'Customers who book get this tag – useful for broadcasts.' },
        { key: 'description', label: 'Short description', wide: true },
        { key: 'aftercare', label: 'Aftercare message (sent when you mark the visit done)', type: 'textarea', wide: true, placeholder: 'Avoid hot food for 24 hours. Take medicines as prescribed.' },
        { key: 'recall_days', label: 'Recall after (days)', type: 'number', help: 'e.g. 180 = "your 6-month cleaning is due". Empty = no recall.' },
        { key: 'sort', label: 'Sort order', type: 'number' },
        { key: 'active', label: 'Customers can book this', type: 'toggle' },
      ]} />`}
    ${tab === 'staff' && html`<${ResourceManager} path="staff" singular=${label} onChanged=${staff.reload} defaults=${{ active: 1, service_ids: [], hours: null }}
      empty=${`Add at least one ${label.toLowerCase()} so the bot knows whose calendar to fill.`}
      columns=${[
        { label: 'Name', render: (s) => html`<strong>${s.name}</strong><div class="small muted">${s.title || ''}</div>` },
        { label: 'Services', render: (s) => (s.service_ids?.length ? s.service_ids.map((id) => svcOptions.find((o) => o.value === id)?.label).filter(Boolean).join(', ') : 'All services') },
        { label: 'Hours', render: (s) => (s.hours && Object.keys(s.hours).length ? 'Custom' : 'Business hours') },
        { label: 'Takes bookings', render: (s, reload) => html`<${QuickToggle} path="staff" item=${s} field="active" onDone=${reload} />` },
      ]}
      fields=${[
        { key: 'name', label: 'Name', required: true },
        { key: 'title', label: 'Title', placeholder: label },
        { key: 'phone', label: 'WhatsApp number (optional)', help: 'Gets an alert for each new booking.' },
        { key: 'service_ids', label: 'Services this person does', type: 'checks', options: svcOptions, wide: true, help: 'Leave all unticked = does every service.' },
        { key: 'hours', label: 'Working hours', type: 'custom', wide: true, render: StaffHours },
        { key: 'active', label: 'Takes bookings', type: 'toggle' },
      ]} />`}
    ${tab === 'off' && html`<${ResourceManager} path="time-off" singular="Holiday / leave" defaults=${{ staff_id: null }}
      empty="Add festival holidays or a doctor's leave. No slots are offered on those days."
      columns=${[
        { label: 'From', key: 'date_from' }, { label: 'To', key: 'date_to' },
        { label: 'Who', render: (t) => (t.staff_id ? (staff.data?.items || []).find((s) => s.id === t.staff_id)?.name : 'Whole business closed') },
        { label: 'Reason', key: 'reason' },
      ]}
      fields=${[
        { key: 'date_from', label: 'From', type: 'date', required: true },
        { key: 'date_to', label: 'To (inclusive)', type: 'date', required: true },
        { key: 'staff_id', label: 'Who', type: 'select', numeric: true, options: [{ value: '', label: 'Whole business closed' }, ...(staff.data?.items || []).map((s) => ({ value: s.id, label: s.name }))] },
        { key: 'reason', label: 'Reason (internal)' },
      ]} />`}
  <//>`;
}
