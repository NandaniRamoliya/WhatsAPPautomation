// Interactive first-time setup: writes .env with safe defaults and creates the admin login.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, d = '') => (await rl.question(`${q}${d ? ` [${d}]` : ''}: `)).trim() || d;

/** Ask until the answer passes the check; typed commands (e.g. "npm run demo") are rejected. */
async function askValid(q, d, check, hint) {
  for (;;) {
    const v = await ask(q, d);
    if (/^(npm|node|npx|git|cd)\b/i.test(v)) { console.log('  ↳ That looks like a command. Answer the question, or press Enter for the default.'); continue; }
    if (!check || check(v)) return v;
    console.log(`  ↳ ${hint}`);
  }
}

console.log('\n=== Replix by Indrix – setup ===');
console.log('Answer each question, or just press Enter to accept the default shown in [brackets].');
console.log('Run other commands (like "npm run demo") AFTER this finishes.\n');
if (fs.existsSync(envPath) && (await ask('.env already exists. Overwrite? (y/N)', 'N')).toLowerCase() !== 'y') {
  console.log('Keeping existing .env.');
} else {
  const port = await askValid('Port', '3000', (v) => /^\d{2,5}$/.test(v) && Number(v) < 65536, 'Port must be a number, e.g. 3000.');
  const publicUrl = (await askValid('Public HTTPS URL (ngrok or your domain)', `http://localhost:${port}`, (v) => /^https?:\/\/[^\s]+$/.test(v), 'Must start with http:// or https://, e.g. https://abc123.ngrok-free.app')).replace(/\/+$/, '');
  const adminEmail = await askValid('Admin email', 'admin@example.com', (v) => /^\S+@\S+\.\S+$/.test(v), 'Enter a valid email address.');
  let adminPassword = await askValid('Admin password (min 8 chars, Enter = generate one)', '', (v) => v === '' || v.length >= 8, 'Password must be at least 8 characters (or press Enter to generate one).');
  if (!adminPassword) adminPassword = crypto.randomBytes(9).toString('base64url');
  const appSecret = await askValid('Meta App Secret (optional, Enter to skip)', '', (v) => v === '' || /^[a-f0-9]{16,}$/i.test(v), 'App secret is a long hex string from Meta App > Settings > Basic (or press Enter to skip).');
  const anthropic = await askValid('Anthropic API key for AI features (optional, Enter to skip)', '');
  const tpl = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const set = (s, k, v) => s.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
  let env = tpl;
  env = set(env, 'PORT', port);
  env = set(env, 'PUBLIC_URL', publicUrl);
  env = set(env, 'NODE_ENV', publicUrl.startsWith('https') && !publicUrl.includes('ngrok') ? 'production' : 'development');
  env = set(env, 'SESSION_SECRET', crypto.randomBytes(32).toString('hex'));
  env = set(env, 'ENCRYPTION_KEY', crypto.randomBytes(32).toString('hex'));
  env = set(env, 'WA_VERIFY_TOKEN', crypto.randomBytes(12).toString('hex'));
  env = set(env, 'ADMIN_EMAIL', adminEmail);
  env = set(env, 'ADMIN_PASSWORD', adminPassword);
  env = set(env, 'META_APP_SECRET', appSecret);
  env = set(env, 'ANTHROPIC_API_KEY', anthropic);
  fs.writeFileSync(envPath, env, { mode: 0o600 });
  console.log(`\n.env written. Admin login: ${adminEmail} / ${adminPassword}`);
  console.log('⚠️  Back up ENCRYPTION_KEY from .env – without it, saved WhatsApp tokens cannot be read.');
}
rl.close();
console.log('\nNext:  npm start   (optional demo data: npm run demo)\n');
