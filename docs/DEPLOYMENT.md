# Deployment Guide

One server runs **all** your client businesses. Pick one option:

| Option | Best for | Effort |
|---|---|---|
| [Free with Cloudflare](#free-with-cloudflare) | Product website on Cloudflare Pages + bot on your PC/VPS via Cloudflare Tunnel (the PinPage way) | 15 min |
| [A. Ubuntu VPS + PM2 + nginx](#a-ubuntu-vps-recommended) | Agencies, many clients, lowest cost | 30 min |
| [B. Docker / Docker Compose](#b-docker) | If you already use Docker | 15 min |
| [C. Render (PaaS)](#c-render) | No server admin | 10 min |
| [Local + ngrok](#local-testing-with-ngrok) | Development & demos with a real number | 5 min |

Requirements everywhere: **Node.js 22.13+**, a **persistent disk** for `data/` (SQLite DB + secrets + backups),
**https** in front (Meta only calls https webhooks).

---

## Free with Cloudflare

Replix is two things, and Cloudflare hosts them differently:

1. **The product website** (`product-site/`) is static HTML → **Cloudflare Pages**, free, exactly like PinPage.
2. **The bot + dashboard** is a Node.js server that must run all the time (WhatsApp webhooks, the SQLite
   database, reminders every 30 seconds). Cloudflare Pages cannot run it. It runs on **your PC, a VPS or Render**,
   and **Cloudflare Tunnel** gives it a free https address – no router setup, no open ports, no certificate work.

### 1. Product website on Cloudflare Pages

One-time:
1. Free account at https://dash.cloudflare.com (the same one used for PinPage works).
2. **My Profile → API Tokens → Create token → Custom token**. Permission: **Account › Cloudflare Pages › Edit**.
   Copy the token.
3. **Workers & Pages** → copy the **Account ID**.
4. In `.env`:
   ```
   CLOUDFLARE_API_TOKEN=...
   CLOUDFLARE_ACCOUNT_ID=...
   SUPPORT_WHATSAPP=9198XXXXXXXX      # "Get a demo" buttons open this WhatsApp
   SUPPORT_EMAIL=you@example.com      # optional
   ```

Every time you change `product-site/index.html`:
```bash
npm run site:build      # optional preview: open product-site/dist/index.html
npm run site:publish    # creates the Pages project "replix" the first time, then uploads
```
The script prints the live address – normally **https://replix.pages.dev/**. If that name was already taken,
Cloudflare adds a suffix (like PinPage's `pinpage-8no.pages.dev`): put the printed address in
`PRODUCT_SITE_URL` and update the links on the Indrix website and portfolio.

Own domain: Pages project → **Custom domains → Set up a domain**, then set `PRODUCT_SITE_URL=https://yourdomain/`
and publish again (canonical link, sitemap and share image use it). Google: add the address in Search Console and
put the code in `SITE_GOOGLE_VERIFY`.

### 2. The bot on your PC or server + Cloudflare Tunnel

**Quick tunnel (demos, testing – no account, no domain):**
```bash
npm start          # terminal 1
npm run tunnel     # terminal 2 – prints https://xxxx.trycloudflare.com + the exact Meta webhook values
```
Put the printed address in `.env` as `PUBLIC_URL` and restart `npm start`. In Meta → WhatsApp → Configuration use
`https://xxxx.trycloudflare.com/webhook` and the verify token it prints. The address changes each time the tunnel
restarts, so use this for demos only. (`npm run tunnel` uses `cloudflared` if installed, otherwise downloads it once
with npx.)

**Named tunnel (live clients – fixed address, still free; needs a domain on Cloudflare):**
```bash
cloudflared tunnel login                               # opens the browser, pick your domain
cloudflared tunnel create replix
cloudflared tunnel route dns replix bot.yourdomain.com
cloudflared tunnel run --url http://localhost:3000 replix
```
Then `PUBLIC_URL=https://bot.yourdomain.com` and the webhook `https://bot.yourdomain.com/webhook`. To start it with
the computer: `cloudflared service install` (Windows/Linux/macOS). Run the app itself with PM2 (section A.4) so both
survive restarts.

> Running on a home PC is fine for one or two small clients, but the bot is offline whenever the PC is off or asleep.
> For paying clients use a small VPS (section A) – the tunnel works there too, so you can skip nginx and certbot.

## Local testing with ngrok

```bash
npm install
cp .env.example .env          # or: npm run setup
npm start                     # terminal 1
ngrok http 3000               # terminal 2 -> copy https://xxxx.ngrok-free.app
```

Set `PUBLIC_URL=https://xxxx.ngrok-free.app` in `.env`, restart `npm start`, then use
`https://xxxx.ngrok-free.app/webhook` as the callback URL in Meta. (Free ngrok URLs change on every restart – update
`PUBLIC_URL` and Meta each time, or use a reserved domain / Cloudflare Tunnel.)

## A. Ubuntu VPS (recommended)

Any provider (DigitalOcean, Hetzner, AWS Lightsail, Hostinger…). 1 vCPU / 1 GB RAM is enough to start.

### 1. Server + domain
Create an Ubuntu 22.04/24.04 server. Point a sub-domain (e.g. `bot.youragency.com`) **A record** to its IP.

### 2. Install software
```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs nginx git
sudo snap install --classic certbot && sudo ln -sf /snap/bin/certbot /usr/bin/certbot
sudo npm install -g pm2
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw --force enable
```

### 3. Get the code and configure
```bash
cd ~ && git clone https://github.com/NandaniRamoliya/WhatsAPPautomation.git
cd WhatsAPPautomation
npm ci --omit=dev
npm run setup            # PUBLIC_URL=https://bot.youragency.com, admin email/password, Meta app secret
```

### 4. Run with PM2 (auto-restart, starts on boot)
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup              # run the command it prints
pm2 logs whatsapp-bot    # see logs / the first login
```

### 5. nginx + free HTTPS
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/whatsapp-bot
sudo sed -i 's/bot.yourdomain.com/bot.youragency.com/' /etc/nginx/sites-available/whatsapp-bot
sudo ln -s /etc/nginx/sites-available/whatsapp-bot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d bot.youragency.com
```

Check: `https://bot.youragency.com/health` → `ok`. Open `https://bot.youragency.com` and log in.

### 6. Backups
```bash
crontab -e
# daily 03:10 – consistent copy into data/backups (keeps 14)
10 3 * * * cd /home/ubuntu/WhatsAPPautomation && /usr/bin/npm run backup >> data/backup.log 2>&1
```
Also copy `data/backups` off the server (rclone to Google Drive/S3, or your provider's snapshots) and keep a copy
of `.env` in a password manager – **`ENCRYPTION_KEY` is required to read stored WhatsApp tokens**.

Restore: stop the app, replace `data/app.db` with a backup file (delete `app.db-wal`/`app.db-shm`), start.

### 7. Monitoring
Add a free uptime monitor (UptimeRobot, Better Stack) on `https://bot.youragency.com/health`.
Logs are JSON lines: `pm2 logs whatsapp-bot | grep -E '"level":"(warn|error)"'`.

### 8. Updating
```bash
cd ~/WhatsAPPautomation
npm run backup
git pull
npm ci --omit=dev
pm2 restart whatsapp-bot
```
Database migrations run automatically on start.

## B. Docker

```bash
cp .env.example .env     # set PUBLIC_URL, ADMIN_EMAIL, ADMIN_PASSWORD, META_APP_SECRET...
mkdir -p data && sudo chown 1000:1000 data   # container runs as the "node" user (uid 1000)
docker compose up -d --build
docker compose logs -f
```
Put nginx/Caddy/Traefik with https in front of port 3000. Backups:
`docker compose exec app node --disable-warning=ExperimentalWarning scripts/backup.js` (files land in `./data/backups`).

## C. Render

1. Fork/push the repo to GitHub → Render → **New → Blueprint** → select the repo (uses `render.yaml`).
2. Set `PUBLIC_URL` (your Render URL, e.g. `https://whatsapp-automation.onrender.com`), `ADMIN_EMAIL`,
   `ADMIN_PASSWORD`, `META_APP_SECRET`.
3. A 1 GB persistent disk is mounted at `data/` – required, otherwise the database is lost on every deploy.
   Use a paid instance (free instances sleep, and Meta webhooks would time out).

Railway / Fly.io work the same way: Node 22, `npm start`, persistent volume on `/app/data` (set `DATA_DIR`), https.

## Production checklist

- [ ] `NODE_ENV=production`, `PUBLIC_URL` is https
- [ ] `META_APP_SECRET` set (signatures verified)
- [ ] Strong admin password; first login changed
- [ ] `.env` + `ENCRYPTION_KEY` backed up safely
- [ ] Daily backups + off-server copy, restore tested once
- [ ] Uptime monitor on `/health`
- [ ] Only **one** app process per `data/` folder (`instances: 1` in PM2)
- [ ] `GRAPH_VERSION` matches what Meta's API Setup page shows
