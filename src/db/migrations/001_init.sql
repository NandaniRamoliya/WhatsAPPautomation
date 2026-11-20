-- =====================================================================
-- Replix (WhatsApp automation) - initial schema
-- Multi-tenant: every business-owned table carries business_id.
-- Money is stored as INTEGER minor units (paise/cents) - never floats.
-- Timestamps are ISO-8601 UTC strings (sortable as text).
-- =====================================================================

CREATE TABLE businesses (
  id                  INTEGER PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  preset              TEXT NOT NULL DEFAULT 'generic',
  modules             TEXT NOT NULL DEFAULT '["enquiry"]',   -- JSON array: ordering | booking | enquiry
  language            TEXT NOT NULL DEFAULT 'en',            -- en | hinglish
  timezone            TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  currency            TEXT NOT NULL DEFAULT 'INR',
  owner_phone         TEXT,                                  -- receives alerts (country code, no +)
  owner_email         TEXT,
  contact_phone       TEXT,
  address             TEXT,
  map_link            TEXT,
  review_link         TEXT,
  website             TEXT,
  about               TEXT,
  -- WhatsApp Cloud API connection
  wa_phone_number_id  TEXT UNIQUE,
  wa_waba_id          TEXT,
  wa_display_phone    TEXT,
  wa_token_enc        TEXT,                                  -- AES-256-GCM encrypted
  wa_app_secret_enc   TEXT,                                  -- optional per-business app secret
  settings            TEXT NOT NULL DEFAULT '{}',            -- JSON, merged with defaults
  texts               TEXT NOT NULL DEFAULT '{}',            -- JSON overrides of bot messages
  setup_done          INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  business_id    INTEGER REFERENCES businesses(id) ON DELETE CASCADE, -- NULL = agency super-admin
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL DEFAULT '',
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'owner',   -- superadmin | owner | staff
  active         INTEGER NOT NULL DEFAULT 1,
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE customers (
  id               INTEGER PRIMARY KEY,
  business_id      INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone            TEXT NOT NULL,
  name             TEXT,
  address          TEXT,
  tags             TEXT NOT NULL DEFAULT '[]',
  notes            TEXT,
  opted_in         INTEGER NOT NULL DEFAULT 1,   -- service / transactional messages
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,   -- offers & broadcasts (needs explicit consent)
  last_inbound_at  TEXT,                         -- for the 24-hour customer service window
  last_order_at    TEXT,
  last_visit_at    TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (business_id, phone)
);

CREATE TABLE sessions (
  business_id      INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone            TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'MENU',
  cart             TEXT NOT NULL DEFAULT '[]',
  ctx              TEXT NOT NULL DEFAULT '{}',
  bot_paused_until TEXT,                          -- human handoff: bot stays silent until then
  needs_attention  INTEGER NOT NULL DEFAULT 0,    -- shows in dashboard inbox
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (business_id, phone)
);

CREATE TABLE products (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  category     TEXT NOT NULL DEFAULT 'General',
  unit         TEXT NOT NULL DEFAULT 'pc',
  price        INTEGER NOT NULL,                 -- minor units
  image_url    TEXT,
  sku          TEXT,
  in_stock     INTEGER NOT NULL DEFAULT 1,
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_products_biz ON products(business_id, category, name);

CREATE TABLE orders (
  id              INTEGER PRIMARY KEY,
  business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_no        INTEGER NOT NULL,
  customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  phone           TEXT NOT NULL,
  customer_name   TEXT,
  items           TEXT NOT NULL,                 -- JSON [{id,name,unit,price,qty}]
  subtotal        INTEGER NOT NULL,
  delivery_fee    INTEGER NOT NULL DEFAULT 0,
  discount        INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL,
  fulfilment      TEXT NOT NULL DEFAULT 'delivery', -- delivery | pickup
  address         TEXT,
  notes           TEXT,
  payment_mode    TEXT NOT NULL,                 -- cod | upi | online
  payment_status  TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PAID | COD | REFUNDED
  payment_ref     TEXT,
  pay_token       TEXT UNIQUE,                   -- unguessable token for the /pay page
  status          TEXT NOT NULL DEFAULT 'NEW',   -- NEW | CONFIRMED | PREPARING | READY | OUT_FOR_DELIVERY | DELIVERED | CANCELLED
  cancel_reason   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (business_id, order_no)
);
CREATE INDEX idx_orders_biz ON orders(business_id, created_at);

CREATE TABLE services (
  id            INTEGER PRIMARY KEY,
  business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  category      TEXT,
  duration_min  INTEGER NOT NULL DEFAULT 30,
  price         INTEGER NOT NULL DEFAULT 0,
  recall_days   INTEGER,                         -- e.g. 180 -> "your 6-month cleaning is due"
  aftercare     TEXT,                            -- sent automatically after the visit
  active        INTEGER NOT NULL DEFAULT 1,
  sort          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE staff (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  title        TEXT,                             -- "Dentist", "Stylist"...
  phone        TEXT,                             -- optional: gets booking alerts
  service_ids  TEXT NOT NULL DEFAULT '[]',       -- empty = performs all services
  hours        TEXT,                             -- JSON weekly hours; NULL = business hours
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE time_off (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  staff_id     INTEGER REFERENCES staff(id) ON DELETE CASCADE, -- NULL = whole business closed
  date_from    TEXT NOT NULL,                    -- YYYY-MM-DD (business local)
  date_to      TEXT NOT NULL,
  reason       TEXT
);

CREATE TABLE appointments (
  id              INTEGER PRIMARY KEY,
  business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  phone           TEXT NOT NULL,
  customer_name   TEXT,
  service_id      INTEGER REFERENCES services(id) ON DELETE SET NULL,
  staff_id        INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  start_at        TEXT NOT NULL,                 -- UTC ISO
  end_at          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'BOOKED', -- BOOKED | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW
  intake          TEXT NOT NULL DEFAULT '{}',    -- triage answers
  notes           TEXT,
  aftercare_note  TEXT,
  source          TEXT NOT NULL DEFAULT 'whatsapp',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_appt_biz ON appointments(business_id, start_at);
-- Hard guarantee against double booking the same person at the same start time.
CREATE UNIQUE INDEX uq_appt_slot ON appointments(staff_id, start_at) WHERE status IN ('BOOKED','CONFIRMED');

CREATE TABLE faqs (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  question     TEXT NOT NULL,
  answer       TEXT NOT NULL,
  keywords     TEXT,                             -- comma separated triggers
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE leads (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id  INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  phone        TEXT NOT NULL,
  name         TEXT,
  answers      TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'NEW',      -- NEW | CONTACTED | WON | LOST
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE messages (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone        TEXT NOT NULL,
  direction    TEXT NOT NULL,                    -- in | out
  kind         TEXT NOT NULL,                    -- text | buttons | list | template | image | ...
  body         TEXT,                             -- human-readable summary (inbox)
  payload      TEXT,                             -- raw JSON
  wamid        TEXT,
  status       TEXT,                             -- received | sent | delivered | read | failed | simulated | skipped
  error        TEXT,
  sent_by      TEXT,                             -- bot | staff name | system
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_messages_chat ON messages(business_id, phone, id);
CREATE INDEX idx_messages_wamid ON messages(wamid);

CREATE TABLE processed_events (
  id          TEXT PRIMARY KEY,                  -- WhatsApp message id / payment event id
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE jobs (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  run_at       TEXT NOT NULL,
  payload      TEXT NOT NULL DEFAULT '{}',
  ref          TEXT,                             -- e.g. "appt:12" to cancel related jobs
  status       TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | RUNNING | DONE | FAILED | CANCELLED
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_jobs_due ON jobs(status, run_at);
CREATE INDEX idx_jobs_ref ON jobs(ref);

CREATE TABLE broadcasts (
  id             INTEGER PRIMARY KEY,
  business_id    INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  template_name  TEXT NOT NULL,
  template_lang  TEXT NOT NULL DEFAULT 'en',
  params         TEXT NOT NULL DEFAULT '[]',     -- body params; supports {name}
  audience       TEXT NOT NULL DEFAULT '{}',     -- {tag, marketing_only}
  status         TEXT NOT NULL DEFAULT 'QUEUED', -- QUEUED | RUNNING | DONE | FAILED
  total          INTEGER NOT NULL DEFAULT 0,
  sent           INTEGER NOT NULL DEFAULT 0,
  failed         INTEGER NOT NULL DEFAULT 0,
  cursor         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at    TEXT
);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER,
  user_id      INTEGER,
  action       TEXT NOT NULL,
  details      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
