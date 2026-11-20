// Online, consistent backup of the SQLite database (safe while the server runs).
// Usage: npm run backup            -> data/backups/app-YYYY-MM-DD-HHMM.db (keeps last 14)
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db/index.js';
import { config } from '../src/config.js';

const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const file = path.join(dir, `app-${stamp}.db`);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
console.log(`Backup written: ${file}`);
const old = fs.readdirSync(dir).filter((f) => f.startsWith('app-') && f.endsWith('.db')).sort().slice(0, -14);
old.forEach((f) => fs.unlinkSync(path.join(dir, f)));
if (old.length) console.log(`Removed ${old.length} old backup(s).`);
