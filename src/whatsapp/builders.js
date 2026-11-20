// Builders for every WhatsApp message type we use. They enforce Meta's limits
// so a long product name can never make the API reject a message.
//   reply buttons: max 3, title <= 20 chars, id <= 256
//   list: max 10 rows total, row title <= 24, row description <= 72, button <= 20, section title <= 24
//   interactive body <= 1024, text body <= 4096
import { clip } from '../lib/util.js';

export const LIMITS = { buttons: 3, buttonTitle: 20, rows: 10, rowTitle: 24, rowDesc: 72, listButton: 20, sectionTitle: 24, body: 1024, text: 4096, header: 60, footer: 60 };

export const text = (body, previewUrl = false) => ({ type: 'text', text: { body: clip(body, LIMITS.text), preview_url: previewUrl } });

export function buttons(body, btns, { header, footer } = {}) {
  const list = btns.filter(Boolean).slice(0, LIMITS.buttons);
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header ? { header: { type: 'text', text: clip(header, LIMITS.header) } } : {}),
      body: { text: clip(body, LIMITS.body) },
      ...(footer ? { footer: { text: clip(footer, LIMITS.footer) } } : {}),
      action: { buttons: list.map((b) => ({ type: 'reply', reply: { id: String(b.id).slice(0, 256), title: clip(b.title, LIMITS.buttonTitle) } })) },
    },
  };
}

/** sections: [{ title, rows: [{ id, title, description }] }] - rows beyond 10 are dropped (use pagination). */
export function list(body, buttonLabel, sections, { header, footer } = {}) {
  let left = LIMITS.rows;
  const secs = [];
  for (const s of sections) {
    if (left <= 0) break;
    const rows = s.rows.slice(0, left).map((r) => ({
      id: String(r.id).slice(0, 200),
      title: clip(r.title, LIMITS.rowTitle),
      ...(r.description ? { description: clip(r.description, LIMITS.rowDesc) } : {}),
    }));
    left -= rows.length;
    if (rows.length) secs.push({ ...(s.title ? { title: clip(s.title, LIMITS.sectionTitle) } : {}), rows });
  }
  // WhatsApp requires section titles when there is more than one section
  if (secs.length > 1) secs.forEach((s, i) => { if (!s.title) s.title = `Options ${i + 1}`; });
  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(header ? { header: { type: 'text', text: clip(header, LIMITS.header) } } : {}),
      body: { text: clip(body, LIMITS.body) },
      ...(footer ? { footer: { text: clip(footer, LIMITS.footer) } } : {}),
      action: { button: clip(buttonLabel, LIMITS.listButton), sections: secs },
    },
  };
}

export const ctaUrl = (body, label, url) => ({
  type: 'interactive',
  interactive: { type: 'cta_url', body: { text: clip(body, LIMITS.body) }, action: { name: 'cta_url', parameters: { display_text: clip(label, LIMITS.buttonTitle), url } } },
});

export const image = (link, caption) => ({ type: 'image', image: { link, ...(caption ? { caption: clip(caption, 1024) } : {}) } });
export const document = (link, filename, caption) => ({ type: 'document', document: { link, filename, ...(caption ? { caption } : {}) } });
export const location = (lat, lng, name, address) => ({ type: 'location', location: { latitude: lat, longitude: lng, name, address } });

/**
 * Approved template. bodyParams: array of strings for {{1}}, {{2}}...
 * quickReplies: array of payload strings for the template's quick-reply buttons (by index).
 * Template params cannot contain newlines/tabs or >4 consecutive spaces - we sanitise.
 */
export function template(name, lang, bodyParams = [], quickReplies = []) {
  const clean = (v) => String(v ?? '-').replace(/[\n\t]+/g, ' | ').replace(/ {4,}/g, '   ').trim() || '-';
  const components = [];
  if (bodyParams.length) components.push({ type: 'body', parameters: bodyParams.map((p) => ({ type: 'text', text: clean(p) })) });
  quickReplies.forEach((payload, i) => {
    if (payload) components.push({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload: String(payload) }] });
  });
  return { type: 'template', template: { name, language: { code: lang || 'en' }, ...(components.length ? { components } : {}) } };
}

/** One-line human summary of an outbound message (for the inbox / logs). */
export function summarize(msg) {
  switch (msg.type) {
    case 'text': return msg.text.body;
    case 'interactive': {
      const i = msg.interactive;
      const body = i.body?.text || '';
      if (i.type === 'button') return `${body}\n${i.action.buttons.map((b) => `[${b.reply.title}]`).join(' ')}`;
      if (i.type === 'list') return `${body}\n☰ ${i.action.button}: ${i.action.sections.flatMap((s) => s.rows.map((r) => r.title)).join(' · ')}`;
      if (i.type === 'cta_url') return `${body}\n🔗 [${i.action.parameters.display_text}] ${i.action.parameters.url}`;
      return body;
    }
    case 'template': {
      const params = msg.template.components?.find((c) => c.type === 'body')?.parameters?.map((p) => p.text) || [];
      return `📄 Template "${msg.template.name}"${params.length ? `: ${params.join(' · ')}` : ''}`;
    }
    case 'image': return `🖼️ Image ${msg.image.caption || ''}`.trim();
    case 'document': return `📄 ${msg.document.filename}`;
    case 'location': return `📍 ${msg.location.name || ''} ${msg.location.address || ''}`.trim();
    default: return msg.type;
  }
}
