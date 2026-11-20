// Durable job queue stored in SQLite: reminders, follow-ups, recalls, broadcasts.
// Survives restarts. Handlers register by type; the scheduler runs due jobs.
import { all, run, insert, now, parseJson } from '../db/index.js';
import { log } from '../lib/logger.js';

const handlers = new Map();
export const registerJob = (type, fn) => handlers.set(type, fn);

export function schedule(businessId, type, runAt, payload = {}, ref = null) {
  return insert('jobs', { business_id: businessId, type, run_at: new Date(runAt).toISOString(), payload: JSON.stringify(payload), ref });
}

export function cancelJobs(ref, type = null) {
  if (type) return run(`UPDATE jobs SET status = 'CANCELLED', updated_at = ? WHERE ref = ? AND type = ? AND status = 'PENDING'`, now(), ref, type).changes;
  return run(`UPDATE jobs SET status = 'CANCELLED', updated_at = ? WHERE ref = ? AND status = 'PENDING'`, now(), ref).changes;
}

const MAX_ATTEMPTS = 3;

export async function runDueJobs(limit = 50) {
  const due = all(`SELECT * FROM jobs WHERE status = 'PENDING' AND run_at <= ? ORDER BY run_at LIMIT ?`, now(), limit);
  let done = 0;
  for (const job of due) {
    // claim (guards against two schedulers picking the same job)
    if (!run(`UPDATE jobs SET status = 'RUNNING', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'PENDING'`, now(), job.id).changes) continue;
    parseJson(job, ['payload']);
    const fn = handlers.get(job.type);
    try {
      if (!fn) throw new Error(`no handler for job type ${job.type}`);
      await fn(job);
      run(`UPDATE jobs SET status = 'DONE', updated_at = ? WHERE id = ?`, now(), job.id);
      done++;
    } catch (e) {
      const retry = job.attempts + 1 < MAX_ATTEMPTS;
      run(`UPDATE jobs SET status = ?, last_error = ?, run_at = ?, updated_at = ? WHERE id = ?`,
        retry ? 'PENDING' : 'FAILED', String(e.message).slice(0, 500), new Date(Date.now() + 5 * 60_000).toISOString(), now(), job.id);
      log.error('job failed', { id: job.id, type: job.type, err: e.message });
    }
  }
  return done;
}
