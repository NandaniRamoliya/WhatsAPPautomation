// The conversation brain. Every inbound WhatsApp message (or simulator message)
// enters here: normalise -> global commands -> current flow -> free text -> menu.
// State is re-read from the database on every message, so restarts never lose a chat.
import { insert, now } from '../db/index.js';
import { log } from '../lib/logger.js';
import { isOpenAt, nextOpening } from '../lib/time.js';
import * as B from '../whatsapp/builders.js';
import { Conversation } from './conversation.js';
import { loadSession, isPaused } from './session.js';
import { touchCustomer, setCustomerField } from '../services/customers.js';
import { aiEnabled, answerQuestion } from '../services/ai.js';
import { ordering } from './flows/ordering.js';
import { booking } from './flows/booking.js';
import { enquiry } from './flows/enquiry.js';

/** Registered flows. Add a new module here (see docs/DEVELOPER_GUIDE.md -> "Add a new flow"). */
export const FLOWS = [ordering, booking, enquiry];

const GREETINGS = new Set(['hi', 'hii', 'hiii', 'hello', 'helo', 'hey', 'menu', 'start over', 'restart', 'namaste', 'namaskar', 'hola', 'salam', 'hlo', 'hy', 'main menu', 'home', '0', 'good morning', 'good evening', 'good afternoon', 'help']);
const HUMAN = new Set(['human', 'agent', 'person', 'talk to human', 'talk to someone', 'call me', 'support', 'customer care', 'baat karni hai', 'owner']);
const CANCEL = new Set(['cancel', 'stop order', 'back', 'exit', 'band karo']);
const OPT_OUT = new Set(['stop', 'unsubscribe', 'opt out', 'optout']);
const OPT_IN = new Set(['start', 'subscribe', 'opt in']);

/** Convert a raw Cloud API message object into a simple input. */
export function normalize(msg) {
  switch (msg.type) {
    case 'text': return { kind: 'text', text: (msg.text?.body || '').trim() };
    case 'interactive': {
      const i = msg.interactive || {};
      const r = i.button_reply || i.list_reply;
      if (r) return { kind: 'choice', id: r.id, text: r.title };
      if (i.nfm_reply) return { kind: 'form', data: safeJson(i.nfm_reply.response_json) };
      return { kind: 'other', type: 'interactive' };
    }
    case 'button': return { kind: 'choice', id: msg.button?.payload || '', text: msg.button?.text || '' }; // template quick reply
    case 'location': return { kind: 'location', location: msg.location };
    case 'order': return { kind: 'order', order: msg.order };
    case 'image': case 'document': case 'audio': case 'video': case 'sticker':
      return { kind: 'media', mediaType: msg.type, mediaId: msg[msg.type]?.id, caption: msg[msg.type]?.caption || '' };
    default: return { kind: 'other', type: msg.type };
  }
}

const safeJson = (s) => { try { return JSON.parse(s); } catch { return {}; } };

function describeInbound(msg, input) {
  if (input.kind === 'text') return input.text;
  if (input.kind === 'choice') return `🔘 ${input.text}`;
  if (input.kind === 'location') return `📍 ${input.location?.name || ''} ${input.location?.address || ''} (${input.location?.latitude},${input.location?.longitude})`.trim();
  if (input.kind === 'media') return `📎 ${input.mediaType}${input.caption ? `: ${input.caption}` : ''}`;
  if (input.kind === 'order') return `🛒 Catalogue order (${input.order?.product_items?.length || 0} items)`;
  return `[${msg.type}]`;
}

const enabledFlows = (biz) => FLOWS.filter((f) => biz.has(f.module));

/**
 * Entry point. biz = hydrated business, from = customer phone, profileName from WhatsApp, message = raw message object.
 */
export async function handleIncoming(biz, { from, profileName, message }) {
  const input = normalize(message);
  const customer = touchCustomer(biz.id, from, profileName);
  insert('messages', {
    business_id: biz.id, phone: from, direction: 'in', kind: message.type, body: describeInbound(message, input),
    payload: JSON.stringify(message), wamid: message.id || null, status: 'received', created_at: now(),
  });
  const session = loadSession(biz.id, from);
  const c = new Conversation(biz, customer, session, input);
  try {
    await route(c);
  } catch (e) {
    log.error('engine error', { biz: biz.id, phone: from, err: e.stack });
    c.reset();
    await c.say(c.t('error')).catch(() => {});
  } finally {
    c.save();
  }
  return c;
}

async function route(c) {
  const { input, biz } = c;
  const kw = (input.text || '').toLowerCase().replace(/[!.?]+$/, '').trim();

  // 1. Opt-out / opt-in (WhatsApp policy: always honour STOP)
  if (input.kind === 'text' && OPT_OUT.has(kw)) {
    setCustomerField(c.customer.id, 'opted_in', 0);
    setCustomerField(c.customer.id, 'marketing_opt_in', 0);
    c.reset();
    return c.say(c.t('opted_out'));
  }
  if (input.kind === 'text' && OPT_IN.has(kw) && c.customer.opted_in === 0) {
    setCustomerField(c.customer.id, 'opted_in', 1);
    c.customer.opted_in = 1;
    await c.say(c.t('opted_in'));
    return showMenu(c);
  }

  // 2. Human handoff in progress: stay silent (staff replies from Inbox) unless customer asks for the menu
  if (isPaused(c.session)) {
    if (kw === 'menu' || input.id === 'menu') {
      c.session.bot_paused_until = null;
      c.session.needs_attention = 0;
      return showMenu(c);
    }
    c.needsAttention();
    return true;
  }

  // 3. Global commands
  if (input.id === 'menu' || (input.kind === 'text' && GREETINGS.has(kw))) {
    c.reset();
    return showMenu(c, { greet: true });
  }
  if (input.id === 'human' || (input.kind === 'text' && HUMAN.has(kw))) return handoff(c);
  if (input.kind === 'text' && CANCEL.has(kw) && c.state !== 'MENU') {
    c.reset();
    await c.say(c.t('cancelled_flow'));
    return showMenu(c);
  }

  // 4. Closed hours with "handoff" behaviour: collect the message, reply once
  const open = isOpenAt(biz.settings.hours, biz.timezone);
  if (!open && biz.settings.closed_behavior === 'handoff' && input.kind !== 'choice') {
    c.needsAttention();
    const today = new Date().toISOString().slice(0, 10);
    if (c.ctx.closedNotified !== today) {
      c.ctx.closedNotified = today;
      return c.say(c.t('closed_handoff', { next_open: nextOpening(biz.settings.hours, biz.timezone)?.label || '' }));
    }
    return true;
  }

  // 5. Button / list replies -> owning flow by id prefix ("ord:", "bk:", "enq:")
  if (input.kind === 'choice') {
    const [prefix, ...parts] = String(input.id).split(':');
    const flow = enabledFlows(biz).find((f) => f.prefix === prefix);
    if (flow && (await flow.onChoice(c, parts)) !== false) return true;
    return showMenu(c, { notUnderstood: true });
  }

  // 6. Native WhatsApp catalogue order
  if (input.kind === 'order' && biz.has('ordering')) return ordering.onNativeOrder(c);

  // 7. Location / media / text inside an active step -> the flow that owns the current state
  const owner = enabledFlows(biz).find((f) => f.states.includes(c.state));
  if (input.kind === 'location' && owner?.onLocation && (await owner.onLocation(c)) !== false) return true;
  if (input.kind === 'media') {
    for (const f of enabledFlows(biz)) if (f.onMedia && (await f.onMedia(c)) !== false) return true;
    c.needsAttention();
    await c.notifyOwner(c.t('owner_media', { customer: c.customer.name || 'Customer', phone: c.phone, type: input.mediaType }));
    return c.say(c.t('media_received', { type: input.mediaType }));
  }
  if (input.kind === 'text' && owner && (await owner.onText(c)) !== false) return true;

  // 8. Free text in the menu: FAQ keywords -> product search / AI order -> AI answer
  if (input.kind === 'text' && input.text) {
    for (const f of [enquiry, ordering]) {
      if (biz.has(f.module) && f.onFreeText && (await f.onFreeText(c)) !== false) return true;
    }
    if (aiEnabled(biz, 'answer_questions')) {
      const answer = await answerQuestion(biz, input.text).catch((e) => { log.warn('ai answer failed', { err: e.message }); return null; });
      if (answer) {
        return c.buttons(answer, [{ id: 'menu', title: c.t('btn_menu') }, { id: 'human', title: c.t('menu_human') }]);
      }
    }
  }

  // 9. Nothing matched -> polite menu (never get stuck)
  return showMenu(c, { notUnderstood: c.session.ctx.greeted === true });
}

/** Main menu built from the enabled modules: 3 or fewer options -> buttons, more -> list. */
export async function showMenu(c, { greet = false, notUnderstood = false } = {}) {
  const { biz } = c;
  const items = [...enabledFlows(biz).flatMap((f) => f.menuItems(c)), { id: 'human', title: c.t('menu_human'), description: c.t('menu_human_desc') }];
  c.ctx.greeted = true;
  let body = notUnderstood ? c.t('fallback') : c.t('welcome');
  if (!isOpenAt(biz.settings.hours, biz.timezone) && (greet || !notUnderstood)) {
    const next = nextOpening(biz.settings.hours, biz.timezone);
    if (next) body += `\n\n${c.t('closed_note', { next_open: next.label })}`;
  }
  const style = biz.settings.menu_style;
  if (style === 'buttons' || (style === 'auto' && items.length <= 3)) {
    // keep the 3 most important (module items first, "talk to us" last)
    const btns = items.length <= 3 ? items : [...items.slice(0, 2), items[items.length - 1]];
    return c.send(B.buttons(body, btns));
  }
  return c.send(B.list(body, c.t('menu_list_button'), [{ rows: items }]));
}

export async function handoff(c) {
  c.reset();
  c.pause();
  await c.notifyOwner(c.t('owner_handoff', { customer: c.customer.name || 'Customer', phone: c.phone }));
  return c.say(c.t('handoff_customer'));
}
