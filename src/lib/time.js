// Timezone-correct date helpers using only Intl (no external libraries).
// Business wall-clock times (e.g. "10:30" in Asia/Kolkata) <-> UTC instants.

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const fmtCache = new Map();
function partsFormatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a timezone. */
export function tzParts(date, tz) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(date))) p[type] = value;
  return {
    y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second,
    weekday: p.weekday.toLowerCase().slice(0, 3),
    ymd: `${p.year}-${p.month}-${p.day}`,
    hm: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}`,
  };
}

/** Offset (ms) of tz from UTC at a given instant. */
function offsetAt(ms, tz) {
  const p = tzParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000;
}

/** Convert local "YYYY-MM-DD" + "HH:MM" in tz to a UTC Date. */
export function zonedToUtc(ymd, hm, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let utc = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(utc, tz); // handle DST edges
  if (second !== utc) utc = second;
  return new Date(utc);
}

export const todayIn = (tz, at = Date.now()) => tzParts(at, tz).ymd;

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function weekdayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export const hmToMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
export const minToHm = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** "10:30 AM" in the business timezone. */
export function fmtTime(date, tz) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(date)).replace('am', 'AM').replace('pm', 'PM');
}

/** "Fri, 21 Nov" in the business timezone. */
export function fmtDate(date, tz) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(date));
}

/** Label for a local date: Today / Tomorrow / Fri 21 Nov */
export function dayLabel(ymd, tz, labels = { today: 'Today', tomorrow: 'Tomorrow' }) {
  const today = todayIn(tz);
  if (ymd === today) return labels.today;
  if (ymd === addDays(today, 1)) return labels.tomorrow;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** Is the business open right now? hours = { mon: [["09:00","13:00"],["17:00","21:00"]], ... } */
export function isOpenAt(hours, tz, at = Date.now()) {
  if (!hours) return true;
  const p = tzParts(at, tz);
  const ranges = hours[p.weekday] || [];
  const cur = p.hh * 60 + p.mm;
  return ranges.some(([a, b]) => cur >= hmToMin(a) && cur < hmToMin(b));
}

/** Next opening moment description, e.g. "Mon 09:00". */
export function nextOpening(hours, tz, at = Date.now()) {
  if (!hours) return null;
  const today = todayIn(tz, at);
  const nowMin = tzParts(at, tz).hh * 60 + tzParts(at, tz).mm;
  for (let i = 0; i < 8; i++) {
    const ymd = addDays(today, i);
    for (const [a] of hours[weekdayOf(ymd)] || []) {
      if (i > 0 || hmToMin(a) > nowMin) return { ymd, hm: a, label: `${dayLabel(ymd, tz)} ${a}` };
    }
  }
  return null;
}
