import { config } from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[config.logLevel] ?? 20;

function out(level, msg, meta) {
  if (LEVELS[level] < min) return;
  const line = { t: new Date().toISOString(), level, msg };
  if (meta instanceof Error) line.err = meta.stack || meta.message;
  else if (meta && typeof meta === 'object') Object.assign(line, meta);
  const s = JSON.stringify(line);
  (level === 'error' || level === 'warn' ? console.error : console.log)(s);
}

export const log = {
  debug: (m, x) => out('debug', m, x),
  info: (m, x) => out('info', m, x),
  warn: (m, x) => out('warn', m, x),
  error: (m, x) => out('error', m, x),
};
