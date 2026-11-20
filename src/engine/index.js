// The conversation brain. Every inbound WhatsApp message (or simulator message)
// enters here: normalise -> global commands -> current flow -> free text (quick replies,
// FAQs, AI, search) -> menu. State is re-read from the database on every message, so
// restarts never lose a chat.
import { insert, now, get, run } from '../db/index.js';
import { log } from '../lib/logger.js';
import { isOpenAt, nextOpening } from '../lib/time.js';
import * as B from '../whatsapp/builders.js';
import { Conversation } from './conversation.js';
import { loadSession, isPaused, pauseBot } from './session.js';
import { offeredLanguages, LANGUAGE_SELF } from './texts.js';
import { touchCustomer, setCustomerField, getCustomer } from '../services/customers.js';
import { aiEnabled, understand } from '../services/ai.js';
import { emit } from '../services/integrations.js';
import { ordering, addAiItems } from './flows/ordering.js';
import { booking } from './flows/booking.js';
import { enquiry } from './flows/enquiry.js';
import { custom } from './flows/custom.js';

/** Registered flows. Add a new module here (see the Developer Guide -> "Add a new flow"). */
export const FLOWS = [ordering, booking, enquiry, custom];

const GREETINGS = new Set(['hi', 'hii', 'hiii', 'hello', 'helo', 'hey', 'menu', 'start over', 'restart', 'namaste', 'namaskar', 'hola', 'salam', 'hlo', 'hy', 'main menu', 'home', '0', 'good morning', 'good evening', 'good afternoon', 'help', 'नमस्ते', 'हेलो', 'નમસ્તે', 'હેલો', 'kem cho', 'jai shree krishna']);
const HUMAN = new Set(['human', 'agent', 'person', 'talk to human', 'talk to someone', 'call me', 'support', 'customer care', 'baat karni hai', 'owner']);
const CANCEL = new Set(['cancel', 'stop order', 'back', 'exit', 'band karo']);
const OPT_OUT = new Set(['stop', 'unsubscribe', 'opt out', 'optout']);
const OPT_IN = new Set(['start', 'subscribe', 'opt in']);
const LANGUAGE_WORDS = new Set(['language', 'change language', 'bhasha', 'भाषा', 'ભાષા', 'lang']);

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

const enabledFlows = (biz) => FLOWS.filter((f) => !f.module || biz.has(f.module));

/**
 * Entry point. biz = hydrated business, from = customer phone, profileName from WhatsApp, message = raw message object.
 */
export async function handleIncoming(biz, { from, profileName, message }) {
  const input = normalize(message);
  const isNew = !getCustomer(biz.id, from);
  const customer = touchCustomer(biz.id, from, profileName);
  insert('messages', {
    business_id: biz.id, phone: from, direction: 'in', kind: message.type, body: describeInbound(message, input),
    payload: JSON.stringify(message), wamid: message.id || null, status: 'received', created_at: now(),
  });
  if (isNew) emit(biz, 'customer.created', { phone: from, name: customer.name });
  const session = loadSession(biz.id, from);
  const c = new Conversation(biz, customer, session, input);
  c.dispatch = (id) => { c.input = { kind: 'choice', id, text: '' }; return route(c); };
  c.isNewCustomer = isNew;
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

/** The owner replied from the WhatsApp Business app on their phone (coexistence): log it and let the human lead. */
export function recordEcho(biz, echo) {
  const to = echo.to || echo.recipient_id;
  if (!to || echo.from === to) return;
  const body = echo.text?.body || (echo.type ? `[${echo.type}]` : '');
  if (echo.id && get('SELECT 1 FROM messages WHERE wamid = ?', echo.id)) return; // our own bot message
  insert('messages', { business_id: biz.id, phone: to, direction: 'out', kind: echo.type || 'text', body, payload: JSON.stringify(echo), wamid: echo.id || null, status: 'sent', sent_by: 'WhatsApp app', created_at: now() });
  run('INSERT INTO sessions (business_id, phone) VALUES (?, ?) ON CONFLICT DO NOTHING', biz.id, to);
  pauseBot(biz.id, to, biz.settings.handoff_pause_hours);
  run('UPDATE sessions SET needs_attention = 0 WHERE business_id = ? AND phone = ?', biz.id, to);
}

async function route(c) {
  const { input, biz } = c;
  const kw = (input.text || '').toLowerCase().replace(/[!.?।]+$/, '').trim();

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

  // 3. Language choice ("lang:gu" button, or typing "language")
  const langs = offeredLanguages(biz);
  if (input.kind === 'choice' && String(input.id).startsWith('lang:')) {
    const pick = String(input.id).slice(5);
    if (pick === 'pick') return askLanguage(c);
    if (langs.includes(pick)) {
      setCustomerField(c.customer.id, 'language', pick);
      c.customer.language = pick;
      await c.say(c.t('language_set'));
      return showMenu(c);
    }
  }
  if (input.kind === 'text' && LANGUAGE_WORDS.has(kw) && langs.length > 1) return askLanguage(c);

  // 4. Global commands
  if (input.id === 'menu' || (input.kind === 'text' && GREETINGS.has(kw))) {
    c.reset();
    if (langs.length > 1 && !c.customer.language && biz.settings.language_choice?.ask_first !== false) return askLanguage(c);
    return showMenu(c, { greet: true });
  }
  if (String(input.id).startsWith('menu:p:')) return showMenu(c, { page: Number(String(input.id).split(':')[2]) || 0 });
  if (input.id === 'human' || (input.kind === 'text' && HUMAN.has(kw))) return handoff(c);
  if (input.kind === 'text' && CANCEL.has(kw) && c.state !== 'MENU') {
    c.reset();
    await c.say(c.t('cancelled_flow'));
    return showMenu(c);
  }

  // 5. Closed hours with "handoff" behaviour: collect the message, reply once
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

  // 6. Button / list replies -> owning flow by id prefix ("ord:", "bk:", "enq:", "qr:")
  if (input.kind === 'choice') {
    const [prefix, ...parts] = String(input.id).split(':');
    const flow = enabledFlows(biz).find((f) => f.prefix === prefix);
    if (flow && (await flow.onChoice(c, parts)) !== false) return true;
    return showMenu(c, { notUnderstood: true });
  }

  // 7. Native WhatsApp catalogue order
  if (input.kind === 'order' && biz.has('ordering')) return ordering.onNativeOrder(c);

  // 8. Location / media / text inside an active step -> the flow that owns the current state
  const owner = enabledFlows(biz).find((f) => f.states.includes(c.state));
  if (input.kind === 'location' && owner?.onLocation && (await owner.onLocation(c)) !== false) return true;
  if (input.kind === 'media') {
    for (const f of enabledFlows(biz)) if (f.onMedia && (await f.onMedia(c)) !== false) return true;
    c.needsAttention();
    await c.notifyOwner(c.t('owner_media', { customer: c.customer.name || 'Customer', phone: c.phone, type: input.mediaType }));
    return c.say(c.t('media_received', { type: input.mediaType }));
  }
  if (input.kind === 'text' && owner && (await owner.onText(c)) !== false) return true;

  // 9. Free text at the menu: owner's quick replies -> FAQ keywords -> AI brain -> product search
  if (input.kind === 'text' && input.text) {
    if ((await custom.onFreeText(c)) !== false) return true;
    if (biz.has('enquiry') && (await enquiry.onFreeText(c)) !== false) return true;
    if (aiEnabled(biz) && (await aiReply(c)) !== false) return true;
    if (biz.has('ordering') && (await ordering.onFreeText(c)) !== false) return true;
  }

  // 10. Nothing matched -> polite menu (never get stuck)
  return showMenu(c, { notUnderstood: c.session.ctx.greeted === true });
}

/** Let the AI understand free text, then route into the safe, tested flows. */
async function aiReply(c) {
  const { biz } = c;
  const r = await understand(biz, { phone: c.phone, text: c.input.text, lang: c.lang });
  if (!r) return false;
  if (r.intent === 'human') return handoff(c, r.answer);
  if (r.intent === 'greeting' && !r.answerable) return showMenu(c, { greet: true });
  if (r.intent === 'order' && r.items.length && biz.has('ordering') && biz.settings.ai.order_parsing !== false) return addAiItems(c, r);
  if (r.intent === 'booking' && biz.has('booking')) {
    if (r.answerable && r.answer) await c.say(r.answer);
    return booking.onChoice(c, ['start']);
  }
  if (r.answerable && r.answer && biz.settings.ai.answer_questions !== false) {
    const next = [];
    if (r.suggest === 'order' && biz.has('ordering')) next.push({ id: 'ord:start', title: c.t('menu_order') });
    if (r.suggest === 'book' && biz.has('booking')) next.push({ id: 'bk:start', title: c.t('btn_book_now') });
    if (r.suggest === 'faq' && biz.has('enquiry')) next.push({ id: 'enq:faqs:0', title: c.t('menu_faq') });
    next.push({ id: 'menu', title: c.t('btn_menu') });
    if (next.length < 3) next.push({ id: 'human', title: c.t('menu_human') });
    return c.buttons(r.answer, next.slice(0, 3));
  }
  // Not answerable from the business information
  if (biz.has('ordering') && (await ordering.onFreeText(c)) !== false) return true;
  if (biz.settings.ai.handoff_when_unsure !== false) {
    return c.buttons(c.t('ai_unsure'), [{ id: 'human', title: c.t('menu_human') }, { id: 'menu', title: c.t('btn_menu') }]);
  }
  return false;
}

async function askLanguage(c) {
  const rows = offeredLanguages(c.biz).map((l) => ({ id: `lang:${l}`, title: LANGUAGE_SELF[l] || l }));
  if (rows.length <= 3) return c.buttons(c.t('choose_language'), rows);
  return c.send(B.list(c.t('choose_language'), c.t('language_button'), [{ rows }]));
}

/** Main menu built from enabled modules + custom buttons: 3 or fewer -> buttons, more -> list (paged). */
export async function showMenu(c, { greet = false, notUnderstood = false, page = 0 } = {}) {
  const { biz } = c;
  const s = biz.settings;
  const moduleItems = enabledFlows(biz).filter((f) => f !== custom).flatMap((f) => f.menuItems(c));
  const customItems = custom.menuItems(c);
  const items = [
    ...(s.custom_menu_position === 'top' ? [...customItems, ...moduleItems] : [...moduleItems, ...customItems]),
    ...(offeredLanguages(biz).length > 1 ? [{ id: 'lang:pick', title: c.t('menu_language'), description: c.t('menu_language_desc') }] : []),
    { id: 'human', title: c.t('menu_human'), description: c.t('menu_human_desc') },
  ];
  c.ctx.greeted = true;
  let body = notUnderstood ? c.t('fallback') : c.t('welcome');
  if (!isOpenAt(s.hours, biz.timezone) && (greet || !notUnderstood)) {
    const next = nextOpening(s.hours, biz.timezone);
    if (next) body += `\n\n${c.t('closed_note', { next_open: next.label })}`;
  }
  // Welcome image / logo once per day
  const today = new Date().toISOString().slice(0, 10);
  if (greet && s.welcome_image_url && c.ctx.welcomeImage !== today) {
    c.ctx.welcomeImage = today;
    await c.send(B.image(s.welcome_image_url));
  }
  const style = s.menu_style;
  if (style === 'buttons' || (style === 'auto' && items.length <= 3)) {
    const btns = items.length <= 3 ? items : [...items.slice(0, 2), items[items.length - 1]];
    return c.send(B.buttons(body, btns));
  }
  return c.pagedList(body, c.t('menu_list_button'), items, page, (n) => `menu:p:${n}`);
}

export async function handoff(c, message = '') {
  c.reset();
  c.pause();
  emit(c.biz, 'handoff.requested', { phone: c.phone, name: c.customer.name, message: c.input.text || '' });
  await c.notifyOwner(c.t('owner_handoff', { customer: c.customer.name || 'Customer', phone: c.phone }));
  return c.say(message || c.t('handoff_customer'));
}

