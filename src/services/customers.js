import { get, run, insert, parseJson, now } from '../db/index.js';

export function getCustomer(bizId, phone) {
  return parseJson(get('SELECT * FROM customers WHERE business_id = ? AND phone = ?', bizId, phone), ['tags']);
}

/** Create or refresh a customer on every inbound message (opens the 24h window). */
export function touchCustomer(bizId, phone, profileName, inbound = true) {
  const t = now();
  run(`INSERT INTO customers (business_id, phone, name, last_inbound_at, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (business_id, phone) DO UPDATE SET
         name = COALESCE(customers.name, excluded.name),
         last_inbound_at = CASE WHEN ? THEN excluded.last_inbound_at ELSE customers.last_inbound_at END`,
  bizId, phone, profileName || null, inbound ? t : null, t, inbound ? 1 : 0);
  return getCustomer(bizId, phone);
}

export function ensureCustomer(bizId, phone, name) {
  const c = getCustomer(bizId, phone);
  if (c) {
    if (name && !c.name) run('UPDATE customers SET name = ? WHERE id = ?', name, c.id);
    return getCustomer(bizId, phone);
  }
  insert('customers', { business_id: bizId, phone, name: name || null });
  return getCustomer(bizId, phone);
}

export function addTags(customerId, tags) {
  const c = parseJson(get('SELECT tags FROM customers WHERE id = ?', customerId), ['tags']);
  if (!c) return;
  const set = new Set([...(c.tags || []), ...tags.filter(Boolean)]);
  run('UPDATE customers SET tags = ? WHERE id = ?', JSON.stringify([...set]), customerId);
}

export const setCustomerField = (customerId, field, value) => {
  if (!['name', 'address', 'opted_in', 'marketing_opt_in', 'last_order_at', 'last_visit_at', 'notes', 'language'].includes(field)) throw new Error('bad field');
  run(`UPDATE customers SET ${field} = ? WHERE id = ?`, value, customerId);
};

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/** The language a customer chose (null = business default). */
export const langOf = (bizId, phone) => get('SELECT language FROM customers WHERE business_id = ? AND phone = ?', bizId, phone)?.language || null;
