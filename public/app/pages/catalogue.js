import { useState } from 'preact/hooks';
import { html, api, act, download } from '../lib.js';
import { Page, ResourceManager, QuickToggle, Money, Button, AsyncButton, Modal, Field, Alert, Toggle } from '../ui.js';

function ImportModal({ onClose, onDone }) {
  const [csv, setCsv] = useState('');
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState(null);
  const run = async () => { const r = await act(() => api('/products/import', { method: 'POST', body: { csv, replace } })); if (r) { setResult(r); onDone(); } };
  return html`<${Modal} title="Import products from a spreadsheet" onClose=${onClose} wide footer=${html`<${Button} onClick=${onClose}>Close<//><${AsyncButton} variant="primary" disabled=${!csv} onClick=${run}>Import<//>`}>
    <p class="muted">In Excel or Google Sheets make columns <code>name, price, category, unit, description, in_stock, image_url, sku</code> and save as CSV. Price in rupees (e.g. 120.50). Existing products with the same name are updated.</p>
    <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange=${async (e) => setCsv(await e.target.files[0]?.text())} />
    <${Field} f=${{ key: 'csv', label: 'Or paste CSV here', type: 'textarea', rows: 7, placeholder: 'name,price,category,unit\nAashirvaad Atta 5kg,230,Staples,pack\nAmul Milk 500ml,33,Dairy,pack' }} value=${csv} onChange=${setCsv} />
    <${Toggle} checked=${replace} onChange=${setReplace} label="Replace the whole catalogue" help="Deletes all current products first." />
    ${result && html`<${Alert} tone=${result.errors.length ? 'warn' : 'ok'}>Added ${result.created}, updated ${result.updated}.${result.errors.length ? html`<br />${result.errors.slice(0, 10).join(' · ')}` : ''}<//>`}
  <//>`;
}

export function Catalogue() {
  const [importing, setImporting] = useState(false);
  const [key, setKey] = useState(0);
  return html`<${Page} title="Products" subtitle="What customers can order on WhatsApp. Switch 'In stock' off and the item disappears from the bot instantly."
    actions=${html`<${Button} onClick=${() => setImporting(true)}>⬆ Import CSV<//><${Button} onClick=${() => download('/products/export.csv')}>⬇ Export<//>`}>
    <${ResourceManager} key=${key} path="products" singular="Product" defaults=${{ unit: 'pc', in_stock: 1, active: 1, category: 'General' }}
      empty="Add products one by one, or import them all from Excel with 'Import CSV'."
      columns=${[
        { label: 'Product', render: (p) => html`<strong>${p.name}</strong>${p.description && html`<div class="small muted">${p.description}</div>`}` },
        { label: 'Category', key: 'category' },
        { label: 'Price', render: (p) => html`<${Money} value=${p.price} /> <span class="muted small">/ ${p.unit}</span>` },
        { label: 'In stock', render: (p, reload) => html`<${QuickToggle} path="products" item=${p} field="in_stock" onDone=${reload} />` },
        { label: 'Visible', render: (p, reload) => html`<${QuickToggle} path="products" item=${p} field="active" onDone=${reload} />` },
      ]}
      fields=${[
        { key: 'name', label: 'Product name', required: true, help: 'Short names work best (WhatsApp shows ~24 characters).' },
        { key: 'price', label: 'Price', type: 'money', required: true },
        { key: 'category', label: 'Category', help: 'Customers first pick a category, then the item.' },
        { key: 'unit', label: 'Unit', placeholder: 'pc, kg, pack, plate…' },
        { key: 'description', label: 'Short description', wide: true },
        { key: 'image_url', label: 'Photo URL (optional)', help: 'Public https link to a photo. Shown when "show product photos" is on in Settings.', wide: true },
        { key: 'sku', label: 'SKU / code (optional)', help: 'Needed only if you also use the WhatsApp catalogue in Commerce Manager.' },
        { key: 'sort', label: 'Sort order', type: 'number', help: 'Lower numbers show first.' },
        { key: 'in_stock', label: 'In stock', type: 'toggle' },
        { key: 'active', label: 'Visible in the bot', type: 'toggle' },
      ]} />
    ${importing && html`<${ImportModal} onClose=${() => setImporting(false)} onDone=${() => setKey(key + 1)} />`}
  <//>`;
}
