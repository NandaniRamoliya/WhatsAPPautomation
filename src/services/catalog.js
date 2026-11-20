import { all, get } from '../db/index.js';

export const categories = (bizId) => all(
  `SELECT category, COUNT(*) AS n FROM products WHERE business_id = ? AND active = 1 AND in_stock = 1
   GROUP BY category ORDER BY MIN(sort), category`, bizId);

export const productsIn = (bizId, category) => all(
  `SELECT * FROM products WHERE business_id = ? AND active = 1 AND in_stock = 1 AND category = ? ORDER BY sort, name`, bizId, category);

export const product = (bizId, id) => get('SELECT * FROM products WHERE business_id = ? AND id = ?', bizId, Number(id));

export const availableProducts = (bizId) => all(
  'SELECT id, name, unit, price, category FROM products WHERE business_id = ? AND active = 1 AND in_stock = 1 ORDER BY category, name', bizId);

/** Simple multi-word search: every word must appear in name/category/description. */
export function search(bizId, query, limit = 10) {
  const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 5);
  if (!words.length) return [];
  const cond = words.map(() => `(LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(COALESCE(description,'')) LIKE ?)`).join(' AND ');
  const params = words.flatMap((w) => [`%${w}%`, `%${w}%`, `%${w}%`]);
  return all(`SELECT * FROM products WHERE business_id = ? AND active = 1 AND in_stock = 1 AND ${cond} ORDER BY sort, name LIMIT ?`, bizId, ...params, limit);
}
