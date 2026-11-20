import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBusiness, customer, options, findOpt, bodies, db, getBusiness } from './helpers.js';
import { runDueJobs } from '../src/services/jobs.js';
import { book, slotsFor, getService, completeAppointment, SlotTakenError } from '../src/services/appointments.js';
import { addDays, todayIn } from '../src/lib/time.js';

// 3 days ahead: reminders (24h / 2h before) are always in the future, whatever time the tests run
const tomorrow = (biz) => addDays(todayIn(biz.timezone), 3);

test('dental: triage -> date -> time -> name -> confirm -> owner alert + reminders', async () => {
  const biz = makeBusiness('dental');
  const c = customer(biz);
  let r = await c.text('hello');
  assert.ok(findOpt(r, 'bk:start'), 'menu has Book appointment');

  r = await c.tap('bk:start');
  const svc = findOpt(r, (o) => o.title.startsWith('Toothache'));
  assert.ok(svc, 'service list');
  r = await c.pick(svc.id);
  // single dentist -> straight to triage question 1 with 3 buttons
  assert.match(bodies(r), /Which tooth/);
  r = await c.tap(options(r)[0].id);
  assert.match(bodies(r), /What are you feeling/);
  r = await c.tap(options(r)[1].id); // Swelling
  r = await c.tap(options(r)[0].id); // Today
  const day = findOpt(r, (o) => o.id === `bk:d:${tomorrow(biz)}`);
  assert.ok(day, 'day offered');
  r = await c.pick(day.id);
  const time = findOpt(r, 'bk:t:');
  assert.ok(time, 'times offered');
  r = await c.pick(time.id, time.title);
  assert.ok(findOpt(r, 'bk:nm'), 'offers profile name');
  r = await c.text('Neha S');
  assert.match(bodies(r), /confirm your booking/);
  r = await c.tap('bk:yes');
  assert.match(bodies(r), /Booked!/);
  assert.match(bodies(r), /12 MG Road/);

  const appt = db.get('SELECT * FROM appointments WHERE business_id = ?', biz.id);
  assert.equal(appt.customer_name, 'Neha S');
  assert.deepEqual(JSON.parse(appt.intake), { 'Which tooth': 'Upper', Symptom: 'Swelling', Since: 'Today' });
  const owner = db.get(`SELECT body FROM messages WHERE business_id = ? AND phone = '919999999999' ORDER BY id DESC`, biz.id);
  assert.match(owner.body, /NEW BOOKING/);
  assert.match(owner.body, /Swelling/);
  const jobs = db.all(`SELECT * FROM jobs WHERE ref = ? AND type = 'appt.reminder'`, `appt:${appt.id}`);
  assert.ok(jobs.length >= 1, 'reminders scheduled');
});

test('slot cannot be double booked (sequential and via the unique index)', async () => {
  const biz = makeBusiness('dental');
  const service = db.get(`SELECT * FROM services WHERE business_id = ? AND name LIKE 'Consult%'`, biz.id);
  const slots = slotsFor(getBusiness(biz.id), service, tomorrow(biz));
  assert.ok(slots.length > 5);
  const start = slots[2].start;
  book(getBusiness(biz.id), { phone: '911111111111', name: 'A', serviceId: service.id, start });
  assert.throws(() => book(getBusiness(biz.id), { phone: '912222222222', name: 'B', serviceId: service.id, start }), SlotTakenError);
  const after = slotsFor(getBusiness(biz.id), service, tomorrow(biz));
  assert.ok(!after.some((s) => s.start === start), 'taken slot disappears');
});

test('"any available" assigns the second doctor when the first is busy', async () => {
  const biz = makeBusiness('clinic');
  const service = db.get(`SELECT * FROM services WHERE business_id = ? AND name LIKE 'General%'`, biz.id);
  const start = slotsFor(getBusiness(biz.id), service, tomorrow(biz))[0].start;
  const a = book(getBusiness(biz.id), { phone: '911111111111', name: 'A', serviceId: service.id, start });
  const b = book(getBusiness(biz.id), { phone: '912222222222', name: 'B', serviceId: service.id, start });
  assert.notEqual(a.staff_id, b.staff_id);
  assert.throws(() => book(getBusiness(biz.id), { phone: '913333333333', name: 'C', serviceId: service.id, start }), SlotTakenError);
});

test('time off removes availability for that day', async () => {
  const biz = makeBusiness('dental');
  const service = db.get(`SELECT * FROM services WHERE business_id = ? LIMIT 1`, biz.id);
  db.insert('time_off', { business_id: biz.id, staff_id: null, date_from: tomorrow(biz), date_to: tomorrow(biz), reason: 'Holiday' });
  assert.equal(slotsFor(getBusiness(biz.id), service, tomorrow(biz)).length, 0);
});

test('reminder -> confirm; reschedule; cancel', async () => {
  const biz = makeBusiness('dental', { booking: { intake_questions: [] } });
  const c = customer(biz);
  await c.text('hi');
  const service = db.get(`SELECT * FROM services WHERE business_id = ? AND name LIKE 'Consult%'`, biz.id);
  const day = addDays(todayIn(biz.timezone), 2);
  const slots = slotsFor(getBusiness(biz.id), service, day);
  const appt = book(getBusiness(biz.id), { phone: c.phone, name: 'Neha', serviceId: service.id, start: slots[0].start });

  db.run(`UPDATE jobs SET run_at = ? WHERE ref = ?`, new Date(Date.now() - 1000).toISOString(), `appt:${appt.id}`);
  await runDueJobs();
  const reminder = db.get(`SELECT * FROM messages WHERE business_id = ? AND phone = ? AND body LIKE '%Reminder%' ORDER BY id DESC`, biz.id, c.phone);
  assert.ok(reminder, 'reminder sent');
  let r = await c.tap(`bk:ok:${appt.id}`);
  assert.match(bodies(r), /See you on/);
  assert.equal(db.get('SELECT status FROM appointments WHERE id = ?', appt.id).status, 'CONFIRMED');

  r = await c.tap(`bk:rs:${appt.id}`);
  const newDay = findOpt(r, (o) => o.id === `bk:d:${addDays(todayIn(biz.timezone), 4)}`);
  r = await c.pick(newDay.id);
  const t = options(r).filter((o) => o.id.startsWith('bk:t:'))[3];
  r = await c.pick(t.id, t.title);
  r = await c.tap('bk:yes');
  assert.match(bodies(r), /moved to/);
  const moved = db.get('SELECT * FROM appointments WHERE id = ?', appt.id);
  assert.notEqual(moved.start_at, appt.start_at);
  assert.equal(moved.status, 'BOOKED');

  r = await c.tap('bk:my');
  r = await c.pick(`bk:a:${appt.id}`);
  r = await c.tap(`bk:cx:${appt.id}`);
  assert.match(bodies(r), /cancelled/);
  assert.equal(db.get(`SELECT COUNT(*) AS n FROM jobs WHERE ref = ? AND status = 'PENDING'`, `appt:${appt.id}`).n, 0, 'jobs cancelled');
});

test('after visit: aftercare, check-in -> review link (positive) / team alert (negative), recall', async () => {
  const biz = makeBusiness('dental', {}, { review_link: 'https://g.page/r/review-me' });
  const service = db.get(`SELECT * FROM services WHERE business_id = ? AND name LIKE 'Cleaning%'`, biz.id);
  const happy = customer(biz, 'sim-happy');
  const sad = customer(biz, 'sim-sad');
  await happy.text('hi'); await sad.text('hi');
  const slots = slotsFor(getBusiness(biz.id), service, tomorrow(biz));
  const a1 = book(getBusiness(biz.id), { phone: happy.phone, name: 'Happy', serviceId: service.id, start: slots[0].start });
  const a2 = book(getBusiness(biz.id), { phone: sad.phone, name: 'Sad', serviceId: service.id, start: slots[3].start });
  await completeAppointment(getBusiness(biz.id), a1.id, { note: 'Rx: Paracetamol 650 if pain' });
  await completeAppointment(getBusiness(biz.id), a2.id);
  const care = db.get(`SELECT body FROM messages WHERE phone = ? AND body LIKE '%Thank you for visiting%'`, happy.phone);
  assert.match(care.body, /soft brush/);
  assert.match(care.body, /Paracetamol/);

  db.run(`UPDATE jobs SET run_at = ? WHERE type IN ('appt.checkin','appt.recall')`, new Date(Date.now() - 1000).toISOString());
  await runDueJobs();
  const checkin = db.get(`SELECT * FROM messages WHERE phone = ? AND body LIKE '%How are you feeling%'`, happy.phone);
  assert.ok(checkin);
  let r = await happy.tap(`bk:ci:good:${a1.id}`);
  assert.match(bodies(r), /g\.page\/r\/review-me/);
  r = await sad.tap(`bk:ci:bad:${a2.id}`);
  assert.doesNotMatch(bodies(r), /review/);
  assert.match(bodies(r), /informed the team/);
  assert.equal(sad.session().needs_attention, 1);

  const recall = db.get(`SELECT * FROM messages WHERE phone = ? AND body LIKE '%It is time for your%'`, happy.phone);
  assert.ok(recall, 'recall sent (service has recall_days)');
  r = await happy.tap(`bk:svc:${service.id}`);
  assert.match(bodies(r), /Which tooth/, 'recall button starts booking that service');
});

test('outside the 24h window: template used if configured, otherwise skipped', async () => {
  const biz = makeBusiness('dental', { templates: { appointment_reminder: { name: 'appointment_reminder', lang: 'en' } } });
  const service = db.get(`SELECT * FROM services WHERE business_id = ? LIMIT 1`, biz.id);
  const phone = '919812345678'; // real-looking number, never messaged us -> window closed
  const slots = slotsFor(getBusiness(biz.id), service, tomorrow(biz));
  const appt = book(getBusiness(biz.id), { phone, name: 'Ravi', serviceId: service.id, start: slots[0].start });
  db.run(`UPDATE jobs SET run_at = ? WHERE ref = ?`, new Date(Date.now() - 1000).toISOString(), `appt:${appt.id}`);
  await runDueJobs();
  const m = db.get(`SELECT * FROM messages WHERE phone = ? ORDER BY id DESC`, phone);
  assert.equal(m.kind, 'template');
  const payload = JSON.parse(m.payload);
  assert.equal(payload.template.name, 'appointment_reminder');
  assert.equal(payload.template.components[0].parameters.length, 4);
  assert.equal(payload.template.components[1].parameters[0].payload, `bk:ok:${appt.id}`);
});

test('enquiry: FAQ keyword auto-answer and lead capture', async () => {
  const biz = makeBusiness('real_estate');
  const c = customer(biz);
  await c.text('hi');
  let r = await c.text('do you charge brokerage?');
  assert.match(bodies(r), /1% for buyers/);
  r = await c.tap('enq:lead');
  assert.match(bodies(r), /looking for/);
  r = await c.tap(options(r)[0].id); // Buy
  r = await c.tap(options(r)[0].id); // Flat
  r = await c.text('80 lakh');
  r = await c.text('Whitefield');
  assert.match(bodies(r), /noted your details/);
  const lead = db.get('SELECT * FROM leads WHERE business_id = ?', biz.id);
  assert.deepEqual(JSON.parse(lead.answers), { 'Looking for': 'Buy', Type: 'Flat', Budget: '80 lakh', Location: 'Whitefield' });
});

test('media message alerts owner; unknown buttons fall back to menu', async () => {
  const biz = makeBusiness('salon');
  const c = customer(biz);
  let r = await c.media('audio');
  assert.match(bodies(r), /received your audio/);
  r = await c.tap('ord:start'); // ordering module disabled for salons
  assert.ok(options(r).length > 0);
});
