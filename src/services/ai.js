// Optional AI layer (Claude). Two jobs, both "AI proposes, code validates":
//  1) parseOrderText: "2 kilo aata aur 1 maggi" -> catalogue items (only real ids, DB prices)
//  2) answerQuestion: free-form question -> answer ONLY from the business info + FAQs
// Disabled unless ANTHROPIC_API_KEY is set AND the business enables AI in Settings.
import { z } from 'zod';
import { config } from '../config.js';
import { all } from '../db/index.js';
import { log } from '../lib/logger.js';
import { availableProducts } from './catalog.js';

let client = null;
async function anthropic() {
  if (!client) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    // Short timeout: a WhatsApp customer is waiting for the reply.
    client = new Anthropic({ apiKey: config.anthropicKey, timeout: 25_000, maxRetries: 1 });
  }
  return client;
}

export const aiEnabled = (biz, feature) => Boolean(config.anthropicKey && biz?.settings?.ai?.enabled && biz.settings.ai[feature] !== false);

const OrderSchema = z.object({
  items: z.array(z.object({ id: z.number().int(), qty: z.number().int() })),
  unclear: z.array(z.string()),
});

const AnswerSchema = z.object({
  answerable: z.boolean(),
  answer: z.string(),
});

/** Common request options: server-side refusal fallback + low effort for fast chat replies. */
async function ask(system, user, schema) {
  const { betaZodOutputFormat } = await import('@anthropic-ai/sdk/helpers/beta/zod');
  const c = await anthropic();
  const res = await c.beta.messages.parse({
    model: config.aiModel,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (res.stop_reason === 'refusal') {
    log.warn('ai refusal', { category: res.stop_details?.category });
    return null;
  }
  return res.parsed_output ?? null;
}

export async function parseOrderText(biz, textIn) {
  const products = availableProducts(biz.id).slice(0, 500);
  if (!products.length) return null;
  const catalogue = products.map((p) => `${p.id} | ${p.name} | ${p.unit} | ${p.category}`).join('\n');
  const out = await ask(
    'You map a shop customer\'s WhatsApp message (English, Hindi, Hinglish or any language) to catalogue items. '
    + 'Use ONLY ids from the catalogue. Never invent products. qty is a whole number of catalogue units. '
    + 'If the message is not an order (a greeting, a question), return an empty items list. '
    + 'Put words you could not match into "unclear".',
    `Catalogue (id | name | unit | category):\n${catalogue}\n\nCustomer message:\n${textIn}`,
    OrderSchema,
  );
  if (!out) return null;
  const valid = new Set(products.map((p) => p.id));
  return {
    items: out.items.filter((i) => valid.has(i.id) && i.qty > 0 && i.qty < 100),
    unclear: (out.unclear || []).slice(0, 5).map((s) => String(s).slice(0, 40)),
  };
}

export async function answerQuestion(biz, question) {
  const faqs = all('SELECT question, answer FROM faqs WHERE business_id = ? AND active = 1', biz.id);
  const info = [
    `Business: ${biz.name}`, biz.about && `About: ${biz.about}`, biz.address && `Address: ${biz.address}`,
    biz.map_link && `Map: ${biz.map_link}`, biz.contact_phone && `Phone: ${biz.contact_phone}`, biz.website && `Website: ${biz.website}`,
    `Opening hours (24h clock): ${JSON.stringify(biz.settings.hours)}`,
    ...faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`),
  ].filter(Boolean).join('\n');
  const lang = biz.language === 'hinglish' ? 'Reply in Hinglish (Hindi written in English letters).' : 'Reply in the customer\'s language.';
  const out = await ask(
    `You are the WhatsApp assistant of a local business. Answer the customer ONLY using the business information provided. `
    + `If the information does not contain the answer, or the question needs a human (medical advice, complaints, price negotiation), set answerable=false. `
    + `Keep answers under 60 words, friendly, no markdown headings. ${lang}`,
    `Business information:\n${info}\n\nCustomer question:\n${question}`,
    AnswerSchema,
  );
  return out?.answerable && out.answer ? out.answer.slice(0, 900) : null;
}
