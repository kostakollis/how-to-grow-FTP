const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');
const fs      = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── ENV VARS (set in Railway Variables) ───────────────────────────────────
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // for admin ops

app.use(express.json({ limit: '2mb' }));

// ── STATIC FILES + KEY INJECTION ─────────────────────────────────────────
const publicPath = path.join(__dirname, 'public');
const rootPath   = fs.existsSync(path.join(publicPath, 'index.html')) ? publicPath : __dirname;

// Inject Supabase anon key into index.html at runtime (anon key is safe client-side)
app.get('/', (req, res) => {
  const indexPath = path.join(rootPath, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html
    .replace("window.__SB_URL__ || ''", `'${SUPABASE_URL || ''}'`)
    .replace("window.__SB_KEY__ || ''", `'${SUPABASE_ANON_KEY || ''}'`);
  res.type('html').send(html);
});

app.use(express.static(rootPath));

// ── SUPABASE ADMIN CLIENT (server-side only) ──────────────────────────────
let supabaseAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────
// Verifies Supabase JWT from Authorization header
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token provided' });

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Supabase not configured — skip auth (dev mode)
    req.userId = 'dev-user';
    return next();
  }

  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid token' });
    req.userId = user.id;
    req.user   = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Auth error: ' + err.message });
  }
}

// ── GROQ PROXY ────────────────────────────────────────────────────────────
const GROQ_MODELS = [
  'llama-4-scout-17b-16e-instruct',
  'llama-4-maverick-17b-128e-instruct',
  'llama-3.3-70b-versatile',
  'llama3-70b-8192',
];

const SYSTEM_PROMPT = `You are an expert cycling coach with deep knowledge of:
- Training methodology: periodization, FTP development, zone training (Z1–Z5)
- Physiology: aerobic base, lactate threshold, VO2max, cardiac drift, fatigue
- Ultracycling and endurance events (200–3000+ km)
- Nutrition and hydration for long-distance cycling
- Recovery protocols and training load management
Be specific and practical. Always give numbers: watts, bpm, minutes, km.
Respond in the same language as the question (English, Ukrainian, or Polish).`;

async function callGroq(model, messages) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 1024, stream: false }),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

app.post('/api/gemini', async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not set' });
  const { message, history } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Empty message' });

  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (Array.isArray(history)) {
    history.slice(-10).forEach(h => {
      const role = (h.role === 'bot' || h.role === 'model' || h.role === 'assistant') ? 'assistant' : 'user';
      if (h.text?.trim()) messages.push({ role, content: h.text });
    });
  }
  messages.push({ role: 'user', content: message.trim() });

  let lastError = '';
  for (const model of GROQ_MODELS) {
    try {
      const { ok, status, data } = await callGroq(model, messages);
      if (ok) {
        const text = data.choices?.[0]?.message?.content || 'No response.';
        return res.json({ reply: text, model });
      }
      lastError = data.error?.message || JSON.stringify(data);
      if (status === 401 || status === 403) return res.status(status).json({ error: lastError.substring(0, 300) });
    } catch (err) {
      lastError = err.message;
    }
  }
  return res.status(429).json({ error: 'All models unavailable. Try again in a minute.' });
});

// ── USER DATA ENDPOINTS ───────────────────────────────────────────────────

// GET /api/user/data — load athlete data + FTP history + plans list
app.get('/api/user/data', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ athlete: null, ftpHistory: [], plans: [] });
  try {
    const uid = req.userId;
    const [athleteRes, ftpRes, plansRes] = await Promise.all([
      supabaseAdmin.from('athlete_data').select('*').eq('user_id', uid).single(),
      supabaseAdmin.from('ftp_history').select('*').eq('user_id', uid).order('test_date', { ascending: false }).limit(50),
      supabaseAdmin.from('training_plans').select('id,name,ftp,weeks,sessions_week,km_session,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(20),
    ]);
    res.json({
      athlete:    athleteRes.data  || null,
      ftpHistory: ftpRes.data      || [],
      plans:      plansRes.data    || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/athlete — save/update athlete profile
app.post('/api/user/athlete', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ ok: true });
  try {
    const { error } = await supabaseAdmin.from('athlete_data').upsert(
      { user_id: req.userId, ...req.body, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/ftp — add FTP measurement to history
app.post('/api/user/ftp', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ ok: true });
  try {
    const { ftp_value, weight, test_type, notes, test_date } = req.body;
    const wpkg = weight ? +(ftp_value / weight).toFixed(2) : null;
    const { error } = await supabaseAdmin.from('ftp_history').insert({
      user_id: req.userId, ftp_value, weight, wpkg, test_type, notes, test_date,
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/user/ftp/:id
app.delete('/api/user/ftp/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ ok: true });
  try {
    const { error } = await supabaseAdmin.from('ftp_history')
      .delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/plans — save training plan
app.post('/api/user/plans', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ ok: true });
  try {
    const { name, ftp, weeks, sessions_week, km_session, plan_data } = req.body;
    const { error } = await supabaseAdmin.from('training_plans').insert({
      user_id: req.userId, name, ftp, weeks, sessions_week, km_session, plan_data,
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/user/plans/:id
app.delete('/api/user/plans/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ ok: true });
  try {
    const { error } = await supabaseAdmin.from('training_plans')
      .delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CHAT HISTORY ENDPOINTS ───────────────────────────────────────────────

// GET /api/user/chat — last 60 messages
app.get('/api/user/chat', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ messages: [] });
  try {
    const { data, error } = await supabaseAdmin
      .from('chat_history')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) throw error;
    res.json({ messages: (data || []).reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/chat — save one message pair (user + assistant)
app.post('/api/user/chat', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ ok: true });
  try {
    const { userMsg, assistantMsg, context_ftp, plan_name } = req.body;
    const rows = [];
    if (userMsg)     rows.push({ user_id: req.userId, role: 'user',      content: userMsg,      context_ftp, plan_name });
    if (assistantMsg) rows.push({ user_id: req.userId, role: 'assistant', content: assistantMsg, context_ftp, plan_name });
    if (rows.length) {
      const { error } = await supabaseAdmin.from('chat_history').insert(rows);
      if (error) throw error;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/user/chat — clear all chat history
app.delete('/api/user/chat', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ ok: true });
  try {
    const { error } = await supabaseAdmin.from('chat_history').delete().eq('user_id', req.userId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HEALTH CHECK ─────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  groq: !!GROQ_API_KEY,
  supabase: !!supabaseAdmin,
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Cycling Coach on port ${PORT} | Groq: ${GROQ_API_KEY ? 'SET' : 'MISSING'} | Supabase: ${supabaseAdmin ? 'SET' : 'MISSING'}`);
});
