import { html } from '../lib.js';
import { Page, ResourceManager, QuickToggle, Alert } from '../ui.js';

export function Faqs() {
  return html`<${Page} title="FAQs" subtitle="Answers the bot gives instantly – timings, fees, location, parking…">
    <${Alert}>💡 Customers can pick a question from the menu <b>or just type it</b>. The bot matches the keywords you add (e.g. <i>fees, charges, price</i>) and replies automatically.<//>
    <${ResourceManager} path="faqs" singular="FAQ" defaults=${{ active: 1 }}
      empty="Add the 5–10 questions people ask you most."
      columns=${[
        { label: 'Question', render: (f) => html`<strong>${f.question}</strong><div class="small muted">${f.answer}</div>` },
        { label: 'Keywords', key: 'keywords' },
        { label: 'On', render: (f, reload) => html`<${QuickToggle} path="faqs" item=${f} field="active" onDone=${reload} />` },
      ]}
      fields=${[
        { key: 'question', label: 'Question', required: true, wide: true, help: 'Keep the first 24 characters meaningful – that is what shows in the menu.' },
        { key: 'answer', label: 'Answer', type: 'textarea', required: true, wide: true, help: 'Use *bold* and line breaks like in WhatsApp.' },
        { key: 'keywords', label: 'Keywords', wide: true, placeholder: 'fees, charges, price, kitna', help: 'Comma separated words or phrases that trigger this answer. Add Hindi/Hinglish words too.' },
        { key: 'sort', label: 'Sort order', type: 'number' },
        { key: 'active', label: 'Active', type: 'toggle' },
      ]} />
  <//>`;
}
