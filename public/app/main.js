// Dashboard entry: login, app shell, navigation, live alerts, routing.
import { render } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { html, api, store, AppCtx, useInterval, beep, toast, act } from './lib.js';
import { Button, Loading, Wordmark } from './ui.js';
import { Overview } from './pages/overview.js';
import { Orders } from './pages/orders.js';
import { Appointments } from './pages/appointments.js';
import { Inbox } from './pages/inbox.js';
import { Customers } from './pages/customers.js';
import { Leads } from './pages/leads.js';
import { Catalogue } from './pages/catalogue.js';
import { Services } from './pages/services.js';
import { Faqs } from './pages/faqs.js';
import { Broadcasts } from './pages/broadcasts.js';
import { BotMessages } from './pages/botmessages.js';
import { Templates } from './pages/templates.js';
import { Settings } from './pages/settings.js';
import { Simulator } from './pages/simulator.js';
import { Wizard } from './pages/wizard.js';
import { Agency } from './pages/agency.js';
import { Help } from './pages/help.js';
import { AiAssistant } from './pages/ai.js';
import { QuickReplies } from './pages/quickreplies.js';
import { Integrations } from './pages/integrations.js';

const ROUTES = {
  overview: Overview, orders: Orders, appointments: Appointments, inbox: Inbox, customers: Customers, leads: Leads,
  catalogue: Catalogue, services: Services, faqs: Faqs, broadcasts: Broadcasts, messages: BotMessages, templates: Templates,
  settings: Settings, test: Simulator, setup: Wizard, agency: Agency, help: Help, ai: AiAssistant, menu: QuickReplies, integrations: Integrations,
};

function nav(biz, counts) {
  const has = (m) => biz?.modules?.includes(m);
  return [
    ['Daily work'],
    ['overview', '🏠', 'Home'],
    has('ordering') && ['orders', '🛒', 'Orders', counts.orders],
    has('booking') && ['appointments', '📅', 'Appointments'],
    ['inbox', '💬', 'Chats', counts.needsReply],
    ['customers', '👥', 'Customers'],
    has('enquiry') && ['leads', '📝', 'Enquiries', counts.leads],
    ['Set up your bot'],
    has('ordering') && ['catalogue', '📦', 'Products'],
    has('booking') && ['services', '🧑‍⚕️', 'Services & staff'],
    ['ai', '🤖', 'AI assistant'],
    ['menu', '🧩', 'Menu & quick replies'],
    ['faqs', '❓', 'FAQs'],
    ['messages', '✏️', 'Bot messages'],
    ['test', '📱', 'Test the bot'],
    ['Grow'],
    ['broadcasts', '📣', 'Broadcasts'],
    ['templates', '📄', 'Message templates'],
    ['integrations', '🔌', 'Integrations'],
    ['Admin'],
    ['settings', '⚙️', 'Settings'],
    ['setup', '🧭', 'Setup wizard'],
    ['help', '📘', 'Help'],
  ].filter(Boolean);
}

function Login({ onDone, about }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try { await api('/auth/login', { method: 'POST', body: { email, password } }); onDone(); } catch (err) { setError(err.message); }
  };
  return html`<div class="login"><form class="card" onSubmit=${submit}>
    <div class="login-head"><${Wordmark} about=${about} size="lg" /><p class="muted">WhatsApp automation dashboard – sign in to continue</p></div>
    ${error && html`<div class="alert alert-danger" role="alert">${error}</div>`}
    <div class="col">
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="username" required value=${email} onInput=${(e) => setEmail(e.target.value)} /></div>
      <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required value=${password} onInput=${(e) => setPassword(e.target.value)} /></div>
      <${Button} variant="primary" type="submit">Sign in<//>
    </div>
  </form></div>`;
}

const getRoute = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'overview');

function App() {
  const [me, setMe] = useState(undefined);
  const [biz, setBiz] = useState(null);
  const [route, setRoute] = useState(getRoute());
  const [navOpen, setNavOpen] = useState(false);
  const [counts, setCounts] = useState({});
  const [pulse, setPulse] = useState(null);
  const [about, setAbout] = useState(null);

  const loadMe = useCallback(async () => {
    try {
      const data = await api('/me');
      if (!store.bizId || !data.businesses.some((b) => String(b.id) === store.bizId)) store.bizId = data.businesses[0]?.id || '';
      setMe(data);
    } catch { setMe(null); }
  }, []);

  const loadBiz = useCallback(async () => {
    if (!store.bizId) { setBiz(null); return; }
    try {
      const d = await api('/business');
      setBiz({ ...d.business, meta: d });
    } catch (e) { toast(e.message, 'error'); setBiz(null); }
  }, []);

  useEffect(() => { loadMe(); api('/about').then((a) => { setAbout(a); document.title = `${a.brand.name} by ${a.brand.company}`; }).catch(() => {}); }, []);
  useEffect(() => { if (me) loadBiz(); }, [me]);
  useEffect(() => {
    const onHash = () => { setRoute(getRoute()); setNavOpen(false); window.scrollTo(0, 0); };
    const onLogout = () => setMe(null);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('wak:logout', onLogout);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('wak:logout', onLogout); };
  }, []);
  // First visit of an unconfigured business -> setup wizard
  useEffect(() => { if (biz && !biz.setup_done && route === 'overview' && me?.user.role !== 'staff') location.hash = '#/setup'; }, [biz?.id]);

  // Live alerts: new orders / bookings / chats needing reply
  useInterval(async () => {
    if (!biz) return;
    try {
      const p = await api('/pulse');
      if (pulse) {
        if (p.lastOrder > pulse.lastOrder) { beep(); toast('🛒 New order received!'); }
        if (p.lastAppointment > pulse.lastAppointment) { beep(); toast('📅 New appointment booked!'); }
        if (p.lastLead > pulse.lastLead) { beep(); toast('📝 New enquiry!'); }
        if (p.needsReply > pulse.needsReply) { beep(); toast('💬 A customer is waiting for a reply'); }
      }
      setPulse(p);
      setCounts({ needsReply: p.needsReply });
    } catch { /* offline - try next tick */ }
  }, 8000);

  if (me === undefined) return html`<div class="boot">Loading…</div>`;
  if (me === null) return html`<${Login} onDone=${loadMe} about=${about} />`;

  const isAdmin = me.user.role === 'superadmin';
  const switchBiz = (id) => { store.bizId = id; setPulse(null); setBiz(null); loadBiz(); location.hash = '#/overview'; };
  const logout = async () => { await act(() => api('/auth/logout', { method: 'POST' })); setMe(null); };
  const ctx = { me, biz, about, reloadBiz: loadBiz, reloadMe: loadMe, switchBiz };

  let content;
  if (route === 'agency' && isAdmin) content = html`<${Agency} />`;
  else if (!store.bizId) content = isAdmin ? html`<${Agency} />` : html`<div class="page"><div class="alert alert-warn">Your account is not linked to a business yet. Ask your administrator.</div></div>`;
  else if (!biz) content = html`<${Loading} />`;
  else { const Page = ROUTES[route] || ROUTES.overview; content = html`<${Page} key=${`${route}-${biz.id}`} />`; }

  return html`<${AppCtx.Provider} value=${ctx}>
    <div class="shell ${navOpen ? 'nav-open' : ''}">
      <aside class="sidebar" aria-label="Main navigation">
        <div class="brand"><div class="brand-biz">${biz?.name || (isAdmin ? 'Agency admin' : 'Dashboard')}</div><${Wordmark} about=${about} size="sm" /></div>
        ${isAdmin && html`<div class="biz-switch">
          <select aria-label="Choose business" value=${store.bizId} onChange=${(e) => switchBiz(e.target.value)}>
            ${me.businesses.length === 0 && html`<option value="">No businesses yet</option>`}
            ${me.businesses.map((b) => html`<option value=${b.id}>${b.name}${b.active ? '' : ' (paused)'}</option>`)}
          </select></div>`}
        <nav class="nav">
          ${isAdmin && html`<a href="#/agency" class=${route === 'agency' ? 'active' : ''}>🏢 All businesses</a>`}
          ${biz && nav(biz, counts).map((n) => (n.length === 1 ? html`<div class="nav-section">${n[0]}</div>`
            : html`<a href="#/${n[0]}" class=${route === n[0] ? 'active' : ''} aria-current=${route === n[0] ? 'page' : undefined}>
              <span aria-hidden="true">${n[1]}</span>${n[2]}${n[3] ? html`<span class="count">${n[3]}</span>` : ''}</a>`))}
        </nav>
        <div class="sidebar-foot">
          <div class="muted small">${me.user.email}</div>
          <button class="link" onClick=${logout}>Sign out</button>
          <div class="muted small powered">${about ? `${about.brand.name} v${about.version} · by ${about.brand.company}` : ''}</div>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <button class="icon-btn" aria-label="Open menu" onClick=${() => setNavOpen(!navOpen)}>☰</button>
          <strong>${biz?.name || about?.brand?.name || 'Replix'}</strong>
        </div>
        ${content}
      </main>
    </div>
  <//>`;
}

render(html`<${App} />`, document.getElementById('app'));
