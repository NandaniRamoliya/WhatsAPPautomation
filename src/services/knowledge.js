// Knowledge base for the AI assistant (Retrieval-Augmented Generation).
// Owners add text, files (PDF/TXT/CSV/MD/HTML) or website pages. Content is split
// into chunks and indexed with SQLite FTS5 (BM25 ranking, Unicode aware).
// Small knowledge bases are given to the AI in full (cached prompt = cheap + language
// independent); large ones are searched and only the best passages are sent.
import dns from 'node:dns/promises';
import net from 'node:net';
import { all, get, run, insert, tx, now } from '../db/index.js';
import { HttpError } from '../lib/util.js';

export const LIMITS = { sourceChars: 400_000, businessChars: 2_000_000, fileBytes: 10 * 1024 * 1024, fullContextChars: 60_000 };

export function normalizeText(t) {
  return String(t || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split into ~900 character chunks on paragraph / sentence boundaries, with a little overlap. */
export function chunkText(t, size = 900, overlap = 150) {
  const paras = normalizeText(t).split(/\n{2,}|\n(?=[-•*\d]+[.)]?\s)/).map((p) => p.trim()).filter(Boolean);
  const pieces = [];
  for (const p of paras) {
    if (p.length <= size) { pieces.push(p); continue; }
    const sentences = p.split(/(?<=[.!?।॥])\s+/);
    let cur = '';
    for (const s of sentences) {
      if ((cur + ' ' + s).length > size && cur) { pieces.push(cur.trim()); cur = ''; }
      if (s.length > size) { for (let i = 0; i < s.length; i += size) pieces.push(s.slice(i, i + size)); continue; }
      cur += ` ${s}`;
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  const chunks = [];
  let cur = '';
  for (const p of pieces) {
    if (cur && (cur.length + p.length + 2) > size) {
      chunks.push(cur);
      cur = cur.length > overlap ? `${cur.slice(-overlap).replace(/^\S*\s/, '')}\n${p}` : p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export const listSources = (bizId) => all(`SELECT id, title, kind, source, chars, chunks, active, created_at, updated_at,
  substr(content, 1, 240) AS preview FROM kb_sources WHERE business_id = ? ORDER BY id DESC`, bizId);

export const getSource = (bizId, id) => get('SELECT * FROM kb_sources WHERE business_id = ? AND id = ?', bizId, Number(id));

const totalChars = (bizId, excludeId = 0) => get('SELECT COALESCE(SUM(chars),0) AS n FROM kb_sources WHERE business_id = ? AND id != ?', bizId, excludeId).n;

function writeChunks(bizId, sourceId, content) {
  run('DELETE FROM kb_chunks WHERE source_id = ?', sourceId);
  const chunks = chunkText(content);
  chunks.forEach((body, ord) => insert('kb_chunks', { business_id: bizId, source_id: sourceId, ord, body }));
  return chunks.length;
}

export function addSource(bizId, { title, kind = 'text', source = null, content }) {
  const clean = normalizeText(content);
  if (clean.length < 20) throw new HttpError(400, 'There is almost no text in this source. For scanned PDFs, paste the text instead.');
  if (clean.length > LIMITS.sourceChars) throw new HttpError(400, `Too long (${clean.length.toLocaleString()} characters). Split it into parts of ${LIMITS.sourceChars.toLocaleString()} or less.`);
  if (totalChars(bizId) + clean.length > LIMITS.businessChars) throw new HttpError(400, 'Knowledge base is full for this business. Remove old sources first.');
  return tx(() => {
    const id = insert('kb_sources', { business_id: bizId, title: String(title || source || 'Untitled').slice(0, 200), kind, source, content: clean, chars: clean.length });
    const n = writeChunks(bizId, id, clean);
    run('UPDATE kb_sources SET chunks = ? WHERE id = ?', n, id);
    return getSource(bizId, id);
  });
}

export function updateSource(bizId, id, { title, content, active }) {
  const src = getSource(bizId, id);
  if (!src) throw new HttpError(404, 'Source not found');
  return tx(() => {
    if (content !== undefined) {
      const clean = normalizeText(content);
      if (clean.length < 20) throw new HttpError(400, 'Text is too short');
      if (clean.length > LIMITS.sourceChars) throw new HttpError(400, 'Text is too long');
      if (totalChars(bizId, src.id) + clean.length > LIMITS.businessChars) throw new HttpError(400, 'Knowledge base is full');
      const n = writeChunks(bizId, src.id, clean);
      run('UPDATE kb_sources SET content = ?, chars = ?, chunks = ? WHERE id = ?', clean, clean.length, n, src.id);
    }
    if (title !== undefined) run('UPDATE kb_sources SET title = ? WHERE id = ?', String(title).slice(0, 200), src.id);
    if (active !== undefined) run('UPDATE kb_sources SET active = ? WHERE id = ?', active ? 1 : 0, src.id);
    run('UPDATE kb_sources SET updated_at = ? WHERE id = ?', now(), src.id);
    return getSource(bizId, src.id);
  });
}

export const deleteSource = (bizId, id) => run('DELETE FROM kb_sources WHERE business_id = ? AND id = ?', bizId, Number(id)).changes;

// ---------------- extraction ----------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', rupee: '₹' };

export function htmlToText(html) {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').trim();
  const body = String(html)
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|table|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<(td|th)[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') { const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : m; }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  return { title: title.replace(/\s+/g, ' ').slice(0, 200), text: normalizeText(body) };
}

async function pdfToText(buffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Extract text from an uploaded file (base64). */
export async function extractFile({ filename = 'file', mime = '', base64 }) {
  const buf = Buffer.from(String(base64 || ''), 'base64');
  if (!buf.length) throw new HttpError(400, 'The file is empty');
  if (buf.length > LIMITS.fileBytes) throw new HttpError(400, 'File is larger than 10 MB');
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf' || mime === 'application/pdf') {
    try { return await pdfToText(buf); } catch { throw new HttpError(400, 'Could not read this PDF. If it is a scanned image, paste the text instead.'); }
  }
  if (['html', 'htm'].includes(ext) || mime === 'text/html') return htmlToText(buf.toString('utf8')).text;
  if (['txt', 'csv', 'md', 'json', 'tsv', 'text'].includes(ext) || mime.startsWith('text/')) return buf.toString('utf8');
  if (['doc', 'docx'].includes(ext)) throw new HttpError(400, 'Word files: please "Save as PDF" (or copy-paste the text) and upload again.');
  throw new HttpError(400, 'Supported files: PDF, TXT, CSV, MD, HTML');
}

// ---------------- safe URL import (blocks internal network addresses) ----------------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'Enter a full link starting with https://'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'Only http(s) links are allowed');
  if (u.username || u.password) throw new HttpError(400, 'Links with passwords are not allowed');
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(400, 'This website could not be found');
  if (addrs.some((a) => isPrivateIp(a.address))) throw new HttpError(400, 'This address is not allowed');
  return u;
}

/** Fetch a public web page (or PDF) and return { title, text }. Follows up to 3 redirects, re-checking each. */
export async function fetchUrl(raw) {
  let url = (await assertPublicUrl(raw)).toString();
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhatsAppAssistantKB/1.0)', Accept: 'text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = (await assertPublicUrl(new URL(res.headers.get('location'), url).toString())).toString();
      continue;
    }
    if (!res.ok) throw new HttpError(400, `The website answered with error ${res.status}`);
    const type = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > LIMITS.fileBytes) throw new HttpError(400, 'Page is too large');
    if (type.includes('pdf')) return { title: decodeURIComponent(url.split('/').pop() || 'Document'), text: await pdfToText(buf) };
    if (type.includes('html') || /<html/i.test(buf.subarray(0, 500).toString())) return htmlToText(buf.toString('utf8'));
    return { title: url, text: buf.toString('utf8') };
  }
  throw new HttpError(400, 'Too many redirects');
}

// ---------------- retrieval ----------------
const STOP = new Set('a an the is are was were be to of in on at for and or but with from by as it this that these those i you we they he she my your our their me us do does did can could would should will shall may might have has had what which who whom whose when where why how please hi hello hey kya hai hain ka ki ke ko se me mein aur ya kab kaise kitna kitne kitni batao bataiye ji'.split(' '));

export function searchQuery(text) {
  const words = String(text).toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  const terms = [...new Set(words.filter((w) => w.length > 1 && !STOP.has(w)))].slice(0, 12);
  return terms.map((w) => `"${w.replace(/"/g, '')}"*`).join(' OR ');
}

/** Top passages for a question: [{ source, body, score }]. */
export function search(bizId, text, limit = 6) {
  const q = searchQuery(text);
  if (!q) return [];
  try {
    return all(`SELECT c.body, s.title AS source, bm25(kb_fts) AS score FROM kb_fts
      JOIN kb_chunks c ON c.id = kb_fts.rowid JOIN kb_sources s ON s.id = c.source_id
      WHERE kb_fts MATCH ? AND c.business_id = ? AND s.active = 1 ORDER BY score LIMIT ?`, q, bizId, limit);
  } catch {
    return [];
  }
}

export function stats(bizId) {
  return get(`SELECT COUNT(*) AS sources, COALESCE(SUM(chars),0) AS chars, COALESCE(SUM(chunks),0) AS chunks,
    COALESCE(SUM(CASE WHEN active = 1 THEN chars ELSE 0 END),0) AS active_chars FROM kb_sources WHERE business_id = ?`, bizId);
}

/**
 * Knowledge for one AI call.
 *  - full mode  (active knowledge <= 60k chars): every document, stable -> goes in the cached system prompt
 *  - search mode: only the best passages for this question -> goes in the user message
 */
export function knowledgeFor(bizId, question) {
  const st = stats(bizId);
  if (!st.active_chars) return { mode: 'none', stable: '', passages: [] };
  if (st.active_chars <= LIMITS.fullContextChars) {
    const docs = all('SELECT title, content FROM kb_sources WHERE business_id = ? AND active = 1 ORDER BY id', bizId);
    return { mode: 'full', stable: docs.map((d) => `### ${d.title}\n${d.content}`).join('\n\n'), passages: [] };
  }
  return { mode: 'search', stable: '', passages: search(bizId, question, 8) };
}
