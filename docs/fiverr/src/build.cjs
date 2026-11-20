// Renders docs/fiverr/gig-*.png from gallery.html (needs Playwright):  node docs/fiverr/src/build.cjs
const path = require('path');
const { execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright'))); }
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1300, height: 2400 }, deviceScaleFactor: 1.5 });
  await p.goto('file://' + path.join(__dirname, 'gallery.html'));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  const names = { g1: 'gig-1-hero', g2: 'gig-2-dashboard', g3: 'gig-3-industries' };
  for (const [id, name] of Object.entries(names)) {
    await p.locator(`#${id}`).screenshot({ path: path.join(__dirname, '..', `${name}.png`) });
    console.log('wrote', name);
  }
  await b.close();
})();
