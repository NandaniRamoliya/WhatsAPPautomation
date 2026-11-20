// Lists every dashboard login (no passwords). Usage: npm run users
import { migrate, all } from '../src/db/index.js';
import { config } from '../src/config.js';

migrate();
const users = all(`SELECT u.email, u.role, u.active, b.name AS business FROM users u LEFT JOIN businesses b ON b.id = u.business_id ORDER BY u.id`);
console.log(`\nDatabase: ${config.dbFile}\n`);
if (!users.length) console.log('No logins yet. Run "npm start" once (creates the admin) or "npm run demo".');
for (const u of users) console.log(`  ${u.email.padEnd(28)} ${u.role.padEnd(11)} ${(u.business || 'All businesses (agency)').padEnd(24)} ${u.active ? '' : '(disabled)'}`);
console.log('\nForgot a password?  npm run create-admin -- <email> "<new password>"\n');
