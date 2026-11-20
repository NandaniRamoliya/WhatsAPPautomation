// Minimal WhatsApp Cloud API (Graph API) client. One instance per business credentials.
import { config } from '../config.js';

export class WhatsAppApiError extends Error {
  constructor(status, data) {
    const e = data?.error || {};
    super(e.error_user_msg || e.message || `WhatsApp API error ${status}`);
    this.status = status;
    this.code = e.code;
    this.details = e.error_data?.details;
    this.data = data;
  }
}

/** Plain-language hints for the most common Cloud API error codes. */
export const ERROR_HINTS = {
  190: 'Access token expired or invalid - generate a permanent System User token.',
  100: 'Invalid parameter - check Phone Number ID / message format.',
  131030: 'Recipient not in the allowed test list (test mode). Add the number in Meta API Setup, or go live.',
  131047: 'More than 24 hours since the customer last messaged - an approved template is required.',
  131026: 'Message undeliverable - number not on WhatsApp, or the user blocked/has old app.',
  131051: 'Unsupported message type.',
  132000: 'Template parameter count does not match the approved template.',
  132001: 'Template name or language does not exist / not approved.',
  132015: 'Template paused because of low quality.',
  133010: 'Phone number not registered on Cloud API - register it in WhatsApp Manager.',
  130429: 'Rate limit hit - too many messages per second.',
  131056: 'Too many messages to the same user in a short time (pair rate limit).',
  368: 'Account restricted for policy violations - check WhatsApp Manager.',
};

export class WhatsAppClient {
  constructor({ token, phoneNumberId, wabaId, graphVersion = config.graphVersion }) {
    this.token = token;
    this.phoneNumberId = phoneNumberId;
    this.wabaId = wabaId;
    this.base = `https://graph.facebook.com/${graphVersion}`;
  }

  async request(path, { method = 'GET', body, query } = {}) {
    const url = new URL(`${this.base}/${path}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new WhatsAppApiError(res.status, data);
    return data;
  }

  /** Send any message built with ./builders.js. Returns the WhatsApp message id. */
  async send(to, message) {
    const data = await this.request(`${this.phoneNumberId}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message },
    });
    return data.messages?.[0]?.id;
  }

  /** Blue ticks + "typing…" indicator while the bot works. */
  markRead(messageId, typing = true) {
    return this.request(`${this.phoneNumberId}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId, ...(typing ? { typing_indicator: { type: 'text' } } : {}) },
    });
  }

  phoneInfo() {
    return this.request(this.phoneNumberId, { query: { fields: 'display_phone_number,verified_name,quality_rating,code_verification_status,name_status' } });
  }

  /** Subscribe our Meta app to this WABA so webhooks arrive. */
  subscribeApp() {
    return this.request(`${this.wabaId}/subscribed_apps`, { method: 'POST' });
  }

  listTemplates() {
    return this.request(`${this.wabaId}/message_templates`, { query: { fields: 'name,language,status,category,components', limit: '200' } });
  }

  createTemplate(def) {
    return this.request(`${this.wabaId}/message_templates`, { method: 'POST', body: def });
  }

  /** Download incoming media (image/document/voice) -> { buffer, mime }. */
  async downloadMedia(mediaId) {
    const meta = await this.request(mediaId);
    const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new WhatsAppApiError(res.status, {});
    return { buffer: Buffer.from(await res.arrayBuffer()), mime: meta.mime_type || res.headers.get('content-type') };
  }
}
