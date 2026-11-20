// Builds docs/Developer-Guide.pdf and docs/User-Guide.pdf from the HTML sources in this folder.
// Needs Playwright + Chromium (dev only):  npx playwright install chromium  then  node docs/guides/build-pdf.cjs
// Also needs Python 3 with pypdf (pip install pypdf) and pdftotext (poppler) for page numbers + bookmarks.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright'))); }

const DIR = __dirname;
const OUT = path.join(DIR, '..');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'guides-'));
const MARGIN = { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' };
const GUIDES = [
  { src: 'developer-guide.html', out: 'Developer-Guide.pdf', title: 'Developer Guide – Replix by Indrix' },
  { src: 'user-guide.html', out: 'User-Guide.pdf', title: 'User Guide – Replix by Indrix' },
];

const footer = (title) => `<div style="font-family:Inter,sans-serif;font-size:7.5px;color:#7a877f;width:100%;padding:0 16mm;display:flex;justify-content:space-between">
  <span>${title}</span><span>Page <span class="pageNumber"></span></span></div>`;

async function build(browser, g) {
  const page = await browser.newPage();
  await page.goto('file://' + path.join(DIR, g.src));
  await page.evaluate(() => document.fonts.ready);
  // Build the table of contents from part titles + h2 headings, with hidden page markers.
  const heads = await page.evaluate(() => {
    const list = document.getElementById('toc');
    const out = [];
    let n = 0;
    document.querySelectorAll('.part-title h1, main h2').forEach((h) => {
      const id = h.id || `h${++n}`;
      h.id = id;
      const part = h.closest('.part-title');
      const label = part ? `${part.querySelector('.num')?.textContent || ''} · ${h.textContent}` : h.textContent;
      const mark = document.createElement('span');
      mark.className = 'pdf-mark';
      mark.textContent = `@@${id}@@`;
      mark.style.cssText = 'position:absolute;font-size:1px;color:transparent;';
      h.prepend(mark);
      const li = document.createElement('li');
      li.className = part ? 'part' : 'sec';
      li.innerHTML = `<a href="#${id}">${label.replace(/@@\w+@@/, '')}</a><span class="dots"></span><span class="pg" data-for="${id}">00</span>`;
      list.appendChild(li);
      out.push({ id, label: label.replace(/@@\w+@@/, ''), level: part ? 0 : 1 });
    });
    return out;
  });
  await page.addStyleTag({ content: '.cover{display:none!important}' });
  const opts = { format: 'A4', margin: MARGIN, printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer(g.title) };
  // Pass 1: find the page of every heading via the hidden markers
  const pass1 = path.join(TMP, 'pass1.pdf');
  await page.pdf({ ...opts, path: pass1 });
  const text = execFileSync('pdftotext', ['-layout', pass1, '-']).toString().split('\f');
  const pages = {};
  text.forEach((t, i) => { for (const m of t.matchAll(/@@(\w+)@@/g)) if (!pages[m[1]]) pages[m[1]] = i + 1; });
  const filled = await page.evaluate((pg) => {
    // Part titles share a page with their first section: fall back to the next entry's page
    const spans = [...document.querySelectorAll('.toc .pg')];
    spans.forEach((s, i) => {
      let p = pg[s.dataset.for];
      for (let j = i + 1; !p && j < spans.length; j++) p = pg[spans[j].dataset.for];
      pg[s.dataset.for] = p;
      s.textContent = p || '';
    });
    document.querySelectorAll('.pdf-mark').forEach((m) => m.remove());
    return pg;
  }, pages);
  const body = path.join(TMP, 'body.pdf');
  await page.pdf({ ...opts, path: body });
  // Cover (no footer)
  await page.addStyleTag({ content: '.cover{display:flex!important} main,.toc{display:none!important}' });
  const cover = path.join(TMP, 'cover.pdf');
  await page.pdf({ format: 'A4', margin: MARGIN, printBackground: true, path: cover });
  await page.close();
  // Merge + bookmarks + metadata
  const outline = heads.map((h) => ({ ...h, page: filled[h.id] }));
  const py = `
import json, sys
from pypdf import PdfReader, PdfWriter
cover, body, out, title, outline = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], json.loads(sys.argv[5])
w = PdfWriter()
for p in PdfReader(cover).pages[:1]: w.add_page(p)
for p in PdfReader(body).pages: w.add_page(p)
parent = None
for h in outline:
    if not h.get('page'): continue
    idx = h['page']  # +1 cover -1 zero-based
    if h['level'] == 0: parent = w.add_outline_item(h['label'], idx)
    else: w.add_outline_item(h['label'], idx, parent=parent)
w.add_metadata({'/Title': title, '/Author': 'Indrix', '/Subject': title})
w.page_mode = '/UseOutlines'
with open(out, 'wb') as f: w.write(f)
print(out, len(w.pages), 'pages')
`;
  console.log(execFileSync('python3', ['-c', py, cover, body, path.join(OUT, g.out), g.title, JSON.stringify(outline)]).toString().trim());
}

(async () => {
  const browser = await chromium.launch();
  const only = process.argv[2];
  for (const g of GUIDES) if (!only || g.src.startsWith(only)) await build(browser, g);
  await browser.close();
})();
