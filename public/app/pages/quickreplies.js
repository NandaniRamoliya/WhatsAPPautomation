// Custom menu buttons & keyword quick replies (no code).
import { useState } from 'preact/hooks';
import { html, api, act, useApp } from '../lib.js';
import { Page, Card, ResourceManager, QuickToggle, Badge, Alert, FormFields, AsyncButton } from '../ui.js';

const TYPES = [
  { value: 'text', label: '💬 Text message' },
  { value: 'link', label: '🔗 Link button (website, form, Google Maps, payment…)' },
  { value: 'image', label: '🖼️ Image (offer poster, menu photo)' },
  { value: 'document', label: '📄 Document / PDF (price list, brochure)' },
  { value: 'location', label: '📍 Map location' },
  { value: 'flow', label: '➡️ Start a bot flow (order, book, enquiry…)' },
];
const FLOWS = [
  { value: 'ord:start', label: '🛒 Start ordering' }, { value: 'ord:my', label: '📦 My orders' },
  { value: 'bk:start', label: '📅 Book appointment' }, { value: 'bk:my', label: '🗓️ My appointments' },
  { value: 'enq:faqs:0', label: '❓ FAQ list' }, { value: 'enq:lead', label: '📝 Enquiry form' },
  { value: 'human', label: '👤 Talk to a person' }, { value: 'lang:pick', label: '🌐 Choose language' }, { value: 'menu', label: '🏠 Main menu' },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label.split(' (')[0]]));

export function QuickReplies() {
  const { biz, reloadBiz } = useApp();
  const [v, setV] = useState({ settings: structuredClone(biz.settings) });
  const save = async () => { if (await act(() => api('/business', { method: 'PUT', body: { settings: { custom_menu_position: v.settings.custom_menu_position, welcome_image_url: v.settings.welcome_image_url, show_menu_after_answer: v.settings.show_menu_after_answer } } }), 'Saved')) reloadBiz(); };
  const needsUrl = (x) => !['link', 'image', 'document'].includes(x.reply_type);
  return html`<${Page} title="Menu & quick replies" subtitle="Add your own buttons to the WhatsApp menu, and automatic replies when customers type certain words.">
    <${Alert}>💡 Examples: <b>📄 Price list</b> → sends your PDF · <b>🎁 Today's offers</b> → sends the offer poster · <b>📍 Location</b> → map pin · <b>🌐 Website</b> → link button · keyword <i>"timing"</i> → your opening hours. Customers can tap the button <b>or</b> just type a keyword.<//>
    <${ResourceManager} path="quick-replies" singular="Button / reply" defaults=${{ reply_type: 'text', show_in_menu: 1, active: 1 }}
      empty="Add buttons like Price list, Offers, Location, Website, Timings."
      columns=${[
        { label: 'Button', render: (r) => html`<strong>${r.title}</strong>${r.description && html`<div class="small muted">${r.description}</div>`}` },
        { label: 'Reply', render: (r) => html`${TYPE_LABEL[r.reply_type]}<div class="small muted">${(r.body || r.url || r.flow_target || '').slice(0, 80)}</div>` },
        { label: 'Keywords', key: 'keywords' },
        { label: 'In menu', render: (r, reload) => html`<${QuickToggle} path="quick-replies" item=${r} field="show_in_menu" onDone=${reload} />` },
        { label: 'On', render: (r, reload) => html`<${QuickToggle} path="quick-replies" item=${r} field="active" onDone=${reload} />` },
      ]}
      fields=${[
        { key: 'title', label: 'Button label', required: true, help: 'Max 24 characters show in the WhatsApp menu. Start with an emoji 🙂' },
        { key: 'description', label: 'Small text under the label (optional)', help: 'Max 72 characters.' },
        { key: 'reply_type', label: 'When tapped / triggered, send…', type: 'select', options: TYPES, wide: true },
        { key: 'body', label: 'Message text / caption', type: 'textarea', rows: 4, wide: true, help: 'Use *bold* and emojis like in WhatsApp.', hidden: (x) => x.reply_type === 'location' },
        { key: 'url', label: 'Link / image / PDF address (https://…)', type: 'url', wide: true, hidden: needsUrl, help: 'Must be a public https link. Tip: upload files to Google Drive/Dropbox and use a direct-download link, or your website.' },
        { key: 'button_label', label: 'Link button text', placeholder: 'Open', hidden: (x) => x.reply_type !== 'link', help: 'Max 20 characters.' },
        { key: 'latitude', label: 'Latitude', type: 'number', step: 'any', hidden: (x) => x.reply_type !== 'location', help: 'Google Maps → right-click your shop → copy the first number.' },
        { key: 'longitude', label: 'Longitude', type: 'number', step: 'any', hidden: (x) => x.reply_type !== 'location', help: 'The second number.' },
        { key: 'body', label: 'Address shown with the pin', hidden: (x) => x.reply_type !== 'location' },
        { key: 'flow_target', label: 'Start this', type: 'select', options: FLOWS, hidden: (x) => x.reply_type !== 'flow' },
        { key: 'keywords', label: 'Keywords that trigger this reply', wide: true, placeholder: 'price list, rate card, rates, bhav', help: 'Comma separated. Whole words/phrases. Add Hindi/Gujarati words too.' },
        { key: 'sort', label: 'Order in menu', type: 'number' },
        { key: 'show_in_menu', label: 'Show as a button in the main menu', type: 'toggle' },
        { key: 'active', label: 'Active', type: 'toggle' },
      ]}
      rowActions=${(r) => html`<${Badge} tone=${r.show_in_menu ? 'ok' : 'muted'}>${r.show_in_menu ? 'menu' : 'keyword only'}<//> `} />
    <${Card} title="Menu options">
      <${FormFields} value=${v} onChange=${setV} fields=${[
        { key: 'settings.custom_menu_position', label: 'Show my buttons', type: 'select', options: [{ value: 'bottom', label: 'After the standard options (Order, Book, Questions…)' }, { value: 'top', label: 'Before the standard options' }] },
        { key: 'settings.welcome_image_url', label: 'Welcome image / logo (optional)', type: 'url', placeholder: 'https://…/logo.jpg', help: 'Sent with the first welcome message of the day.' },
        { key: 'settings.show_menu_after_answer', label: 'Add Menu / Talk to us buttons after text replies', type: 'toggle' },
      ]} />
      <div style="margin-top:12px"><${AsyncButton} variant="primary" onClick=${save}>💾 Save<//></div>
    <//>
  <//>`;
}
