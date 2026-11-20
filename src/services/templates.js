// Suggested WhatsApp message templates. Business-initiated messages sent more than
// 24h after the customer's last message MUST use an approved template.
// The dashboard can submit all of these to Meta in one click.
import * as B from '../whatsapp/builders.js';

export const TEMPLATE_SLOTS = {
  owner_alert: {
    label: 'Owner / staff alerts', category: 'UTILITY', name: 'owner_alert',
    body: 'New alert from your WhatsApp assistant: {{1}}',
    example: ['NEW ORDER #12 | Rahul | Atta x1 | Total Rs 250 | COD'],
    buttons: [],
    usedFor: 'New order / booking / enquiry alerts when the owner has not messaged the bot in 24h.',
  },
  order_update: {
    label: 'Order status updates', category: 'UTILITY', name: 'order_update',
    body: 'Hi {{1}}, there is an update on your order: {{2}}',
    example: ['Rahul', 'Your order #12 is out for delivery.'],
    buttons: [],
    usedFor: 'Preparing / out for delivery / delivered messages after the 24h window.',
  },
  appointment_reminder: {
    label: 'Appointment reminders', category: 'UTILITY', name: 'appointment_reminder',
    body: 'Hi {{1}}, this is a reminder of your {{2}} appointment on {{3}} at {{4}}. Please confirm or reschedule using the buttons below.',
    example: ['Neha', 'Dental check-up', 'Sat, 21 Nov', '10:30 AM'],
    buttons: ['Confirm', 'Reschedule'],
    usedFor: '24h / 2h reminders (almost always outside the window).',
  },
  appointment_checkin: {
    label: 'After-visit check-in', category: 'UTILITY', name: 'appointment_checkin',
    body: 'Hi {{1}}, how are you feeling after your {{2}}? Tap a button to let us know.',
    example: ['Neha', 'root canal treatment'],
    buttons: ['Better', 'Same', 'Not good'],
    usedFor: 'Day-3 "how are you feeling" message.',
  },
  appointment_recall: {
    label: 'Recall / repeat visit', category: 'MARKETING', name: 'appointment_recall',
    body: 'Hi {{1}}, your {{2}} at {{3}} is due. Would you like to book a visit?',
    example: ['Neha', '6-month cleaning', 'Pearl Dental'],
    buttons: ['Book now'],
    usedFor: '6-month cleaning, renewals, repeat services.',
  },
};

/** Build a template message for a slot if the business configured an approved name. */
export function slotTemplate(biz, slot, params, quickReplyPayloads = []) {
  const cfg = biz.settings.templates?.[slot];
  if (!cfg?.name) return null;
  return B.template(cfg.name, cfg.lang || 'en', params, quickReplyPayloads);
}

/** Meta "create template" request body for a slot. */
export function templateDefinition(slot, lang = 'en') {
  const t = TEMPLATE_SLOTS[slot];
  const components = [{ type: 'BODY', text: t.body, example: { body_text: [t.example] } }];
  if (t.buttons.length) components.push({ type: 'BUTTONS', buttons: t.buttons.map((text) => ({ type: 'QUICK_REPLY', text })) });
  return { name: t.name, language: lang, category: t.category, components };
}
