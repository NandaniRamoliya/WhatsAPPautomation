// Publish the Replix product website (product-site/) to a FREE Cloudflare Pages project –
// the same way the PinPage site is published.
//
//   npm run site:build     -> builds product-site/dist/ (open dist/index.html to preview)
//   npm run site:publish   -> builds + uploads to https://<SITE_PROJECT>.pages.dev/
//
// .env needs (only for publish):
//   CLOUDFLARE_API_TOKEN   token with permission  Account › Cloudflare Pages › Edit
//   CLOUDFLARE_ACCOUNT_ID  Cloudflare dashboard › Workers & Pages › Account ID (right side)
// Optional: SITE_PROJECT (default "replix"), PRODUCT_SITE_URL (your own domain),
//   SUPPORT_WHATSAPP, SUPPORT_EMAIL, BRAND_COMPANY, BRAND_COMPANY_URL, SITE_GOOGLE_VERIFY
//
// Note: this publishes the marketing website only. The bot + dashboard is a Node.js server
// (webhooks, database, reminders) – run it on a VPS / Render / your PC + Cloudflare Tunnel.
// See docs/DEPLOYMENT.md.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../src/config.js';

const SRC = path.join(config.root, 'product-site');
const DIST = path.join(SRC, 'dist');
const env = (k, d = '') => (process.env[k] ?? '').toString().trim() || d;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const c = {
  ...config.brand,
  token: env('CLOUDFLARE_API_TOKEN'),
  account: env('CLOUDFLARE_ACCOUNT_ID'),
  project: env('SITE_PROJECT', 'replix'),
  siteUrl: env('PRODUCT_SITE_URL'),
  googleVerify: env('SITE_GOOGLE_VERIFY'),
};

// ---------------------------------------------------------------- build
function jsonLd(tpl, siteUrl) {
  const strip = (x) => x.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const faq = [...tpl.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)]
    .map((m) => ({ '@type': 'Question', name: strip(m[1]), acceptedAnswer: { '@type': 'Answer', text: strip(m[2]) } }));
  const org = { '@type': 'Organization', '@id': `${c.companyUrl}#org`, name: c.company, url: c.companyUrl };
  const graph = [
    org,
    { '@type': 'WebSite', '@id': `${siteUrl}#website`, url: siteUrl, name: c.name, alternateName: [`${c.name} by ${c.company}`], publisher: { '@id': org['@id'] }, inLanguage: 'en-IN' },
    { '@type': 'SoftwareApplication', name: c.name, applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: siteUrl, image: `${siteUrl}og.png`,
      description: 'WhatsApp automation for businesses: orders and payments, appointment booking with reminders, AI answers from your documents, lead capture and a no-code dashboard, on the official WhatsApp Business API.',
      publisher: { '@id': org['@id'] } },
    faq.length ? { '@type': 'FAQPage', mainEntity: faq } : null,
  ].filter(Boolean);
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`;
}

export async function build(siteUrl) {
  siteUrl = (siteUrl || c.siteUrl || `https://${c.project}.pages.dev/`).replace(/\/*$/, '/');
  const tpl = await fs.readFile(path.join(SRC, 'index.html'), 'utf8');
  const wa = c.supportWhatsapp
    ? `https://wa.me/${c.supportWhatsapp}?text=${encodeURIComponent(`Hi ${c.company}! I'd like a demo of ${c.name} (WhatsApp automation) for my business.`)}`
    : (c.supportEmail ? `mailto:${c.supportEmail}?subject=${encodeURIComponent(`${c.name} demo`)}` : c.companyUrl);
  const page = tpl
    .replaceAll('{{JSON_LD}}', jsonLd(tpl, siteUrl))
    .replaceAll('{{SITE_URL}}', esc(siteUrl))
    .replaceAll('{{GOOGLE_VERIFY_META}}', c.googleVerify ? `<meta name="google-site-verification" content="${esc(c.googleVerify.replace(/^.*content=["']?|["'].*$/g, ''))}">` : '')
    .replaceAll('{{WHATSAPP_URL}}', esc(wa))
    .replaceAll('{{EMAIL_BUTTON}}', c.supportEmail ? `<a class="btn btn-ghost" href="mailto:${esc(c.supportEmail)}">Email us</a>` : '')
    .replaceAll('{{COMPANY_URL}}', esc(c.companyUrl))
    .replaceAll('{{COMPANY}}', esc(c.company))
    .replaceAll('{{YEAR}}', String(new Date().getFullYear()));
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(path.join(DIST, 'img'), { recursive: true });
  await fs.writeFile(path.join(DIST, 'index.html'), page);
  await fs.writeFile(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`);
  await fs.writeFile(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${siteUrl}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`);
  await fs.writeFile(path.join(DIST, '404.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · ${esc(c.name)}</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;text-align:center"><div><h1>Page not found</h1><p><a href="/">Go to the ${esc(c.name)} home page</a></p></div>`);
  await fs.copyFile(path.join(SRC, 'og.png'), path.join(DIST, 'og.png')).catch(() => {});
  for (const f of await fs.readdir(path.join(SRC, 'img'))) await fs.copyFile(path.join(SRC, 'img', f), path.join(DIST, 'img', f));
  if (/\{\{[A-Z_]+\}\}/.test(page)) throw new Error(`Unfilled placeholder in product-site/index.html: ${page.match(/\{\{[A-Z_]+\}\}/)[0]}`);
  return { dir: DIST, siteUrl };
}

// ---------------------------------------------------------------- Cloudflare
async function cfApi(p, init = {}) {
  let res;
  try {
    res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.account}${p}`, {
      ...init, signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${c.token}`, 'content-type': 'application/json', ...(init.headers || {}) },
    });
  } catch (e) { throw new Error(`Couldn't reach Cloudflare (${e.cause?.code || e.message}). Check your internet connection.`); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = json?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    const err = new Error(res.status === 401 || res.status === 403 || /auth/i.test(msg)
      ? `Cloudflare rejected the token (${msg}). Check CLOUDFLARE_API_TOKEN has "Account › Cloudflare Pages › Edit" and CLOUDFLARE_ACCOUNT_ID is right.`
      : `Cloudflare: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json.result;
}

/** Make sure the Pages project exists; returns its *.pages.dev host (Cloudflare adds a suffix if the name is taken). */
async function ensureProject() {
  try { return (await cfApi(`/pages/projects/${c.project}`)).subdomain; } catch (e) { if (e.status !== 404) throw e; }
  console.log(`Creating Cloudflare Pages project "${c.project}"…`);
  return (await cfApi('/pages/projects', { method: 'POST', body: JSON.stringify({ name: c.project, production_branch: 'main' }) })).subdomain;
}

function wrangler(args) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['--yes', 'wrangler@4', ...args], {
      shell: process.platform === 'win32',
      stdio: 'inherit',
      env: { ...process.env, CLOUDFLARE_API_TOKEN: c.token, CLOUDFLARE_ACCOUNT_ID: c.account, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
    });
    child.on('close', resolve);
    child.on('error', (e) => { console.error(e.message); resolve(1); });
  });
}

async function publish() {
  if (!c.token || !c.account) {
    console.error('\n✗ Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID in .env\n'
      + '  1. Cloudflare dashboard › My Profile › API Tokens › Create token › Custom token\n'
      + '     Permission: Account › Cloudflare Pages › Edit  → copy the token\n'
      + '  2. Workers & Pages › copy "Account ID"\n'
      + '  3. Put both in .env, then run: npm run site:publish\n');
    process.exit(1);
  }
  const host = await ensureProject();
  const liveUrl = `https://${host}/`;
  const { dir, siteUrl } = await build(c.siteUrl || liveUrl);
  console.log(`Uploading ${path.relative(config.root, dir)} to Cloudflare Pages project "${c.project}"…`);
  const code = await wrangler(['pages', 'deploy', dir, '--project-name', c.project, '--branch', 'main', '--commit-dirty=true', '--commit-message', `Replix site ${new Date().toISOString()}`]);
  if (code !== 0) { console.error('\n✗ Upload failed (see the message above).'); process.exit(1); }
  console.log(`\n✓ ${c.name} website is live: ${liveUrl}${siteUrl !== liveUrl ? `  (canonical: ${siteUrl})` : ''}`);
  if (liveUrl !== `https://${c.project}.pages.dev/`) console.log(`ℹ Cloudflare gave the address ${liveUrl} – use it in PRODUCT_SITE_URL and on the Indrix / portfolio sites.`);
  if (!c.supportWhatsapp) console.log('ℹ Tip: set SUPPORT_WHATSAPP in .env so the "Get a demo" buttons open WhatsApp.');
}

const cmd = process.argv[2] || 'build';
if (cmd === 'publish') await publish().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
else {
  const { dir, siteUrl } = await build();
  console.log(`✓ Built ${path.relative(config.root, dir)} for ${siteUrl}\n  Preview: open product-site/dist/index.html in a browser.\n  Publish: npm run site:publish`);
}
