// Creates three ready-to-show demo businesses with logins. Safe to run more than once.
import { migrate, get } from '../src/db/index.js';
import { createBusiness, createUser, ensureSuperAdmin } from '../src/services/setup.js';
import { saveBusiness } from '../src/services/business.js';

migrate();
const admin = ensureSuperAdmin();

const demos = [
  { name: 'Gupta Kirana Store', preset: 'grocery', email: 'kirana@demo.test', extra: { address: 'Shop 4, Sector 15 Market, Noida', contact_phone: '919000000001', settings: { ordering: { upi_id: 'guptakirana@okicici', payment_modes: ['cod', 'upi'] } } } },
  { name: 'Pearl Dental Clinic', preset: 'dental', email: 'dental@demo.test', extra: { address: '2nd floor, Pearl Plaza, Andheri West, Mumbai', contact_phone: '919000000002', map_link: 'https://maps.google.com/?q=Andheri+West', review_link: 'https://g.page/r/pearl-dental/review' } },
  { name: 'Glow Salon & Spa', preset: 'salon', email: 'salon@demo.test', extra: { address: '12 MG Road, Bengaluru', contact_phone: '919000000003', language: 'hinglish' } },
];

console.log('\nDemo businesses:');
for (const d of demos) {
  const existing = get('SELECT id FROM businesses WHERE name = ?', d.name);
  let id = existing?.id;
  if (!id) {
    const b = createBusiness({ name: d.name, preset: d.preset, sampleData: true, owner_phone: '919999999999' });
    id = b.id;
    const { settings, ...rest } = d.extra;
    saveBusiness(id, { ...rest, setup_done: 1, ...(settings ? { settings: { ...b.settings, ...Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, { ...b.settings[k], ...v }])) } } : {}) });
  }
  if (!get('SELECT 1 FROM users WHERE email = ?', d.email)) createUser({ email: d.email, password: 'demo12345', name: `${d.name} Owner`, role: 'owner', businessId: id });
  console.log(`  ${d.name.padEnd(22)} login: ${d.email} / demo12345`);
}
if (admin) console.log(`\nAgency super-admin: ${admin.email} / ${admin.password}`);
else console.log('\nAgency super-admin: the account you created before (ADMIN_EMAIL).');
console.log('\nStart the server with "npm start" and open the dashboard. Use "Test the bot" to chat.\n');
