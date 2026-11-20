// AI assistant: settings, knowledge base (RAG) and a live "try a question" box.
import { useState, useEffect } from 'preact/hooks';
import { html, api, act, useApi, useApp, fmtDateTime } from '../lib.js';
import { Page, Card, Button, AsyncButton, Modal, Field, FormFields, Toggle, Alert, Badge, Loading, ErrorBox, Empty, Tabs } from '../ui.js';

const KIND = { text: '📝 Text', file: '📄 File', url: '🌐 Website' };

function AddSource({ onClose, onDone }) {
  const [tab, setTab] = useState('text');
  const [f, setF] = useState({ title: '', content: '', url: '' });
  const [file, setFile] = useState(null);
  const save = async () => {
    let r;
    if (tab === 'text') r = await act(() => api('/knowledge', { method: 'POST', body: { title: f.title, content: f.content } }), 'Added to knowledge base');
    if (tab === 'url') r = await act(() => api('/knowledge/url', { method: 'POST', body: { url: f.url, title: f.title } }), 'Page imported');
    if (tab === 'file') {
      if (!file) return;
      const base64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(file); });
      r = await act(() => api('/knowledge/file', { method: 'POST', body: { filename: file.name, mime: file.type, base64, title: f.title } }), 'File imported');
    }
    if (r) { onDone(); onClose(); }
  };
  return html`<${Modal} title="Add knowledge" onClose=${onClose} wide footer=${html`<${Button} onClick=${onClose}>Cancel<//><${AsyncButton} variant="primary" onClick=${save}>Add<//>`}>
    <${Tabs} active=${tab} onChange=${setTab} tabs=${[{ key: 'text', label: '📝 Paste text' }, { key: 'file', label: '📄 Upload file' }, { key: 'url', label: '🌐 Import website page' }]} />
    <${Field} f=${{ key: 'title', label: 'Title (optional)', placeholder: tab === 'file' ? 'Uses the file name' : 'e.g. Price list, Return policy' }} value=${f.title} onChange=${(v) => setF({ ...f, title: v })} />
    <div style="margin-top:12px">
      ${tab === 'text' && html`<${Field} f=${{ key: 'content', label: 'Text', type: 'textarea', rows: 12, placeholder: 'Paste anything customers ask about: prices, menu, services, policies, timings, delivery areas, offers, doctor profiles…' }} value=${f.content} onChange=${(v) => setF({ ...f, content: v })} />`}
      ${tab === 'file' && html`<div class="field"><label for="kbfile">File</label><input id="kbfile" type="file" accept=".pdf,.txt,.csv,.md,.html,.htm" onChange=${(e) => setFile(e.target.files[0])} />
        <small class="help">PDF, TXT, CSV, MD or HTML, up to 10 MB. Word files: "Save as PDF" first. Scanned PDFs (photos) have no text – paste the text instead.</small></div>`}
      ${tab === 'url' && html`<${Field} f=${{ key: 'url', label: 'Website page', type: 'url', placeholder: 'https://yourshop.com/menu', help: 'Imports the text of one page. Add each important page (menu, pricing, FAQ, about).' }} value=${f.url} onChange=${(v) => setF({ ...f, url: v })} />`}
    </div>
  <//>`;
}

function EditSource({ id, onClose, onDone }) {
  const { data } = useApi(`/knowledge/${id}`);
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF({ title: data.source.title, content: data.source.content }); }, [data]);
  const save = async () => { if (await act(() => api(`/knowledge/${id}`, { method: 'PUT', body: f }), 'Saved')) { onDone(); onClose(); } };
  return html`<${Modal} title="Edit knowledge" onClose=${onClose} wide footer=${html`<${Button} onClick=${onClose}>Cancel<//><${AsyncButton} variant="primary" onClick=${save}>Save<//>`}>
    ${!f ? html`<${Loading} />` : html`
      <${Field} f=${{ key: 'title', label: 'Title' }} value=${f.title} onChange=${(v) => setF({ ...f, title: v })} />
      <div style="margin-top:12px"><${Field} f=${{ key: 'content', label: 'Text (correct mistakes or remove what is outdated)', type: 'textarea', rows: 16 }} value=${f.content} onChange=${(v) => setF({ ...f, content: v })} /></div>`}
  <//>`;
}

function TryBox() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const ask = async () => { setRes(null); const r = await act(() => api('/ai/try', { method: 'POST', body: { question: q } })); if (r) setRes(r.result); };
  return html`<${Card} title="🧪 Try a question">
    <div class="row gap"><input aria-label="Question" placeholder="e.g. Do you deliver to Sector 50? / kitne baje khulte ho? / રૂટ કેનાલનો ખર્ચ કેટલો?" value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && q && ask()} />
      <${AsyncButton} variant="primary" disabled=${!q} onClick=${ask}>Ask<//></div>
    ${res && html`<div style="margin-top:12px">
      ${res.answerable ? html`<div class="bubble out" style="max-width:100%;white-space:pre-wrap">${res.answer}</div>` : html`<${Alert} tone="warn">The AI could not answer this from your information, so the customer would be offered "Talk to us". Add the answer to your knowledge base or FAQs.<//>`}
      <p class="small muted" style="margin-top:8px">Understood as: <b>${res.intent}</b>${res.items?.length ? ` · ${res.items.length} item(s) for the cart` : ''}${res.suggest !== 'none' ? ` · suggests: ${res.suggest}` : ''} · knowledge mode: ${res.mode}</p>
    </div>`}
  <//>`;
}

export function AiAssistant() {
  const { biz, reloadBiz, me } = useApp();
  const { data, error, loading, reload } = useApi('/knowledge');
  const [modal, setModal] = useState(null);
  const [v, setV] = useState({ settings: structuredClone(biz.settings) });
  const canEdit = me.user.role !== 'staff';
  const saveSettings = async () => { if (await act(() => api('/business', { method: 'PUT', body: { settings: { ai: v.settings.ai } } }), 'AI settings saved')) reloadBiz(); };
  if (error) return html`<${Page} title="AI assistant"><${ErrorBox} error=${error} retry=${reload} /><//>`;
  if (loading && !data) return html`<${Page} title="AI assistant"><${Loading} /><//>`;
  const st = data.stats;
  const full = st.active_chars <= data.limits.fullContextChars;
  const ai = v.settings.ai;
  const setAi = (patch) => setV({ settings: { ...v.settings, ai: { ...ai, ...patch } } });

  return html`<${Page} title="AI assistant" subtitle="Your bot answers any question from YOUR information – in the customer's own language – and understands typed orders and booking requests.">
    ${!data.aiAvailable && html`<${Alert} tone="warn">AI is not available on this server yet: the developer must add <code>ANTHROPIC_API_KEY</code> to the .env file. You can still prepare your knowledge base now.<//>`}
    <div class="grid grid-2">
      <${Card} title="Settings">
        <div class="col">
          <${Toggle} checked=${ai.enabled} label="Turn on the AI assistant" help="When off, the bot uses buttons, FAQs and keyword replies only." onChange=${(x) => setAi({ enabled: x })} />
          <${Toggle} checked=${ai.answer_questions} label="Answer free-form questions" help="From your business details, hours, catalogue, services, FAQs and knowledge base." onChange=${(x) => setAi({ answer_questions: x })} />
          <${Toggle} checked=${ai.order_parsing} label="Understand typed orders" help='"2 kilo aata aur 1 maggi" → added to the cart for the customer to confirm.' onChange=${(x) => setAi({ order_parsing: x })} />
          <${Toggle} checked=${ai.use_knowledge} label="Use the knowledge base below" onChange=${(x) => setAi({ use_knowledge: x })} />
          <${Toggle} checked=${ai.remember_chat} label="Remember the conversation" help="Uses the last few messages, so follow-up questions make sense." onChange=${(x) => setAi({ remember_chat: x })} />
          <${Toggle} checked=${ai.handoff_when_unsure} label='Offer "Talk to us" when it is not sure' onChange=${(x) => setAi({ handoff_when_unsure: x })} />
          <${FormFields} value=${v} onChange=${setV} fields=${[
            { key: 'settings.ai.assistant_name', label: 'Assistant name (optional)', placeholder: `Riya from ${biz.name}` },
            { key: 'settings.ai.tone', label: 'Tone', type: 'select', options: [{ value: 'friendly', label: 'Friendly' }, { value: 'formal', label: 'Formal / professional' }, { value: 'short', label: 'Very short' }] },
            { key: 'settings.ai.instructions', label: 'Extra instructions for the AI', type: 'textarea', rows: 4, wide: true, placeholder: 'e.g. Always mention free delivery above ₹300. Never discuss competitor prices. Recommend the family pack for 4+ people.' },
          ]} />
          ${canEdit && html`<div><${AsyncButton} variant="primary" onClick=${saveSettings}>💾 Save AI settings<//></div>`}
        </div>
      <//>
      <div>
        <${TryBox} />
        <${Card} title="How it stays safe">
          <ul class="small">
            <li>It answers <b>only</b> from your information – never invents prices, offers or policies.</li>
            <li>Orders and bookings still go through the normal buttons with confirmation – the AI cannot place them alone.</li>
            <li>Products must exist in your catalogue; prices always come from your catalogue.</li>
            <li>Medical/legal advice, complaints and refunds are handed to your team.</li>
            <li>It replies in the customer's language: English, Hindi, Hinglish, Gujarati and more.</li>
          </ul>
        <//>
      </div>
    </div>
    <${Card} title=${html`📚 Knowledge base <span class="muted small">${st.sources} source(s) · ${st.active_chars.toLocaleString()} characters active</span>`}
      actions=${html`<${Button} variant="primary" onClick=${() => setModal({ type: 'add' })}>+ Add knowledge<//>`}>
      <p class="muted small">${full ? '✅ Small enough that the AI reads all of it for every question (best quality).' : '🔎 Large knowledge base: the AI receives the most relevant passages for each question.'}
        Add price lists, menus, policies, doctor profiles, service details, delivery areas, offers, website pages…</p>
      ${data.sources.length === 0 ? html`<${Empty} icon="📚" title="No knowledge yet">Add your price list, menu or policies – as text, a PDF, or a website page.<//>`
        : html`<div class="table-wrap"><table class="table"><thead><tr><th>Source</th><th>Type</th><th>Size</th><th>Used</th><th>Updated</th><th class="right"></th></tr></thead><tbody>
        ${data.sources.map((s) => html`<tr>
          <td data-label="Source"><strong>${s.title}</strong><div class="small muted">${s.preview.slice(0, 120)}…</div></td>
          <td data-label="Type">${KIND[s.kind] || s.kind}</td>
          <td data-label="Size">${s.chars.toLocaleString()} chars · ${s.chunks} parts</td>
          <td data-label="Used"><${Toggle} checked=${s.active} onChange=${(x) => act(() => api(`/knowledge/${s.id}`, { method: 'PUT', body: { active: x } })).then(reload)} /></td>
          <td data-label="Updated" class="nowrap">${fmtDateTime(s.updated_at, biz.timezone)}</td>
          <td class="right nowrap"><${Button} small onClick=${() => setModal({ type: 'edit', id: s.id })}>Edit<//> <${Button} small variant="ghost danger" onClick=${() => confirm('Delete this knowledge source?') && act(() => api(`/knowledge/${s.id}`, { method: 'DELETE' }), 'Deleted').then(reload)}>Delete<//></td>
        </tr>`)}</tbody></table></div>`}
    <//>
    ${modal?.type === 'add' && html`<${AddSource} onClose=${() => setModal(null)} onDone=${reload} />`}
    ${modal?.type === 'edit' && html`<${EditSource} id=${modal.id} onClose=${() => setModal(null)} onDone=${reload} />`}
  <//>`;
}
