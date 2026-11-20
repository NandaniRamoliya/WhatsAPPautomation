// Integrations hub: every important event is pushed to the tools a business already uses.
//   webhook  -> n8n / Make / Zapier / any server (signed JSON)  => reaches ANY CRM
//   sheets   -> Google Sheets (via a copy-paste Apps Script, no Google login on our side)
//   hubspot  -> contact upsert by phone + timeline note
//   airtable -> one row per event
// Delivery is attempted immediately (non-blocking); failures are retried by the job queue
// and every attempt is visible in Integrations -> Delivery log.
import crypto from 'node:crypto';
import { all, insert, run } from '../db/index.js';
import { decrypt, hmacHex } from '../lib/crypto.js';
import { log } from '../lib/logger.js';
import { money } from '../lib/util.js';
import { schedule, registerJob } from './jobs.js';
import { getBusiness } from './business.js';

export const EVENTS = {
  'customer.created': 'New customer messaged for the first time',
  'lead.created': 'Enquiry form submitted',
  'order.created': 'New order placed',
  'order.updated': 'Order paid / status changed',
  'appointment.booked': 'New appointment booked',
  'appointment.updated': 'Appointment cancelled, moved, completed or no-show',
  'handoff.requested': 'Customer asked for a person',
  'feedback.received': 'After-visit check-in answered',
};
export const TARGETS = ['webhook', 'sheets', 'hubspot', 'airtable'];
const SHEET = { customer: 'Customers', lead: 'Leads', order: 'Orders', appointment: 'Appointments', handoff: 'Handoffs', feedback: 'Feedback' };

// ---------- payload ----------
function row(biz, event, d) {
  const base = { Time: new Date().toISOString(), Event: event, Name: d.name || '', Phone: d.phone ? `+${d.phone}` : '' };
  switch (event.split('.')[0]) {
    case 'order': return { ...base, 'Order #': d.order_no, Status: d.status, Payment: `${d.payment_mode} / ${d.payment_status}`, Total: money(d.total, biz.currency), Items: (d.items || []).map((l) => `${l.name} x${l.qty}`).join(', '), Fulfilment: d.fulfilment, Address: d.address || '', Notes: d.notes || '' };
    case 'appointment': return { ...base, Ref: d.ref, Status: d.status, Service: d.service, Staff: d.staff, Date: d.date, Time_: d.time, Answers: Object.entries(d.intake || {}).map(([k, v]) => `${k}: ${v}`).join('; ') };
    case 'lead': return { ...base, Status: 'NEW', ...Object.fromEntries(Object.entries(d.answers || {}).map(([k, v]) => [k, v])) };
    case 'feedback': return { ...base, Feeling: d.feeling, Service: d.service };
    case 'handoff': return { ...base, Reason: d.reason || 'Asked for a person', Message: d.message || '' };
    default: return { ...base, Language: d.language || '' };
  }
}

export function summary(biz, event, d) {
  switch (event) {
    case 'order.created': return `New order #${d.order_no} – ${money(d.total, biz.currency)} – ${d.payment_mode}`;
    case 'order.updated': return `Order #${d.order_no} is now ${d.status} (payment ${d.payment_status})`;
    case 'appointment.booked': return `Booked ${d.service} with ${d.staff} on ${d.date} ${d.time}`;
    case 'appointment.updated': return `Appointment ${d.ref} is now ${d.status} (${d.date} ${d.time})`;
    case 'lead.created': return `New enquiry: ${Object.entries(d.answers || {}).map(([k, v]) => `${k}: ${v}`).join('; ')}`;
    case 'handoff.requested': return `${d.name || 'Customer'} asked to talk to a person`;
    case 'feedback.received': return `Feeling ${d.feeling} after ${d.service}`;
    case 'customer.created': return `New customer ${d.name || ''}`.trim();
    default: return event;
  }
}

export function buildPayload(biz, event, data) {
  return {
    id: crypto.randomUUID(), event, at: new Date().toISOString(),
    business: { id: biz.id, slug: biz.slug, name: biz.name },
    contact: { phone: data.phone ? `+${data.phone}` : null, name: data.name || null },
    summary: summary(biz, event, data),
    data,
    sheet: SHEET[event.split('.')[0]] || 'Events',
    row: row(biz, event, data),
  };
}

// ---------- delivery ----------
async function post(url, body, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body, signal: AbortSignal.timeout(15000) });
  const text = await res.text().catch(() => '');
  if (!res.ok) { const e = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`); e.status = res.status; throw e; }
  return { status: res.status, text };
}

async function hubspot(cfg, p) {
  const token = decrypt(cfg.token_enc);
  if (!token) throw new Error('HubSpot private app token missing');
  const H = { Authorization: `Bearer ${token}` };
  const api = (path, body) => post(`https://api.hubapi.com${path}`, JSON.stringify(body), H).then((r) => JSON.parse(r.text || '{}'));
  let contactId;
  if (p.contact.phone) {
    const found = await api('/crm/v3/objects/contacts/search', { filterGroups: [{ filters: [{ propertyName: 'phone', operator: 'EQ', value: p.contact.phone }] }], limit: 1 });
    contactId = found.results?.[0]?.id;
    if (!contactId) {
      const [first, ...rest] = String(p.contact.name || '').split(' ');
      const created = await api('/crm/v3/objects/contacts', { properties: { phone: p.contact.phone, firstname: first || 'WhatsApp', lastname: rest.join(' ') || '', lifecyclestage: 'lead' } });
      contactId = created.id;
    }
  }
  const note = { properties: { hs_timestamp: p.at, hs_note_body: `<b>${p.summary}</b><br>${Object.entries(p.row).map(([k, v]) => `${k}: ${v}`).join('<br>')}` } };
  if (contactId) note.associations = [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }];
  await api('/crm/v3/objects/notes', note);
  return { status: 200 };
}

async function airtable(cfg, p) {
  const token = decrypt(cfg.token_enc);
  if (!token || !cfg.base_id) throw new Error('Airtable token or Base ID missing');
  const fields = { Time: p.at, Event: p.event, Name: p.contact.name || '', Phone: p.contact.phone || '', Summary: p.summary, Details: JSON.stringify(p.row) };
  return post(`https://api.airtable.com/v0/${encodeURIComponent(cfg.base_id)}/${encodeURIComponent(cfg.table || 'WhatsApp')}`,
    JSON.stringify({ records: [{ fields }], typecast: true }), { Authorization: `Bearer ${token}` });
}

/** Deliver one payload to one target. Throws on failure. Logs every attempt. */
export async function deliver(biz, target, payload) {
  const cfg = biz.settings.integrations?.[target] || {};
  let result;
  try {
    if (target === 'webhook') {
      if (!cfg.url) throw new Error('Webhook URL missing');
      const body = JSON.stringify(payload);
      const secret = decrypt(cfg.secret_enc);
      result = await post(cfg.url, body, { 'X-WAK-Event': payload.event, ...(secret ? { 'X-WAK-Signature': `sha256=${hmacHex(secret, body)}` } : {}) });
    } else if (target === 'sheets') {
      if (!cfg.url) throw new Error('Google Apps Script URL missing');
      result = await post(cfg.url, JSON.stringify({ ...payload, token: cfg.token || '' }));
      if (/forbidden/i.test(result.text)) throw new Error('Google Sheets rejected the token – check it matches the script');
    } else if (target === 'hubspot') result = await hubspot(cfg, payload);
    else if (target === 'airtable') result = await airtable(cfg, payload);
    else throw new Error(`Unknown target ${target}`);
    insert('integration_log', { business_id: biz.id, target, event: payload.event, status: 'ok', http_status: result?.status || 200 });
    return { ok: true, status: result?.status || 200 };
  } catch (e) {
    insert('integration_log', { business_id: biz.id, target, event: payload.event, status: 'error', http_status: e.status || null, error: String(e.message).slice(0, 500) });
    throw e;
  }
}

/** Fire-and-forget: deliver now in the background, retry later through the job queue if it fails. */
export function emit(biz, event, data) {
  const cfg = biz?.settings?.integrations;
  if (!cfg || !(cfg.events || []).includes(event)) return;
  if (String(data?.phone || '').startsWith('sim')) return; // tester chats never reach real systems
  const targets = TARGETS.filter((t) => cfg[t]?.enabled);
  if (!targets.length) return;
  const payload = buildPayload(biz, event, data);
  for (const target of targets) {
    setImmediate(() => deliver(biz, target, payload).catch((e) => {
      log.warn('integration failed, will retry', { biz: biz.id, target, event, err: e.message });
      schedule(biz.id, 'integration.retry', Date.now() + 2 * 60_000, { target, payload }, `int:${payload.id}`);
    }));
  }
}

registerJob('integration.retry', async (job) => {
  const biz = getBusiness(job.business_id);
  if (!biz) return;
  await deliver(biz, job.payload.target, job.payload.payload); // throws -> job queue retries (3 attempts)
});

export const recentLog = (bizId, limit = 50) => all('SELECT * FROM integration_log WHERE business_id = ? ORDER BY id DESC LIMIT ?', bizId, limit);
export const pruneLog = () => run(`DELETE FROM integration_log WHERE created_at < ?`, new Date(Date.now() - 30 * 86400_000).toISOString());

/** A realistic sample event for the "Send test" button. */
export function testPayload(biz) {
  return buildPayload(biz, 'lead.created', { phone: '919999900000', name: 'Test Customer', answers: { Requirement: 'This is a test from your WhatsApp assistant' } });
}

/** Google Apps Script the owner pastes into their sheet (Extensions -> Apps Script). */
export function sheetsScript(token = '') {
  return `// Replix (WhatsApp) -> Google Sheets
// 1. Paste this in Extensions > Apps Script, then Deploy > New deployment > Web app
//    (Execute as: Me, Who has access: Anyone). Copy the Web app URL into the dashboard.
const TOKEN = '${token}';

function doPost(e) {
  const p = JSON.parse(e.postData.contents);
  if (TOKEN && p.token !== TOKEN) return ContentService.createTextOutput('forbidden');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = p.sheet || 'Events';
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const row = p.row || {};
  let headers = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  if (!headers.length || headers.join('') === '') { headers = Object.keys(row); sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold'); sh.setFrozenRows(1); }
  Object.keys(row).forEach(function (k) { if (headers.indexOf(k) === -1) { headers.push(k); sh.getRange(1, headers.length).setValue(k).setFontWeight('bold'); } });
  sh.appendRow(headers.map(function (h) { return row[h] === undefined ? '' : row[h]; }));
  return ContentService.createTextOutput('ok');
}
`;
}
