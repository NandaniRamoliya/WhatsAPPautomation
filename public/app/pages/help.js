import { html, useApp } from '../lib.js';
import { Page, Card } from '../ui.js';

const Q = ({ q, children }) => html`<details class="card" style="padding:14px 18px"><summary><strong>${q}</strong></summary><div style="margin-top:10px">${children}</div></details>`;

export function Help() {
  const { biz } = useApp();
  return html`<${Page} title="Help" subtitle="Quick answers. The full guide is docs/USER_GUIDE.md (ask your developer for the PDF).">
    <${Card} title="Your daily routine (5 minutes)">
      <ol>
        <li>Keep this dashboard open on a computer or phone – new orders/bookings make a <b>sound</b> (tap anywhere once so the browser allows sound).</li>
        ${biz.modules.includes('ordering') && html`<li><b>Orders:</b> tap "Payment received" for UPI orders after checking your bank app, then move orders to Preparing → Out for delivery → Delivered. The customer is told automatically.</li>`}
        ${biz.modules.includes('booking') && html`<li><b>Appointments:</b> after each visit tap "Visit done" (add the prescription if any). The bot sends aftercare, a check-in after a few days, a review request and the recall – automatically.</li>`}
        <li><b>Chats:</b> reply to anyone marked "Needs reply". When you reply, the bot pauses for that customer; tap "Hand back to bot" when done.</li>
        <li>Switch items <b>out of stock</b> / add holidays so the bot never promises what you cannot give.</li>
      </ol>
    <//>
    <${Q} q="A customer says the bot is not replying">Check Chats – if it says "Bot paused", tap "Hand back to bot". Customers can also type <b>menu</b> to restart. If nobody gets replies, WhatsApp may be disconnected: Settings → WhatsApp → Test connection.<//>
    <${Q} q="A message shows ⚠️ '24h window closed'">WhatsApp only allows free messages within 24 hours of the customer's last message. For later messages (reminders, updates) set up approved templates in "Message templates".<//>
    <${Q} q="How do I change what the bot says?">Open "Bot messages", edit the text, and save. Keep words in {curly} braces.<//>
    <${Q} q="How do I stop a customer from getting messages?">Customers can type STOP themselves. You can also open Customers → Edit → switch off "Receives reminders & updates".<//>
    <${Q} q="A customer asked us to delete their data">Customers → Edit → "Delete data". This removes their profile and chat history.<//>
    <${Q} q="How do customers find the bot?">Print the QR from the Home page. Share the chat link on Instagram, Google Business Profile, bills and visiting cards.<//>
    <${Q} q="Is it safe to send offers to everyone?">Only to customers who agreed. WhatsApp checks complaints – too many "block/report" can restrict your number.<//>
  <//>`;
}
