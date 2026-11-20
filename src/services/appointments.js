// Appointment engine: availability, race-safe booking, reminders, aftercare,
// check-ins with review requests, and recalls.
import { all, get, run, insert, tx, parseJson, now } from '../db/index.js';
import { zonedToUtc, todayIn, addDays, weekdayOf, hmToMin, minToHm, fmtDate, fmtTime, dayLabel, tzParts } from '../lib/time.js';
import { money } from '../lib/util.js';
import { text } from '../engine/texts.js';
import * as B from '../whatsapp/builders.js';
import { send } from '../whatsapp/sender.js';
import { notifyOwner, notifyPhone } from './notify.js';
import { schedule, cancelJobs, registerJob } from './jobs.js';
import { slotTemplate } from './templates.js';
import { getCustomer, firstName, ensureCustomer, addTags } from './customers.js';
import { getBusiness } from './business.js';
import { loadSession, saveSession } from '../engine/session.js';

const ACTIVE = `('BOOKED','CONFIRMED')`;
export const APPT_STATUSES = ['BOOKED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

export class SlotTakenError extends Error { constructor() { super('slot_taken'); } }

// ---------- lookups ----------
export const listServices = (bizId) => all('SELECT * FROM services WHERE business_id = ? AND active = 1 ORDER BY sort, name', bizId);
export const getService = (bizId, id) => get('SELECT * FROM services WHERE business_id = ? AND id = ?', bizId, Number(id));
export const getStaff = (bizId, id) => parseJson(get('SELECT * FROM staff WHERE business_id = ? AND id = ?', bizId, Number(id)), ['service_ids', 'hours']);

export function staffForService(bizId, serviceId) {
  return all('SELECT * FROM staff WHERE business_id = ? AND active = 1 ORDER BY sort, name', bizId)
    .map((s) => parseJson(s, ['service_ids', 'hours']))
    .filter((s) => !s.service_ids?.length || s.service_ids.map(Number).includes(Number(serviceId)));
}

/** Staff candidates; if the business has no staff at all, the business itself is one "calendar". */
function resources(biz, serviceId, staffId) {
  if (staffId) { const s = getStaff(biz.id, staffId); return s ? [s] : []; }
  const list = staffForService(biz.id, serviceId);
  if (list.length) return list;
  const anyStaff = get('SELECT COUNT(*) AS n FROM staff WHERE business_id = ? AND active = 1', biz.id).n;
  return anyStaff ? [] : [{ id: null, name: biz.name, hours: null }];
}

export function getAppointment(bizId, id) {
  const a = parseJson(get(`SELECT a.*, s.name AS service_name, s.duration_min, s.price AS service_price, st.name AS staff_name
    FROM appointments a LEFT JOIN services s ON s.id = a.service_id LEFT JOIN staff st ON st.id = a.staff_id
    WHERE a.business_id = ? AND a.id = ?`, bizId, Number(id)), ['intake']);
  return a;
}

export const upcomingFor = (bizId, phone) => all(`SELECT a.*, s.name AS service_name, st.name AS staff_name FROM appointments a
  LEFT JOIN services s ON s.id = a.service_id LEFT JOIN staff st ON st.id = a.staff_id
  WHERE a.business_id = ? AND a.phone = ? AND a.status IN ${ACTIVE} AND a.start_at > ? ORDER BY a.start_at LIMIT 9`, bizId, phone, now());

// ---------- availability ----------
function isOff(bizId, staffId, ymd) {
  return Boolean(get(`SELECT 1 FROM time_off WHERE business_id = ? AND (staff_id IS NULL OR staff_id IS ?) AND date_from <= ? AND date_to >= ? LIMIT 1`,
    bizId, staffId, ymd, ymd));
}

function busy(bizId, staffId, fromIso, toIso, excludeId = 0) {
  return all(`SELECT start_at, end_at FROM appointments WHERE business_id = ? AND staff_id IS ? AND status IN ${ACTIVE}
    AND start_at < ? AND end_at > ? AND id != ?`, bizId, staffId, toIso, fromIso, excludeId)
    .map((r) => [Date.parse(r.start_at), Date.parse(r.end_at)]);
}

/**
 * Free slots on a local date. Returns [{ start: ISO, staffIds: [..] }] sorted by time.
 * staffId = null means "any available".
 */
export function slotsFor(biz, service, ymd, staffId = null, { excludeId = 0 } = {}) {
  const tz = biz.timezone;
  const cfg = biz.settings.booking;
  const step = Math.max(5, Number(cfg.slot_interval) || 30);
  const dur = Math.max(5, Number(service.duration_min) || 30);
  const earliest = Date.now() + (Number(cfg.min_notice_min) || 0) * 60_000;
  const dayStart = zonedToUtc(ymd, '00:00', tz).toISOString();
  const dayEnd = zonedToUtc(addDays(ymd, 1), '00:00', tz).toISOString();
  const byStart = new Map();

  for (const r of resources(biz, service.id, staffId)) {
    if (isOff(biz.id, r.id, ymd)) continue;
    const hours = (r.hours && Object.keys(r.hours).length ? r.hours : biz.settings.hours)[weekdayOf(ymd)] || [];
    const taken = busy(biz.id, r.id, dayStart, dayEnd, excludeId);
    for (const [from, to] of hours) {
      for (let m = hmToMin(from); m + dur <= hmToMin(to); m += step) {
        const s = zonedToUtc(ymd, minToHm(m), tz).getTime();
        const e = s + dur * 60_000;
        if (s < earliest) continue;
        if (taken.some(([a, b]) => s < b && e > a)) continue;
        const key = new Date(s).toISOString();
        if (!byStart.has(key)) byStart.set(key, []);
        byStart.get(key).push(r.id);
      }
    }
  }
  return [...byStart.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([start, staffIds]) => ({ start, staffIds }));
}

/** Local dates (YYYY-MM-DD) within the booking window that have at least one free slot. */
export function availableDates(biz, service, staffId = null, max = 10) {
  const out = [];
  const today = todayIn(biz.timezone);
  const days = Math.max(1, Number(biz.settings.booking.days_ahead) || 7);
  for (let i = 0; i < days && out.length < max; i++) {
    const ymd = addDays(today, i);
    const slots = slotsFor(biz, service, ymd, staffId);
    if (slots.length) out.push({ ymd, count: slots.length });
  }
  return out;
}

// ---------- formatting ----------
export function apptVars(biz, a) {
  const service = a.service_name || getService(biz.id, a.service_id)?.name || '';
  const staff = a.staff_name || (a.staff_id ? getStaff(biz.id, a.staff_id)?.name : '') || biz.name;
  return {
    ref: `#A${a.id}`, service, staff, name: a.customer_name || 'Customer', phone: a.phone,
    date: fmtDate(a.start_at, biz.timezone), time: fmtTime(a.start_at, biz.timezone),
    address: biz.address || biz.name, map: biz.map_link ? `\n🗺️ ${biz.map_link}` : '',
    name_sp: a.customer_name ? ` ${firstName(a.customer_name)}` : '',
  };
}

export const slotLabel = (biz, iso) => fmtTime(iso, biz.timezone);
export const dateLabel = (biz, ymd) => dayLabel(ymd, biz.timezone, { today: biz.language === 'hinglish' ? 'Aaj' : 'Today', tomorrow: biz.language === 'hinglish' ? 'Kal' : 'Tomorrow' });

// ---------- booking ----------
/** Race-safe: re-checks overlap inside an IMMEDIATE transaction + unique index. */
export function book(biz, { phone, name, serviceId, staffId = null, start, intake = {}, notes = null, source = 'whatsapp' }) {
  const service = getService(biz.id, serviceId);
  if (!service) throw new Error('service not found');
  const startMs = Date.parse(start);
  const endIso = new Date(startMs + service.duration_min * 60_000).toISOString();
  const customer = ensureCustomer(biz.id, phone, name);
  let id;
  try {
    id = tx(() => {
      const candidates = resources(biz, service.id, staffId);
      const free = candidates.find((r) => !get(`SELECT 1 FROM appointments WHERE business_id = ? AND staff_id IS ? AND status IN ${ACTIVE}
        AND start_at < ? AND end_at > ? LIMIT 1`, biz.id, r.id, endIso, start));
      if (!free) throw new SlotTakenError();
      return insert('appointments', {
        business_id: biz.id, customer_id: customer.id, phone, customer_name: name || customer.name, service_id: service.id,
        staff_id: free.id, start_at: new Date(startMs).toISOString(), end_at: endIso, status: 'BOOKED',
        intake: JSON.stringify(intake), notes, source, created_at: now(), updated_at: now(),
      });
    });
  } catch (e) {
    if (e instanceof SlotTakenError || /UNIQUE constraint/.test(e.message)) throw new SlotTakenError();
    throw e;
  }
  if (name && !customer.name) run('UPDATE customers SET name = ? WHERE id = ?', name, customer.id);
  addTags(customer.id, [service.category || service.name]);
  const appt = getAppointment(biz.id, id);
  scheduleReminders(biz, appt);
  return appt;
}

export async function alertNewBooking(biz, appt) {
  const v = apptVars(biz, appt);
  const intake = Object.entries(appt.intake || {}).map(([k, val]) => `${k}: ${val}`).join('\n');
  const msg = text(biz, 'owner_new_booking', { ...v, intake: intake ? `\n${intake}` : '' });
  await notifyOwner(biz, msg);
  if (biz.settings.notify?.staff_whatsapp && appt.staff_id) {
    const st = getStaff(biz.id, appt.staff_id);
    if (st?.phone && st.phone !== biz.owner_phone) await notifyPhone(biz, st.phone, msg);
  }
}

export function scheduleReminders(biz, appt) {
  cancelJobs(`appt:${appt.id}`, 'appt.reminder');
  const start = Date.parse(appt.start_at);
  for (const r of biz.settings.booking.reminders || []) {
    if (!r.enabled) continue;
    const at = start - Number(r.minutes_before) * 60_000;
    // skip reminders whose time already passed, or that would land within 10 minutes of booking
    if (at > Date.now() + 10 * 60_000) schedule(biz.id, 'appt.reminder', at, { id: appt.id, minutes_before: r.minutes_before }, `appt:${appt.id}`);
  }
}

export async function cancelAppointment(biz, id, { by = 'customer', reason = '' } = {}) {
  const a = getAppointment(biz.id, id);
  if (!a || !['BOOKED', 'CONFIRMED'].includes(a.status)) return false;
  run(`UPDATE appointments SET status = 'CANCELLED', updated_at = ? WHERE id = ?`, now(), a.id);
  cancelJobs(`appt:${a.id}`);
  const v = apptVars(biz, a);
  if (by === 'business') {
    await send(biz, a.phone, B.text(text(biz, 'appt_cancelled_by_business', { ...v, reason: reason ? ` ${reason}` : '' })));
  } else {
    await notifyOwner(biz, text(biz, 'owner_cancelled_booking', v));
  }
  return true;
}

export async function rescheduleAppointment(biz, id, start, { staffId, by = 'business' } = {}) {
  const a = getAppointment(biz.id, id);
  if (!a || !['BOOKED', 'CONFIRMED'].includes(a.status)) throw new Error('appointment not active');
  const service = getService(biz.id, a.service_id);
  const endIso = new Date(Date.parse(start) + (service?.duration_min || 30) * 60_000).toISOString();
  const target = staffId !== undefined ? staffId : a.staff_id;
  try {
    tx(() => {
      if (get(`SELECT 1 FROM appointments WHERE business_id = ? AND staff_id IS ? AND status IN ${ACTIVE} AND start_at < ? AND end_at > ? AND id != ?`,
        biz.id, target, endIso, start, a.id)) throw new SlotTakenError();
      run(`UPDATE appointments SET start_at = ?, end_at = ?, staff_id = ?, status = 'BOOKED', updated_at = ? WHERE id = ?`,
        new Date(Date.parse(start)).toISOString(), endIso, target, now(), a.id);
    });
  } catch (e) {
    if (e instanceof SlotTakenError || /UNIQUE constraint/.test(e.message)) throw new SlotTakenError();
    throw e;
  }
  const updated = getAppointment(biz.id, a.id);
  scheduleReminders(biz, updated);
  if (by === 'business') await send(biz, a.phone, B.text(text(biz, 'appt_moved', apptVars(biz, updated))));
  return updated;
}

export function setApptStatus(biz, id, status) {
  if (!APPT_STATUSES.includes(status)) throw new Error('invalid status');
  run('UPDATE appointments SET status = ?, updated_at = ? WHERE business_id = ? AND id = ?', status, now(), biz.id, Number(id));
  if (['NO_SHOW', 'CANCELLED'].includes(status)) cancelJobs(`appt:${id}`);
  return getAppointment(biz.id, id);
}

/** Visit done: send aftercare, schedule check-in and recall. */
export async function completeAppointment(biz, id, { note = '' } = {}) {
  const a = getAppointment(biz.id, id);
  if (!a) throw new Error('not found');
  if (a.status === 'COMPLETED') return a;
  run(`UPDATE appointments SET status = 'COMPLETED', aftercare_note = ?, updated_at = ? WHERE id = ?`, note || null, now(), a.id);
  cancelJobs(`appt:${a.id}`, 'appt.reminder');
  run('UPDATE customers SET last_visit_at = ? WHERE business_id = ? AND phone = ?', now(), biz.id, a.phone);
  const service = getService(biz.id, a.service_id);
  const care = [service?.aftercare, note].filter(Boolean).join('\n\n');
  if (care) await send(biz, a.phone, B.text(text(biz, 'aftercare', { ...apptVars(biz, a), aftercare: care })));
  const cfg = biz.settings.booking;
  if (Number(cfg.checkin_days) > 0) schedule(biz.id, 'appt.checkin', Date.now() + cfg.checkin_days * 86400_000, { id: a.id }, `appt:${a.id}`);
  if (service?.recall_days > 0) schedule(biz.id, 'appt.recall', Date.parse(a.start_at) + service.recall_days * 86400_000, { id: a.id }, `recall:${a.phone}:${service.id}`);
  return getAppointment(biz.id, a.id);
}

/** Auto-complete visits N hours after they end (if enabled), so follow-ups run without staff clicks. */
export async function autoCompleteDue() {
  const rows = all(`SELECT a.id, a.business_id FROM appointments a WHERE a.status IN ${ACTIVE} AND a.end_at < ?`, now());
  for (const r of rows) {
    const biz = getBusiness(r.business_id);
    const h = Number(biz?.settings.booking.auto_complete_hours) || 0;
    const a = getAppointment(r.business_id, r.id);
    if (biz && h > 0 && Date.parse(a.end_at) + h * 3600_000 < Date.now()) await completeAppointment(biz, r.id);
  }
}

// ---------- scheduled jobs ----------
const canMessage = (biz, phone) => getCustomer(biz.id, phone)?.opted_in !== 0;

registerJob('appt.reminder', async (job) => {
  const biz = getBusiness(job.business_id);
  const a = biz && getAppointment(biz.id, job.payload.id);
  if (!a || !['BOOKED', 'CONFIRMED'].includes(a.status) || !canMessage(biz, a.phone)) return;
  const v = apptVars(biz, a);
  const mins = Number(job.payload.minutes_before);
  const today = todayIn(biz.timezone);
  const apptDay = tzParts(a.start_at, biz.timezone).ymd;
  const when = mins <= 180 ? text(biz, 'when_in_hours', { hours: Math.max(1, Math.round(mins / 60)) })
    : apptDay === today ? text(biz, 'when_today') : apptDay === addDays(today, 1) ? text(biz, 'when_tomorrow') : text(biz, 'when_on');
  const msg = B.buttons(text(biz, 'reminder', { ...v, when }), [
    { id: `bk:ok:${a.id}`, title: text(biz, 'btn_rem_confirm') },
    { id: `bk:rs:${a.id}`, title: text(biz, 'btn_reschedule') },
    { id: `bk:cx:${a.id}`, title: text(biz, 'btn_cancel_appt') },
  ]);
  await send(biz, a.phone, msg, {
    fallbackTemplate: slotTemplate(biz, 'appointment_reminder', [firstName(v.name) || 'there', v.service, v.date, v.time], [`bk:ok:${a.id}`, `bk:rs:${a.id}`]),
  });
});

registerJob('appt.checkin', async (job) => {
  const biz = getBusiness(job.business_id);
  const a = biz && getAppointment(biz.id, job.payload.id);
  if (!a || a.status !== 'COMPLETED' || !canMessage(biz, a.phone)) return;
  const v = apptVars(biz, a);
  const msg = B.buttons(text(biz, 'checkin', v), [
    { id: `bk:ci:good:${a.id}`, title: text(biz, 'btn_ci_good') },
    { id: `bk:ci:same:${a.id}`, title: text(biz, 'btn_ci_same') },
    { id: `bk:ci:bad:${a.id}`, title: text(biz, 'btn_ci_bad') },
  ]);
  await send(biz, a.phone, msg, {
    fallbackTemplate: slotTemplate(biz, 'appointment_checkin', [firstName(v.name) || 'there', v.service], [`bk:ci:good:${a.id}`, `bk:ci:same:${a.id}`, `bk:ci:bad:${a.id}`]),
  });
});

registerJob('appt.recall', async (job) => {
  const biz = getBusiness(job.business_id);
  const a = biz && getAppointment(biz.id, job.payload.id);
  if (!a || !canMessage(biz, a.phone)) return;
  // skip if they already booked this service again
  const again = get(`SELECT 1 FROM appointments WHERE business_id = ? AND phone = ? AND service_id = ? AND id != ? AND start_at > ? AND status != 'CANCELLED'`,
    biz.id, a.phone, a.service_id, a.id, a.start_at);
  if (again) return;
  const v = apptVars(biz, a);
  const session = loadSession(biz.id, a.phone);
  session.ctx.recallService = a.service_id;
  saveSession(session);
  await send(biz, a.phone, B.buttons(text(biz, 'recall', v), [{ id: `bk:svc:${a.service_id}`, title: text(biz, 'btn_book_now') }]), {
    fallbackTemplate: slotTemplate(biz, 'appointment_recall', [firstName(v.name) || 'there', v.service, biz.name], [`bk:svc:${a.service_id}`]),
  });
});

export const servicePriceLabel = (biz, s) => [s.duration_min ? `${s.duration_min} min` : '', s.price ? money(s.price, biz.currency) : ''].filter(Boolean).join(' · ');

// Recall for imported customers (no appointment row): payload { phone, service_id }
registerJob('service.recall', async (job) => {
  const biz = getBusiness(job.business_id);
  const service = biz && getService(biz.id, job.payload.service_id);
  const phone = job.payload.phone;
  if (!service || !canMessage(biz, phone)) return;
  if (get(`SELECT 1 FROM appointments WHERE business_id = ? AND phone = ? AND service_id = ? AND status IN ${ACTIVE} AND start_at > ?`, biz.id, phone, service.id, now())) return;
  const c = getCustomer(biz.id, phone);
  const n = firstName(c?.name);
  const v = { service: service.name, name_sp: n ? ` ${n}` : '' };
  await send(biz, phone, B.buttons(text(biz, 'recall', v), [{ id: `bk:svc:${service.id}`, title: text(biz, 'btn_book_now') }]), {
    fallbackTemplate: slotTemplate(biz, 'appointment_recall', [n || 'there', service.name, biz.name], [`bk:svc:${service.id}`]),
  });
});
