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

console.log('\n=== WhatsApp Automation Kit – setup ===\n');
if (fs.existsSync(envPath) && (await ask('.env already exists. Overwrite? (y/N)', 'N')).toLowerCase() !== 'y') {
  console.log('Keeping existing .env.');
} else {
  const port = await ask('Port', '3000');
  const publicUrl = await ask('Public HTTPS URL (ngrok or your domain)', `http://localhost:${port}`);
  const adminEmail = await ask('Admin email', 'admin@example.com');
  let adminPassword = await ask('Admin password (min 8 chars, empty = generate)', '');
  if (adminPassword.length < 8) adminPassword = crypto.randomBytes(9).toString('base64url');
  const appSecret = await ask('Meta App Secret (optional, can add later)', '');
  const anthropic = await ask('Anthropic API key for AI features (optional)', '');
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
