// Free HTTPS address for a bot running on your own PC / server, via Cloudflare Tunnel.
//
//   npm start            (in one terminal)
//   npm run tunnel       (in a second terminal)
//
// Quick mode (no account, no domain): Cloudflare gives a random https://xxxx.trycloudflare.com
// address. It changes every time the tunnel restarts – fine for demos and testing.
// For a client that goes live, use a NAMED tunnel on your own domain (fixed address,
// free on Cloudflare): see docs/DEPLOYMENT.md → "Cloudflare Tunnel".
//
// Uses the `cloudflared` program if installed, otherwise downloads it once via npx.
import { spawn, spawnSync } from 'node:child_process';
import { config } from '../src/config.js';

const target = `http://localhost:${config.port}`;
const installed = spawnSync('cloudflared', ['--version'], { shell: process.platform === 'win32', stdio: 'ignore' }).status === 0;
const [cmd, pre] = installed ? ['cloudflared', []] : ['npx', ['--yes', 'cloudflared']];

console.log(`Opening a free Cloudflare Tunnel to ${target} …${installed ? '' : ' (first run downloads cloudflared)'}\n`);
const child = spawn(cmd, [...pre, 'tunnel', '--no-autoupdate', '--url', target], { shell: process.platform === 'win32' });

let shown = false;
const onData = (d) => {
  const s = d.toString();
  const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !shown) {
    shown = true;
    const url = m[0];
    console.log([
      '✓ Your bot is reachable at', `    ${url}`, '',
      'Next steps:',
      `  1. In .env set  PUBLIC_URL=${url}  and restart "npm start" (payment and QR links use it).`,
      '  2. Meta app → WhatsApp → Configuration → Webhook:',
      `       Callback URL : ${url}/webhook`,
      `       Verify token : ${config.verifyToken}`,
      '     then subscribe to the "messages" field.',
      `  3. Dashboard: ${url}/`,
      '',
      'Keep this window open. The address changes when the tunnel restarts – for a fixed address use a named tunnel (docs/DEPLOYMENT.md).',
      'Press Ctrl+C to stop.',
    ].join('\n'));
  }
  if (/ERR|error/i.test(s) && !/Cannot determine default (origin certificate|configuration)/i.test(s)) process.stderr.write(s.split('\n').filter((l) => /ERR|error/i.test(l)).join('\n') + '\n');
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);
child.on('close', (code) => { if (!shown) console.error(`\n✗ The tunnel stopped (code ${code}). Is the internet working? Install cloudflared from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ and try again.`); process.exit(code || 0); });
process.on('SIGINT', () => child.kill('SIGINT'));
