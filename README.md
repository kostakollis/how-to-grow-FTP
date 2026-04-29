# Cycling Training Plan v3.1 — Full Setup Guide

## Architecture

```
Browser → index.html (welcome + auth + dashboard)
              ↓ loads
          app.html (training plan app)
              ↓ API calls
          server.js (Express)
              ├── /api/gemini → Groq LLM
              ├── /api/user/* → Supabase DB (auth-protected)
              └── /public     → static files
```

---

## Step 1 — Supabase Setup (5 min)

1. Go to [supabase.com](https://supabase.com) → New project
2. In **SQL Editor** → run `supabase-setup.sql` (creates all tables + RLS)
3. In **Authentication** → Providers → enable **Google** and **Apple**:
   - Google: create OAuth app at [console.cloud.google.com](https://console.cloud.google.com), add redirect URL
   - Apple: create App ID + Service ID at [developer.apple.com](https://developer.apple.com)
4. In **Settings → API** → copy:
   - Project URL → `SUPABASE_URL`
   - `anon` public key → `SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_KEY`

---

## Step 2 — Inject Supabase keys into frontend

In `server.js`, add this route **before** `app.use(express.static(...))`:

```javascript
app.get('/', (req, res) => {
  let html = fs.readFileSync(path.join(publicPath, 'index.html'), 'utf8');
  html = html.replace('window.__SB_URL__ || \'\'', `'${process.env.SUPABASE_URL || ''}'`);
  html = html.replace('window.__SB_KEY__ || \'\'', `'${process.env.SUPABASE_ANON_KEY || ''}'`);
  res.send(html);
});
```

> The `anon` key is safe to expose in frontend — security is enforced by Row Level Security in the database.

---

## Step 3 — Railway Variables

Add these in Railway → Variables:
```
GROQ_API_KEY        = gsk_...
SUPABASE_URL        = https://xxxx.supabase.co
SUPABASE_ANON_KEY   = eyJ...
SUPABASE_SERVICE_KEY = eyJ...
```

---

## Step 4 — Deploy

```bash
git add .
git commit -m "v3.1 with auth + dashboard"
git push origin main
```
Railway auto-deploys on push.

---

## Features per user

| Feature | Guest | Signed in |
|---------|-------|-----------|
| Training plan | ✓ | ✓ |
| Zone calculation | ✓ | ✓ |
| Download .fit/.zwo | ✓ | ✓ |
| AI coach | ✓ | ✓ |
| Save athlete profile | ✗ | ✓ (auto) |
| Save plans | ✗ | ✓ |
| FTP history + chart | ✗ | ✓ |
| Load previous plans | ✗ | ✓ |

---

## Local dev

```bash
npm install
cp .env.example .env   # fill in keys
npm run dev
# open http://localhost:3000
```

---

## Supabase table schema (summary)

| Table | Description |
|-------|-------------|
| `profiles` | auto-created on signup |
| `athlete_data` | FTP, age, weight, HR, settings (1 row/user) |
| `ftp_history` | FTP test entries with date, type, notes |
| `training_plans` | saved generated plans (JSON) |
