// Usage: npm run create-admin -- email@domain.com "StrongPassword"
// Creates an agency super-admin, or resets the password if the email exists.
import { migrate, get, run } from '../src/db/index.js';
import { createUser, setPassword } from '../src/services/setup.js';

migrate();
const [email, password] = process.argv.slice(2);
if (!email || !password) { console.error('Usage: npm run create-admin -- <email> <password>'); process.exit(1); }
const u = get('SELECT * FROM users WHERE email = ?', email);
if (u) {
  setPassword(u.id, password);
  run('UPDATE users SET active = 1 WHERE id = ?', u.id);
  console.log(`Password reset for ${email} (role: ${u.role}).`);
} else {
  createUser({ email, password, name: 'Admin', role: 'superadmin' });
  console.log(`Super-admin ${email} created.`);
}
