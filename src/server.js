// Application entry point.
import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import { log } from './lib/logger.js';
import { migrate } from './db/index.js';
import { HttpError } from './lib/util.js';
import { ensureSuperAdmin } from './services/setup.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import webhook from './routes/webhook.js';
import publicRoutes from './routes/public.js';
import api from './routes/api.js';

migrate();

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind nginx / Render / Railway

// Keep the raw body: needed to verify Meta + Razorpay signatures byte-for-byte.
app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  next();
});

app.use(webhook);
app.use(publicRoutes);
app.use('/api', api);

// Dashboard (static SPA, no build step) + vendored front-end libraries
const nm = (p) => path.join(config.root, 'node_modules', p);
app.get('/vendor/preact.mjs', (_q, s) => s.sendFile(nm('preact/dist/preact.mjs')));
app.get('/vendor/hooks.mjs', (_q, s) => s.sendFile(nm('preact/hooks/dist/hooks.mjs')));
app.get('/vendor/htm.mjs', (_q, s) => s.sendFile(nm('htm/dist/htm.module.js')));
app.use(express.static(path.join(config.root, 'public'), { index: 'index.html', maxAge: config.isProd ? '1h' : 0 }));
app.get(/^\/(?!api\/|webhook|pay\/|q\/).*/, (_req, res) => res.sendFile(path.join(config.root, 'public', 'index.html')));

// Errors -> JSON with a friendly message
app.use((err, req, res, _next) => {
  const status = err instanceof HttpError ? err.status : err.status || err.statusCode || 500;
  if (status >= 500) log.error('request failed', { path: req.path, err: err.stack });
  res.status(status).json({ ok: false, error: status >= 500 && config.isProd ? 'Something went wrong' : err.message });
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(config.root, 'src/server.js');
if (isMain) {
  const created = ensureSuperAdmin();
  const server = app.listen(config.port, () => {
    log.info(`WhatsApp Automation Kit running on port ${config.port}`, { publicUrl: config.publicUrl, env: config.env });
    console.log(`\n  Dashboard:   ${config.publicUrl}\n  Webhook URL: ${config.publicUrl}/webhook\n  Verify token: ${config.verifyToken}\n`);
    if (created) {
      console.log(`  First login created -> email: ${created.email}  password: ${created.password}`);
      if (created.generated) console.log('  (random password - change it after logging in, or set ADMIN_PASSWORD in .env)\n');
    }
  });
  startScheduler();
  const shutdown = (sig) => {
    log.info(`received ${sig}, shutting down`);
    stopScheduler();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
