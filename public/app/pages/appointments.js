import { useState, useEffect } from 'preact/hooks';
import { html, api, act, useApi, useApp, useInterval, fmtTime, ymdIn, addDays, phoneFmt, download } from '../lib.js';
import { Page, Badge, Button, AsyncButton, Empty, Loading, ErrorBox, Modal, Field, Toggle } from '../ui.js';

function SlotPicker({ serviceId, staffId, date, value, onChange, exclude }) {
  const { data, loading } = useApi(serviceId && date ? `/slots?service_id=${serviceId}&date=${date}&staff_id=${staffId || ''}&exclude=${exclude || ''}` : null, [serviceId, staffId, date]);
  if (!serviceId) return html`<p class="muted">Choose a service first.</p>`;
  if (loading) return html`<${Loading} />`;
  if (!data?.slots.length) return html`<p class="muted">No free slots on this day.</p>`;
  return html`<div class="slot-grid">${data.slots.map((s) => html`<button type="button" class=${value === s.start ? 'selected' : ''} onClick=${() => onChange(s.start)}>${s.label}</button>`)}</div>`;
}

function BookModal({ onClose, onDone, date: initialDate }) {
  const services = useApi('/services');
  const staff = useApi('/staff');
  const [f, setF] = useState({ name: '', phone: '', service_id: '', staff_id: '', date: initialDate, start: '', notes: '', notify: true });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v, ...(k !== 'start' && k !== 'name' && k !== 'phone' && k !== 'notes' && k !== 'notify' ? { start: '' } : {}) }));
  const save = async () => { if (await act(() => api('/appointments', { method: 'POST', body: f }), 'Appointment booked')) { onDone(); onClose(); } };
  return html`<${Modal} title="New appointment (phone call / walk-in)" onClose=${onClose} wide
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${AsyncButton} variant="primary" disabled=${!f.start || !f.phone} onClick=${save}>Book<//>`}>
    <div class="form-grid">
      <${Field} f=${{ key: 'name', label: 'Customer name' }} value=${f.name} onChange=${set('name')} />
      <${Field} f=${{ key: 'phone', label: 'WhatsApp number', required: true, placeholder: '98765 43210', help: 'With or without country code' }} value=${f.phone} onChange=${set('phone')} />
      <${Field} f=${{ key: 'service_id', label: 'Service', type: 'select', numeric: true, options: [{ value: '', label: 'Choose…' }, ...(services.data?.items || []).filter((s) => s.active).map((s) => ({ value: s.id, label: `${s.name} (${s.duration_min} min)` }))] }} value=${f.service_id} onChange=${set('service_id')} />
      <${Field} f=${{ key: 'staff_id', label: 'Staff', type: 'select', numeric: true, options: [{ value: '', label: 'Any available' }, ...(staff.data?.items || []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))] }} value=${f.staff_id} onChange=${set('staff_id')} />
      <${Field} f=${{ key: 'date', label: 'Date', type: 'date' }} value=${f.date} onChange=${set('date')} />
      <${Field} f=${{ key: 'notes', label: 'Notes (internal)' }} value=${f.notes} onChange=${set('notes')} />
    </div>
    <h3 style="margin:16px 0 8px">Pick a time</h3>
    <${SlotPicker} serviceId=${f.service_id} staffId=${f.staff_id} date=${f.date} value=${f.start} onChange=${set('start')} />
    <div style="margin-top:14px"><${Toggle} checked=${f.notify} onChange=${set('notify')} label="Send WhatsApp confirmation to the customer" help="They also get automatic reminders." /></div>
  <//>`;
}

function CompleteModal({ appt, onClose, onDone }) {
  const [note, setNote] = useState('');
  const save = async () => { if (await act(() => api(`/appointments/${appt.id}/status`, { method: 'POST', body: { status: 'COMPLETED', note } }), 'Marked done – aftercare sent')) { onDone(); onClose(); } };
  return html`<${Modal} title=${`Visit done: ${appt.customer_name || ''}`} onClose=${onClose}
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${AsyncButton} variant="primary" onClick=${save}>Mark done & send<//>`}>
    <p class="muted">The customer gets the service's aftercare message${note ? ' plus your note' : ''} on WhatsApp. A "how are you feeling?" check-in and recall reminder are scheduled automatically.</p>
    <${Field} f=${{ key: 'note', label: 'Prescription / personal note (optional)', type: 'textarea', rows: 6, placeholder: '💊 Amoxicillin 500 — 1-0-1 · 5 days\n⚠️ Avoid hot food for 24 hours' }} value=${note} onChange=${setNote} />
  <//>`;
}

function RescheduleModal({ appt, onClose, onDone }) {
  const { biz } = useApp();
  const [date, setDate] = useState(ymdIn(biz.timezone, new Date(appt.start_at)));
  const [start, setStart] = useState('');
  const save = async () => { if (await act(() => api(`/appointments/${appt.id}/reschedule`, { method: 'POST', body: { start } }), 'Moved – customer notified')) { onDone(); onClose(); } };
  return html`<${Modal} title="Move appointment" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel<//><${AsyncButton} variant="primary" disabled=${!start} onClick=${save}>Move<//>`}>
    <${Field} f=${{ key: 'date', label: 'New date', type: 'date' }} value=${date} onChange=${(d) => { setDate(d); setStart(''); }} />
    <h3 style="margin:14px 0 8px">New time</h3>
    <${SlotPicker} serviceId=${appt.service_id} staffId=${appt.staff_id} date=${date} value=${start} onChange=${setStart} exclude=${appt.id} />
  <//>`;
}

export function Appointments() {
  const { biz } = useApp();
  const today = ymdIn(biz.timezone);
  const [date, setDate] = useState(today);
  const [days, setDays] = useState(1);
  const [test, setTest] = useState(false);
  const [modal, setModal] = useState(null);
  const { data, error, loading, reload } = useApi(`/appointments?date=${date}&days=${days}&test=${test ? 1 : 0}`, [date, days, test]);
  useInterval(reload, 15000);
  useEffect(() => { if (location.hash.includes('new=1')) setModal({ type: 'book' }); }, []);
  const setStatus = (a, status) => act(() => api(`/appointments/${a.id}/status`, { method: 'POST', body: { status } }), 'Updated').then(reload);
  const cancel = (a) => { const reason = prompt('Reason (sent to the customer, optional):', ''); if (reason !== null) act(() => api(`/appointments/${a.id}/status`, { method: 'POST', body: { status: 'CANCELLED', reason } }), 'Cancelled – customer notified').then(reload); };

  let lastDay = '';
  return html`<${Page} title="Appointments" subtitle="Bookings from WhatsApp appear here automatically. Reminders go out on their own."
    actions=${html`<${Button} onClick=${() => download('/appointments-export.csv')}>⬇ Export<//><${Button} variant="primary" onClick=${() => setModal({ type: 'book' })}>+ New appointment<//>`}>
    <div class="toolbar">
      <div class="row gap wrap">
        <${Button} onClick=${() => setDate(addDays(date, -days))} aria-label="Previous">←<//>
        <input type="date" aria-label="Date" value=${date} onInput=${(e) => setDate(e.target.value)} style="width:auto" />
        <${Button} onClick=${() => setDate(addDays(date, days))} aria-label="Next">→<//>
        <${Button} onClick=${() => setDate(today)}>Today<//>
        <select aria-label="Range" value=${days} onChange=${(e) => setDays(Number(e.target.value))} style="width:auto"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select>
      </div>
      <${Toggle} checked=${test} onChange=${setTest} label="Show test bookings" />
    </div>
    ${error ? html`<${ErrorBox} error=${error} retry=${reload} />` : loading && !data ? html`<${Loading} />`
      : data.appointments.length === 0 ? html`<${Empty} icon="📅" title="No appointments">Share your WhatsApp link so customers can book 24×7.<//>`
        : data.appointments.map((a) => {
          const day = ymdIn(biz.timezone, new Date(a.start_at));
          const header = days > 1 && day !== lastDay ? html`<h3 style="margin:14px 0 8px">${new Date(`${day}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</h3>` : null;
          lastDay = day;
          const active = ['BOOKED', 'CONFIRMED'].includes(a.status);
          return html`${header}<div class="appt ${a.status === 'CANCELLED' ? 'cancelled' : ''}">
            <div class="appt-time">${fmtTime(a.start_at, biz.timezone)}<div class="muted small">${a.staff_name || ''}</div></div>
            <div>
              <div class="row gap wrap"><strong>${a.customer_name || 'Customer'}</strong><${Badge} status=${a.status} />${a.source === 'dashboard' && html`<${Badge} tone="muted">Added by staff<//>`}</div>
              <div>${a.service_name} · <a href=${`#/inbox?phone=${a.phone}`}>${phoneFmt(a.phone)}</a></div>
              ${Object.keys(a.intake || {}).length > 0 && html`<div class="small muted">${Object.entries(a.intake).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>`}
              ${a.notes && html`<div class="small">📝 ${a.notes}</div>`}
            </div>
            <div class="row gap wrap" style="align-content:flex-start">
              ${active && html`<${Button} small variant="primary" onClick=${() => setModal({ type: 'complete', appt: a })}>✅ Visit done<//>`}
              ${a.status === 'BOOKED' && html`<${Button} small onClick=${() => setStatus(a, 'CONFIRMED')}>Confirm<//>`}
              ${active && html`<${Button} small onClick=${() => setModal({ type: 'move', appt: a })}>Move<//>`}
              ${active && html`<${Button} small onClick=${() => setStatus(a, 'NO_SHOW')}>No-show<//>`}
              ${active && html`<${Button} small variant="ghost danger" onClick=${() => cancel(a)}>Cancel<//>`}
            </div>
          </div>`;
        })}
    ${modal?.type === 'book' && html`<${BookModal} date=${date} onClose=${() => setModal(null)} onDone=${reload} />`}
    ${modal?.type === 'complete' && html`<${CompleteModal} appt=${modal.appt} onClose=${() => setModal(null)} onDone=${reload} />`}
    ${modal?.type === 'move' && html`<${RescheduleModal} appt=${modal.appt} onClose=${() => setModal(null)} onDone=${reload} />`}
  <//>`;
}
