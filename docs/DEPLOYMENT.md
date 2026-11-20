# Deployment Guide

One server runs **all** your client businesses. Pick one option:

| Option | Best for | Effort |
|---|---|---|
| [A. Ubuntu VPS + PM2 + nginx](#a-ubuntu-vps-recommended) | Agencies, many clients, lowest cost | 30 min |
| [B. Docker / Docker Compose](#b-docker) | If you already use Docker | 15 min |
| [C. Render (PaaS)](#c-render) | No server admin | 10 min |
| [Local + ngrok](#local-testing-with-ngrok) | Development & demos with a real number | 5 min |

Requirements everywhere: **Node.js 22.13+**, a **persistent disk** for `data/` (SQLite DB + secrets + backups),
**https** in front (Meta only calls https webhooks).

---

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
