-- ============================================================
-- Nguyen Family Finance — Initial Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE uploaded_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  file_type    TEXT NOT NULL CHECK (file_type IN ('csv','pdf','xlsx')),
  bank         TEXT,
  storage_path TEXT NOT NULL,
  row_count    INTEGER,
  uploaded_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  description  TEXT NOT NULL,
  amount       DECIMAL(10,2) NOT NULL,
  category     TEXT,
  is_recurring BOOLEAN DEFAULT FALSE,
  source_bank  TEXT,
  file_id      UUID REFERENCES uploaded_files(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE categories (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT UNIQUE NOT NULL,
  color TEXT
);

CREATE TABLE merchant_patterns (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword            TEXT UNIQUE NOT NULL,
  category           TEXT NOT NULL,
  confirmation_count INTEGER DEFAULT 1,
  last_seen          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_transactions_date     ON transactions(date DESC);
CREATE INDEX idx_transactions_category ON transactions(category);
CREATE INDEX idx_transactions_user     ON transactions(user_id);
CREATE INDEX idx_merchant_keyword      ON merchant_patterns(keyword);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploaded_files    ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_patterns ENABLE ROW LEVEL SECURITY;

-- transactions: any auth user can read all; write own rows only
CREATE POLICY "read all transactions"
  ON transactions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert own transactions"
  ON transactions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update own transactions"
  ON transactions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "delete own transactions"
  ON transactions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- uploaded_files: same pattern
CREATE POLICY "read all files"
  ON uploaded_files FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert own files"
  ON uploaded_files FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "delete own files"
  ON uploaded_files FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- categories: read-only for all authenticated users
CREATE POLICY "read categories"
  ON categories FOR SELECT
  TO authenticated USING (true);

-- merchant_patterns: shared read/write for all authenticated users
CREATE POLICY "read patterns"
  ON merchant_patterns FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "upsert patterns"
  ON merchant_patterns FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update patterns"
  ON merchant_patterns FOR UPDATE
  TO authenticated USING (true);

-- ============================================================
-- SEED: 23 categories from existing spreadsheet
-- ============================================================

INSERT INTO categories (name, color) VALUES
  ('Housing',              '#4A90D9'),
  ('Rent/Mortgage',        '#357ABD'),
  ('Internet',             '#7B68EE'),
  ('Car expenses',         '#E67E22'),
  ('Travel',               '#1ABC9C'),
  ('Petrol',               '#F39C12'),
  ('Food - Groceries',     '#27AE60'),
  ('Food - Dining Out',    '#2ECC71'),
  ('Personal - Grace',     '#E91E8C'),
  ('Clothing',             '#9B59B6'),
  ('Health Insurance',     '#3498DB'),
  ('Education - personal', '#8E44AD'),
  ('Children - Education', '#16A085'),
  ('Childcare',            '#1ABC9C'),
  ('Other Expenses',       '#95A5A6'),
  ('Gifts',                '#E74C3C'),
  ('Children stuff',       '#F1C40F'),
  ('Family - Phuc Gifts',  '#E74C3C'),
  ('Children babysitting', '#2980B9'),
  ('Personal - Ed',        '#2C3E50'),
  ('Health - Fitness',     '#00BCD4'),
  ('Children money',       '#FFCA28'),
  ('Donation',             '#E53935')
ON CONFLICT (name) DO NOTHING;
