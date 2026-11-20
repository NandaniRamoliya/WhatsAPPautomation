// Conversation context passed to every flow handler. Wraps the business,
// customer, session state and the reply helpers, so flows stay short.
import * as B from '../whatsapp/builders.js';
import { send } from '../whatsapp/sender.js';
import { text } from './texts.js';
import { saveSession } from './session.js';
import { firstName } from '../services/customers.js';
import { notifyOwner } from '../services/notify.js';

export class Conversation {
  constructor(biz, customer, session, input) {
    this.biz = biz;
    this.customer = customer;
    this.session = session;
    this.input = input;
    this.phone = session.phone;
  }

  /** Customer's chosen language (falls back to the business language inside text()). */
  get lang() { return this.customer?.language || null; }

  get state() { return this.session.state; }
  get ctx() { return this.session.ctx; }
  get cart() { return this.session.cart; }
  set cart(v) { this.session.cart = v; }

  /** Text lookup with common variables pre-filled. */
  t(key, vars = {}) {
    const n = firstName(this.customer?.name);
    return text(this.biz, key, { name_sp: n ? ` ${n}` : '', name: n, ...vars }, this.lang);
  }

  setState(state, ctxPatch = {}) {
    this.session.state = state;
    Object.assign(this.session.ctx, ctxPatch);
  }

  /** Clear flow state but keep long-lived context (e.g. recall target). */
  reset() {
    const keep = { recallService: this.session.ctx.recallService };
    this.session.state = 'MENU';
    this.session.ctx = Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined));
  }

  save() { saveSession(this.session); }

  send(msg) { return send(this.biz, this.phone, msg); }
  say(body) { return this.send(B.text(body)); }
  buttons(body, btns, opts) { return this.send(B.buttons(body, btns, opts)); }
  cta(body, label, url) { return this.send(B.ctaUrl(body, label, url)); }

  /**
   * List with automatic pagination: 9 rows + "More options" when there are more.
   * pageId(n) must return the choice id that opens page n.
   */
  pagedList(body, buttonLabel, rows, page = 0, pageId = null, sectionTitle = '') {
    const per = rows.length > 10 ? 9 : 10;
    const slice = rows.slice(page * per, page * per + per);
    if (pageId && rows.length > (page + 1) * per) slice.push({ id: pageId(page + 1), title: this.t('more'), description: this.t('more_desc') });
    return this.send(B.list(body, buttonLabel, [{ title: sectionTitle, rows: slice }]));
  }

  notifyOwner(message) { return notifyOwner(this.biz, message); }

  needsAttention() { this.session.needs_attention = 1; }

  /** Human handoff: bot stays silent for this chat; it shows as "needs reply" in the inbox. */
  pause(hours = this.biz.settings.handoff_pause_hours) {
    this.session.bot_paused_until = new Date(Date.now() + Number(hours || 12) * 3600_000).toISOString();
    this.session.needs_attention = 1;
  }
}
