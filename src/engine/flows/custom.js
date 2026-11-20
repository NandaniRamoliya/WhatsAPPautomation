// CUSTOM MENU & QUICK REPLIES (no code): owners add their own menu buttons and
// keyword-triggered replies from the dashboard. A reply can be text, a link button,
// an image, a document (e.g. price list PDF), a map location, or a jump into a flow.
import { all, get } from '../../db/index.js';
import * as B from '../../whatsapp/builders.js';

export const quickReplies = (bizId) => all('SELECT * FROM quick_replies WHERE business_id = ? AND active = 1 ORDER BY sort, id', bizId);

const words = (s) => ` ${String(s).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `;

/** Keyword match: a keyword (or the button title) must appear as whole word(s) in the message. */
export function matchQuickReply(bizId, textIn) {
  const msg = words(textIn);
  let best = null;
  let bestLen = 0;
  for (const r of quickReplies(bizId)) {
    const keys = String(r.keywords || '').split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
    for (const k of keys) {
      if (msg.includes(words(k)) && k.length > bestLen) { best = r; bestLen = k.length; }
    }
  }
  return best;
}

export const custom = {
  module: null, // always on when the business has quick replies
  prefix: 'qr',
  states: [],

  menuItems(c) {
    return quickReplies(c.biz.id).filter((r) => r.show_in_menu).map((r) => ({ id: `qr:${r.id}`, title: r.title, description: r.description || '' }));
  },

  async onChoice(c, [id]) {
    const r = get('SELECT * FROM quick_replies WHERE business_id = ? AND id = ? AND active = 1', c.biz.id, Number(id));
    if (!r) return false;
    return sendQuickReply(c, r);
  },

  async onFreeText(c) {
    const r = matchQuickReply(c.biz.id, c.input.text || '');
    return r ? sendQuickReply(c, r) : false;
  },
};

const fileName = (url) => decodeURIComponent(String(url).split('?')[0].split('/').pop() || 'document.pdf').slice(0, 80);

export async function sendQuickReply(c, r) {
  c.reset();
  const after = [{ id: 'menu', title: c.t('btn_menu') }, { id: 'human', title: c.t('menu_human') }];
  const body = r.body || r.title;
  switch (r.reply_type) {
    case 'link':
      if (!r.url) return c.buttons(body, after);
      return c.cta(body, r.button_label || c.t('btn_more_info'), r.url);
    case 'image':
      if (!r.url) return c.buttons(body, after);
      return c.send(B.image(r.url, r.body || ''));
    case 'document':
      if (!r.url) return c.buttons(body, after);
      return c.send(B.document(r.url, fileName(r.url), r.body || ''));
    case 'location':
      if (r.latitude == null || r.longitude == null) return c.buttons(body, after);
      await c.send(B.location(r.latitude, r.longitude, r.title, r.body || c.biz.address || ''));
      return true;
    case 'flow':
      if (r.body) await c.say(r.body);
      return c.dispatch(r.flow_target || 'menu');
    default:
      return c.biz.settings.show_menu_after_answer ? c.buttons(body, after) : c.say(body);
  }
}
