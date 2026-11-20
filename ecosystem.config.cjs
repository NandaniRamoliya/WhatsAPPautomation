// PM2 process file:  pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
// Run ONE instance: the scheduler and SQLite are designed for a single process per data folder.
module.exports = {
  apps: [{
    name: 'whatsapp-bot',
    script: 'src/server.js',
    node_args: '--disable-warning=ExperimentalWarning',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '400M',
    env: { NODE_ENV: 'production' },
    time: true,
  }],
};
