-- =====================================================================
-- 002: AI knowledge base (RAG), integrations hub, custom menu &
-- quick replies, per-customer language.
-- =====================================================================

-- ---------- Knowledge base: documents the AI answers from ----------
CREATE TABLE kb_sources (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'text',        -- text | file | url
  source       TEXT,                                -- file name or URL
  content      TEXT NOT NULL,                       -- full extracted text
  chars        INTEGER NOT NULL DEFAULT 0,
  chunks       INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_kb_sources_biz ON kb_sources(business_id);

CREATE TABLE kb_chunks (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source_id    INTEGER NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
  ord          INTEGER NOT NULL DEFAULT 0,
  body         TEXT NOT NULL
);
CREATE INDEX idx_kb_chunks_biz ON kb_chunks(business_id, source_id, ord);

-- Full-text index (BM25 ranking, Unicode aware: works for Hindi/Gujarati too)
CREATE VIRTUAL TABLE kb_fts USING fts5(body, content='kb_chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN
  INSERT INTO kb_fts(rowid, body) VALUES (new.id, new.body);
END;
CREATE TRIGGER kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN
  INSERT INTO kb_fts(kb_fts, rowid, body) VALUES ('delete', old.id, old.body);
END;
CREATE TRIGGER kb_chunks_au AFTER UPDATE ON kb_chunks BEGIN
  INSERT INTO kb_fts(kb_fts, rowid, body) VALUES ('delete', old.id, old.body);
  INSERT INTO kb_fts(rowid, body) VALUES (new.id, new.body);
END;

-- ---------- Integrations: delivery log (config lives in settings.integrations) ----------
CREATE TABLE integration_log (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  target       TEXT NOT NULL,                       -- webhook | sheets | hubspot | airtable
  event        TEXT NOT NULL,
  status       TEXT NOT NULL,                       -- ok | error
  http_status  INTEGER,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_integration_log_biz ON integration_log(business_id, id);

-- ---------- Custom menu buttons & keyword quick replies ----------
CREATE TABLE quick_replies (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,                       -- menu label (<= 24 chars shown)
  description  TEXT,                                -- small text under the menu label
  keywords     TEXT,                                -- comma separated triggers
  reply_type   TEXT NOT NULL DEFAULT 'text',        -- text | link | image | document | location | flow
  body         TEXT,                                -- message text / caption / address
  url          TEXT,                                -- link, image or document URL
  button_label TEXT,                                -- label for link buttons
  latitude     REAL,
  longitude    REAL,
  flow_target  TEXT,                                -- e.g. ord:start, bk:start, enq:lead, human
  show_in_menu INTEGER NOT NULL DEFAULT 1,
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_quick_replies_biz ON quick_replies(business_id, sort);

-- ---------- Per-customer language (multi-language bots) ----------
ALTER TABLE customers ADD COLUMN language TEXT;
