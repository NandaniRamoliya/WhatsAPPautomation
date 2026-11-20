// Central configuration. Reads .env (if present) and auto-generates secrets
// so a fresh install "just works" without manual crypto setup.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.WAK_SKIP_ENV_FILE) {
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
}

const env = (k, d = '') => (process.env[k] ?? '').toString().trim() || d;

const dataDir = path.resolve(root, env('DATA_DIR', './data'));
fs.mkdirSync(dataDir, { recursive: true });

// Persisted auto-generated secrets
const secretsFile = path.join(dataDir, 'secrets.json');
let stored = {};
try { stored = JSON.parse(fs.readFileSync(secretsFile, 'utf8')); } catch { /* first run */ }
function secret(name, bytes = 32) {
  const fromEnv = env(name);
  if (fromEnv) return fromEnv;
  if (!stored[name]) {
    stored[name] = crypto.randomBytes(bytes).toString('hex');
    try { fs.writeFileSync(secretsFile, JSON.stringify(stored, null, 2), { mode: 0o600 }); } catch { /* read-only fs */ }
  }
  return stored[name];
}

let version = '1.0.0';
try { version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch { /* keep default */ }

export const config = {
  root,
  version,
  env: env('NODE_ENV', 'development'),
  isProd: env('NODE_ENV') === 'production',
  port: Number(env('PORT', '3000')),
  publicUrl: env('PUBLIC_URL', `http://localhost:${env('PORT', '3000')}`).replace(/\/+$/, ''),
  dataDir,
  dbFile: env('DB_FILE') === ':memory:' ? ':memory:' : path.resolve(dataDir, env('DB_FILE', 'app.db')),
  sessionSecret: secret('SESSION_SECRET'),
  encryptionKey: secret('ENCRYPTION_KEY'),
  verifyToken: secret('WA_VERIFY_TOKEN', 16),
  adminEmail: env('ADMIN_EMAIL', 'admin@example.com'),
  adminPassword: env('ADMIN_PASSWORD', ''),
  graphVersion: env('GRAPH_VERSION', 'v24.0'),
  metaAppSecret: env('META_APP_SECRET'),
  // AI engines (server-wide defaults; each business can also paste its own key in the dashboard)
  anthropicKey: env('ANTHROPIC_API_KEY'),
  aiModel: env('AI_MODEL', 'claude-opus-5-5'),
  openaiKey: env('OPENAI_API_KEY'),
  openaiModel: env('OPENAI_MODEL', 'gpt-5-mini'),
  openaiBaseUrl: env('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, ''),
  geminiKey: env('GEMINI_API_KEY'),
  geminiModel: env('GEMINI_MODEL', 'gemini-2.5-flash'),
  geminiBaseUrl: env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
  // Product branding + who the dashboard's Help page sends people to (your agency / Indrix)
  brand: {
    name: env('BRAND_NAME', 'Replix'),
    company: env('BRAND_COMPANY', 'Indrix'),
    companyUrl: env('BRAND_COMPANY_URL', 'https://nandaniramoliya.github.io/Indrix/'),
    siteUrl: env('PRODUCT_SITE_URL', 'https://replix.pages.dev/'),
    supportWhatsapp: env('SUPPORT_WHATSAPP').replace(/\D/g, ''),
    supportEmail: env('SUPPORT_EMAIL'),
    supportHours: env('SUPPORT_HOURS', 'Mon–Sat, 10am–7pm'),
  },
  defaultTimezone: env('DEFAULT_TIMEZONE', 'Asia/Kolkata'),
  defaultCountryCode: env('DEFAULT_COUNTRY_CODE', '91'),
  defaultCurrency: env('DEFAULT_CURRENCY', 'INR'),
  schedulerIntervalMs: Number(env('SCHEDULER_INTERVAL_MS', '30000')),
  schedulerEnabled: env('SCHEDULER_ENABLED', 'true') !== 'false',
  logLevel: env('LOG_LEVEL', 'info'),
};
