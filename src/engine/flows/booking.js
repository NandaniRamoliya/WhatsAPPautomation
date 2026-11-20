// BOOKING flow: service -> staff (optional) -> intake/triage questions -> day ->
// time -> name -> confirm. Also: my appointments, reschedule, cancel, reminder
// replies and post-visit check-in answers (positive -> review link, negative -> team).
import { clip } from '../../lib/util.js';
import {
  listServices, getService, staffForService, availableDates, slotsFor, book, alertNewBooking, SlotTakenError,
  upcomingFor, getAppointment, cancelAppointment, rescheduleAppointment, setApptStatus, apptVars, slotLabel, dateLabel,
  servicePriceLabel, getStaff,
} from '../../services/appointments.js';

const compact = (iso) => iso.replace(/[-:]|\.\d{3}/g, '');                        // 2026-11-21T05:00:00.000Z -> 20261121T050000Z
const expand = (s) => s.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6.000Z');

export const booking = {
  module: 'booking',
  prefix: 'bk',
  states: ['BK_STAFF', 'BK_INTAKE', 'BK_DATE', 'BK_TIME', 'BK_NAME', 'BK_CONFIRM', 'BK_CHECKIN'],

  menuItems(c) {
    return [
      { id: 'bk:start', title: c.t('menu_book'), description: c.t('menu_book_desc') },
      { id: 'bk:my', title: c.t('menu_my_appts'), description: c.t('menu_my_appts_desc') },
    ];
  },

  async onChoice(c, [action, a1, a2]) {
    switch (action) {
      case 'start': return chooseService(c, 0);
      case 'svcs': return chooseService(c, Number(a1) || 0);
      case 'svc': return selectService(c, Number(a1));
      case 'st': c.ctx.bk.staffId = a1 === 'any' ? null : Number(a1); return askIntake(c);
      case 'ia': return answerIntake(c, (c.ctx.bk?.questions?.[Number(a1)]?.options || [])[Number(a2)]);
      case 'd': return chooseTime(c, a1, 0);
      case 'tp': return chooseTime(c, a1, Number(a2) || 0);
      case 'dates': return chooseDate(c);
      case 't': c.ctx.bk.start = expand(a1); return askName(c);
      case 'nm': c.ctx.bk.name = c.customer.name; return confirm(c);
      case 'yes': return finalize(c);
      case 'chg': return chooseDate(c);
      case 'no': c.reset(); return c.buttons(c.t('cancelled_flow'), [{ id: 'menu', title: c.t('btn_menu') }]);
      case 'my': return myAppointments(c);
      case 'a': return appointmentActions(c, Number(a1));
      case 'ok': return reminderConfirm(c, Number(a1));
      case 'rs': return startReschedule(c, Number(a1));
      case 'cx': return customerCancel(c, Number(a1));
      case 'ci': return checkinAnswer(c, a1, Number(a2));
      default: return false;
    }
  },

  async onText(c) {
    const t = c.input.text;
    if (c.state === 'BK_INTAKE') return answerIntake(c, t.slice(0, 300));
    if (c.state === 'BK_NAME') {
      if (t.length < 2) return c.say(c.t('ask_name'));
      c.ctx.bk.name = t.slice(0, 80);
      return confirm(c);
    }
    // Template reminder replies sometimes arrive as plain "1" / "2"
    if (c.ctx.lastReminder && /^[12]$/.test(t)) return t === '1' ? reminderConfirm(c, c.ctx.lastReminder) : startReschedule(c, c.ctx.lastReminder);
    return c.say(c.t('pick_option'));
  },
};

async function chooseService(c, page) {
  const services = listServices(c.biz.id);
  if (!services.length) return c.buttons(c.t('no_dates', { days: c.biz.settings.booking.days_ahead }), [{ id: 'human', title: c.t('menu_human') }]);
  if (services.length === 1) return selectService(c, services[0].id);
  const rows = services.map((s) => ({ id: `bk:svc:${s.id}`, title: s.name, description: [servicePriceLabel(c.biz, s), s.description].filter(Boolean).join(' · ') }));
  return c.pagedList(c.t('choose_service'), c.t('services_button'), rows, page, (n) => `bk:svcs:${n}`);
}

async function selectService(c, serviceId) {
  const service = getService(c.biz.id, serviceId);
  if (!service || !service.active) return chooseService(c, 0);
  c.setState('BK_STAFF', { bk: { serviceId: service.id, staffId: null, intake: {}, qi: 0 } });
  delete c.ctx.recallService;
  const staff = staffForService(c.biz.id, service.id);
  if (c.biz.settings.booking.allow_staff_choice && staff.length > 1) {
    const rows = [
      { id: 'bk:st:any', title: c.t('staff_any'), description: c.t('staff_any_desc') },
      ...staff.map((s) => ({ id: `bk:st:${s.id}`, title: s.name, description: s.title || '' })),
    ];
    return c.pagedList(c.t('choose_staff', { staff_label: c.biz.settings.booking.staff_label.toLowerCase() }), c.t('staff_button'), rows);
  }
  c.ctx.bk.staffId = staff.length === 1 ? staff[0].id : null;
  return askIntake(c);
}

// ---- intake / triage questions (e.g. "Which tooth?", "Swelling?") ----
async function askIntake(c) {
  const questions = (c.biz.settings.booking.intake_questions || []).filter((q) => q?.question);
  c.ctx.bk.questions = questions;
  if (c.ctx.bk.rescheduleId || c.ctx.bk.qi >= questions.length) return chooseDate(c);
  const q = questions[c.ctx.bk.qi];
  c.setState('BK_INTAKE');
  const opts = (q.options || []).filter(Boolean);
  if (opts.length && opts.length <= 3) return c.buttons(q.question, opts.map((o, i) => ({ id: `bk:ia:${c.ctx.bk.qi}:${i}`, title: o })));
  if (opts.length > 3) return c.pagedList(q.question, c.t('staff_button'), opts.map((o, i) => ({ id: `bk:ia:${c.ctx.bk.qi}:${i}`, title: o })));
  return c.say(q.question);
}

async function answerIntake(c, answer) {
  if (!c.ctx.bk) return chooseService(c, 0);
  const q = c.ctx.bk.questions?.[c.ctx.bk.qi];
  if (q && answer) c.ctx.bk.intake[q.key || q.question.slice(0, 40)] = answer;
  c.ctx.bk.qi += 1;
  return askIntake(c);
}

// ---- date & time ----
async function chooseDate(c) {
  const service = getService(c.biz.id, c.ctx.bk?.serviceId);
  if (!service) return chooseService(c, 0);
  const dates = availableDates(c.biz, service, c.ctx.bk.staffId);
  if (!dates.length) {
    c.reset();
    c.pause();
    await c.notifyOwner(c.t('owner_handoff', { customer: c.customer.name || 'Customer', phone: c.phone }));
    return c.say(c.t('no_dates', { days: c.biz.settings.booking.days_ahead }));
  }
  c.setState('BK_DATE');
  const rows = dates.map((d) => ({ id: `bk:d:${d.ymd}`, title: dateLabel(c.biz, d.ymd), description: `${d.count} slot${d.count > 1 ? 's' : ''}` }));
  return c.pagedList(c.t('choose_date', { service: service.name }), c.t('days_button'), rows);
}

async function chooseTime(c, ymd, page) {
  const service = getService(c.biz.id, c.ctx.bk?.serviceId);
  if (!service || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return chooseService(c, 0);
  const slots = slotsFor(c.biz, service, ymd, c.ctx.bk.staffId, { excludeId: c.ctx.bk.rescheduleId || 0 });
  if (!slots.length) { await c.say(c.t('no_times')); return chooseDate(c); }
  c.setState('BK_TIME', { bk: { ...c.ctx.bk, date: ymd } });
  const rows = slots.map((s) => ({ id: `bk:t:${compact(s.start)}`, title: slotLabel(c.biz, s.start) }));
  return c.pagedList(c.t('choose_time', { date: dateLabel(c.biz, ymd) }), c.t('times_button'), rows, page, (n) => `bk:tp:${ymd}:${n}`);
}

async function askName(c) {
  if (c.ctx.bk.rescheduleId) return confirm(c);
  if (!c.biz.settings.booking.ask_name) { c.ctx.bk.name = c.customer.name || 'Customer'; return confirm(c); }
  c.setState('BK_NAME');
  if (c.customer.name) return c.buttons(c.t('ask_name'), [{ id: 'bk:nm', title: c.t('btn_use_name', { name: clip(c.customer.name, 12) }) }]);
  return c.say(c.t('ask_name'));
}

function summaryVars(c) {
  const bk = c.ctx.bk;
  const service = getService(c.biz.id, bk.serviceId);
  const staff = bk.staffId ? getStaff(c.biz.id, bk.staffId)?.name : c.t('staff_any');
  return { service: service?.name, staff, date: dateLabel(c.biz, bk.date), time: slotLabel(c.biz, bk.start), name: bk.name || c.customer.name || '' };
}

async function confirm(c) {
  c.setState('BK_CONFIRM');
  return c.buttons(c.t('confirm_booking', summaryVars(c)), [
    { id: 'bk:yes', title: c.t('btn_confirm') }, { id: 'bk:chg', title: c.t('btn_change_time') }, { id: 'bk:no', title: c.t('btn_cancel') },
  ]);
}

async function finalize(c) {
  const bk = c.ctx.bk;
  if (!bk?.start) return chooseService(c, 0);
  try {
    if (bk.rescheduleId) {
      const appt = await rescheduleAppointment(c.biz, bk.rescheduleId, bk.start, { by: 'customer', staffId: bk.staffId ?? undefined });
      c.reset();
      await c.say(c.t('appt_moved', apptVars(c.biz, appt)));
      await c.notifyOwner(`🔄 RESCHEDULED ${apptVars(c.biz, appt).ref}: ${appt.customer_name} (${appt.phone}) → ${apptVars(c.biz, appt).date} ${apptVars(c.biz, appt).time}`);
      return true;
    }
    const appt = book(c.biz, { phone: c.phone, name: bk.name, serviceId: bk.serviceId, staffId: bk.staffId, start: bk.start, intake: bk.intake });
    c.reset();
    await c.say(c.t('booked', apptVars(c.biz, appt)));
    await alertNewBooking(c.biz, appt);
    return true;
  } catch (e) {
    if (e instanceof SlotTakenError) { await c.say(c.t('slot_taken')); return chooseTime(c, bk.date, 0); }
    throw e;
  }
}

// ---- manage existing appointments ----
async function myAppointments(c) {
  const list = upcomingFor(c.biz.id, c.phone);
  if (!list.length) return c.buttons(c.t('my_appts_none'), [{ id: 'bk:start', title: c.t('menu_book') }, { id: 'menu', title: c.t('btn_menu') }]);
  const rows = list.map((a) => ({ id: `bk:a:${a.id}`, title: `${dateLabel(c.biz, tzYmd(c, a.start_at))} ${slotLabel(c.biz, a.start_at)}`, description: `${a.service_name || ''} · ${a.staff_name || ''}` }));
  return c.pagedList(c.t('my_appts'), c.t('appts_button'), rows);
}

const tzYmd = (c, iso) => new Intl.DateTimeFormat('en-CA', { timeZone: c.biz.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

const mine = (c, id) => {
  const a = getAppointment(c.biz.id, id);
  return a && a.phone === c.phone ? a : null;
};

async function appointmentActions(c, id) {
  const a = mine(c, id);
  if (!a || !['BOOKED', 'CONFIRMED'].includes(a.status)) return myAppointments(c);
  return c.buttons(c.t('appt_actions', apptVars(c.biz, a)), [
    { id: `bk:rs:${a.id}`, title: c.t('btn_reschedule') }, { id: `bk:cx:${a.id}`, title: c.t('btn_cancel_appt') }, { id: 'menu', title: c.t('btn_menu') },
  ]);
}

async function reminderConfirm(c, id) {
  const a = mine(c, id);
  if (!a || !['BOOKED', 'CONFIRMED'].includes(a.status)) return myAppointments(c);
  setApptStatus(c.biz, a.id, 'CONFIRMED');
  delete c.ctx.lastReminder;
  return c.say(c.t('reminder_confirmed', apptVars(c.biz, a)));
}

async function startReschedule(c, id) {
  const a = mine(c, id);
  if (!a || !['BOOKED', 'CONFIRMED'].includes(a.status)) return myAppointments(c);
  c.setState('BK_DATE', { bk: { serviceId: a.service_id, staffId: a.staff_id, rescheduleId: a.id, intake: {}, qi: 0, name: a.customer_name } });
  return chooseDate(c);
}

async function customerCancel(c, id) {
  const a = mine(c, id);
  if (!a) return myAppointments(c);
  await cancelAppointment(c.biz, a.id, { by: 'customer' });
  c.reset();
  return c.buttons(c.t('appt_cancelled', apptVars(c.biz, a)), [{ id: 'bk:start', title: c.t('menu_book') }, { id: 'menu', title: c.t('btn_menu') }]);
}

// ---- day-3 check-in ----
async function checkinAnswer(c, feeling, id) {
  const a = mine(c, id);
  if (!a) return false;
  const v = apptVars(c.biz, a);
  if (feeling === 'good') {
    const link = c.biz.settings.booking.review_request && c.biz.review_link;
    return c.say(link ? c.t('checkin_good_review', { review_link: link }) : c.t('checkin_good'));
  }
  // Same / not good -> route to the team immediately (never ask for a review here)
  c.pause();
  await c.notifyOwner(c.t('owner_checkin_alert', { ...v, feeling: feeling === 'bad' ? 'not good' : 'the same' }));
  return c.say(c.t(feeling === 'bad' ? 'checkin_bad' : 'checkin_same', v));
}
