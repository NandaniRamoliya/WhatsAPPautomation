// ENQUIRY flow: FAQs (menu + keyword auto-answers) and lead capture
// (configurable questions -> saved lead -> owner alert).
import { all, get, insert } from '../../db/index.js';
import { clip } from '../../lib/util.js';

const faqs = (bizId) => all('SELECT * FROM faqs WHERE business_id = ? AND active = 1 ORDER BY sort, id', bizId);
const leadQuestions = (biz) => (biz.settings.enquiry?.lead_questions || []).filter((q) => q?.question);

export const enquiry = {
  module: 'enquiry',
  prefix: 'enq',
  states: ['LEAD_Q'],

  menuItems(c) {
    const items = [];
    if (faqs(c.biz.id).length) items.push({ id: 'enq:faqs:0', title: c.t('menu_faq'), description: c.t('menu_faq_desc') });
    if (leadQuestions(c.biz).length) items.push({ id: 'enq:lead', title: c.t('menu_enquiry'), description: c.t('menu_enquiry_desc') });
    return items;
  },

  async onChoice(c, [action, a1, a2]) {
    switch (action) {
      case 'faqs': return showFaqs(c, Number(a1) || 0);
      case 'q': return answer(c, get('SELECT * FROM faqs WHERE business_id = ? AND id = ?', c.biz.id, Number(a1)));
      case 'lead': c.setState('LEAD_Q', { lead: { i: 0, answers: {} } }); return askLead(c);
      case 'la': return saveLeadAnswer(c, (leadQuestions(c.biz)[Number(a1)]?.options || [])[Number(a2)]);
      default: return false;
    }
  },

  async onText(c) {
    if (c.state === 'LEAD_Q') return saveLeadAnswer(c, c.input.text.slice(0, 500));
    return false;
  },

  /** Keyword match free text against FAQs. Returns true if answered. */
  async onFreeText(c) {
    const hit = matchFaq(c.biz.id, c.input.text || '');
    if (!hit) return false;
    return answer(c, hit);
  },
};

const words = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2);
const STOP = new Set(['the', 'what', 'are', 'your', 'you', 'how', 'can', 'and', 'for', 'kya', 'hai', 'aap', 'kab', 'kaise', 'does', 'have', 'there', 'with', 'this', 'that']);

export function matchFaq(bizId, textIn) {
  const msg = ` ${String(textIn).toLowerCase()} `;
  const mw = new Set(words(textIn).filter((w) => !STOP.has(w)));
  if (!mw.size) return null;
  let best = null;
  let bestScore = 0;
  for (const f of faqs(bizId)) {
    let score = 0;
    for (const k of String(f.keywords || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
      if (msg.includes(k)) score += 3;
    }
    for (const w of words(f.question)) if (!STOP.has(w) && mw.has(w)) score += 1;
    if (score > bestScore) { best = f; bestScore = score; }
  }
  return bestScore >= 2 ? best : null;
}

async function showFaqs(c, page) {
  const list = faqs(c.biz.id);
  if (!list.length) return false;
  const rows = list.map((f) => ({ id: `enq:q:${f.id}`, title: f.question, description: f.question.length > 24 ? clip(f.question, 72) : '' }));
  return c.pagedList(c.t('faq_choose'), c.t('faq_button'), rows, page, (n) => `enq:faqs:${n}`);
}

async function answer(c, f) {
  if (!f) return showFaqs(c, 0);
  c.reset();
  return c.buttons(c.t('faq_answer', { question: f.question, answer: f.answer }), [
    { id: 'enq:faqs:0', title: c.t('menu_faq') }, { id: 'menu', title: c.t('btn_menu') }, { id: 'human', title: c.t('menu_human') },
  ]);
}

async function askLead(c) {
  const qs = leadQuestions(c.biz);
  const i = c.ctx.lead?.i ?? 0;
  if (i >= qs.length) return finishLead(c);
  const q = qs[i];
  const opts = (q.options || []).filter(Boolean);
  if (opts.length && opts.length <= 3) return c.buttons(q.question, opts.map((o, k) => ({ id: `enq:la:${i}:${k}`, title: o })));
  if (opts.length > 3) return c.pagedList(q.question, c.t('staff_button'), opts.map((o, k) => ({ id: `enq:la:${i}:${k}`, title: o })));
  return c.say(q.question);
}

async function saveLeadAnswer(c, value) {
  if (!c.ctx.lead) return false;
  const q = leadQuestions(c.biz)[c.ctx.lead.i];
  if (q && value) c.ctx.lead.answers[q.key || q.question.slice(0, 40)] = value;
  c.ctx.lead.i += 1;
  return askLead(c);
}

async function finishLead(c) {
  const answers = c.ctx.lead?.answers || {};
  const name = answers.name || c.customer.name || null;
  insert('leads', { business_id: c.biz.id, customer_id: c.customer.id, phone: c.phone, name, answers: JSON.stringify(answers) });
  c.reset();
  await c.notifyOwner(c.t('owner_new_lead', { name: name || 'Customer', phone: c.phone, answers: Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join('\n') }));
  return c.buttons(c.t('lead_done'), [{ id: 'menu', title: c.t('btn_menu') }]);
}
