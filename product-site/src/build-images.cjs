// Rebuilds product-site/og.png (share image) and img/dashboard.jpg (needs Playwright + a running demo server).
//   node product-site/src/build-images.cjs [dashboardUrl]   e.g. http://localhost:3000
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto('file://' + path.join(__dirname, 'og.html')); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(__dirname, '..', 'og.png') });
  const url = process.argv[2];
  if (url) {
    const d = await b.newPage({ viewport: { width: 1200, height: 760 } });
    await d.goto(url); await d.fill('#email', 'dental@demo.test'); await d.fill('#password', 'demo12345'); await d.click('button[type=submit]');
    await d.waitForSelector('.sidebar'); await d.waitForTimeout(1200);
    await d.screenshot({ path: path.join(__dirname, '..', 'img', 'dashboard.jpg'), type: 'jpeg', quality: 82 });
  }
  await b.close(); console.log('✓ images rebuilt');
})();
