-- ═══════════════════════════════════════════════════════
-- Cycling Training Plan v3.1 — Supabase DB Setup
-- Run this in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════

-- 1. USER PROFILES (auto-created on signup)
CREATE TABLE IF NOT EXISTS profiles (
  id           UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email        TEXT,
  display_name TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ATHLETE DATA (latest settings per user)
CREATE TABLE IF NOT EXISTS athlete_data (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL UNIQUE,
  ftp          INT DEFAULT 200,
  age          INT DEFAULT 30,
  weight       NUMERIC(5,1) DEFAULT 75,
  gender       TEXT DEFAULT 'm',
  hrmax        INT DEFAULT 190,
  hrrest       INT DEFAULT 55,
  lthr         INT DEFAULT 162,
  hrmax2       INT DEFAULT 190,
  hr_method    TEXT DEFAULT 'karvonen',
  sessions_week INT DEFAULT 4,
  km_session   INT DEFAULT 40,
  tr_mode      TEXT DEFAULT 'power',
  plan_weeks   INT DEFAULT 8,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TRAINING PLANS (saved generated plans)
CREATE TABLE IF NOT EXISTS training_plans (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name         TEXT NOT NULL,
  ftp          INT,
  weeks        INT,
  sessions_week INT,
  km_session   INT,
  plan_data    JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 4. FTP HISTORY (track progression over time)
CREATE TABLE IF NOT EXISTS ftp_history (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  ftp_value    INT NOT NULL,
  wpkg         NUMERIC(4,2),
  weight       NUMERIC(5,1),
  test_type    TEXT DEFAULT 'manual',  -- 'ramp', '20min', 'manual'
  notes        TEXT,
  test_date    DATE DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────────────
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete_data   ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftp_history    ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Users can view own profile"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- athlete_data
CREATE POLICY "Users can view own data"   ON athlete_data FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can upsert own data" ON athlete_data FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own data" ON athlete_data FOR UPDATE USING (auth.uid() = user_id);

-- training_plans
CREATE POLICY "Users can view own plans"   ON training_plans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own plans" ON training_plans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own plans" ON training_plans FOR DELETE USING (auth.uid() = user_id);

-- ftp_history
CREATE POLICY "Users can view own FTP history"   ON ftp_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own FTP history" ON ftp_history FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own FTP history" ON ftp_history FOR DELETE USING (auth.uid() = user_id);

-- 5. AI CHAT HISTORY
CREATE TABLE IF NOT EXISTS chat_history (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content      TEXT NOT NULL,
  context_ftp  INT,
  plan_name    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_user_date ON chat_history(user_id, created_at DESC);
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_select" ON chat_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "chat_insert" ON chat_history FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "chat_delete" ON chat_history FOR DELETE USING (auth.uid() = user_id);

-- ── AUTO-CREATE PROFILE ON SIGNUP ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
