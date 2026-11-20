// Alerts to the business owner / staff on WhatsApp. Outside the 24h window an
// approved "owner_alert" template (one parameter) is used automatically.
import * as B from '../whatsapp/builders.js';
import { send } from '../whatsapp/sender.js';
import { log } from '../lib/logger.js';

const oneLine = (s) => String(s).replace(/\s*\n\s*/g, ' | ').slice(0, 900);

export async function notifyPhone(biz, phone, message) {
  if (!phone) return null;
  const tpl = biz.settings.templates?.owner_alert;
  const fallback = tpl?.name ? B.template(tpl.name, tpl.lang, [oneLine(message)]) : null;
  const r = await send(biz, phone, B.text(message), { fallbackTemplate: fallback, sentBy: 'system' });
  if (!r.ok && !r.dryRun) log.warn('alert not delivered', { biz: biz.id, phone, error: r.error });
  return r;
}

export function notifyOwner(biz, message) {
  if (!biz.settings.notify?.owner_whatsapp) return null;
  return notifyPhone(biz, biz.owner_phone, message);
}
