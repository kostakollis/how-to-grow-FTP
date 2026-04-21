const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.use(express.json());

const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath) && fs.existsSync(path.join(publicPath, 'index.html'))) {
  app.use(express.static(publicPath));
} else {
  app.use(express.static(__dirname));
}

const MODELS = [
  'llama-4-scout-17b-16e-instruct',
  'llama-4-maverick-17b-128e-instruct',
  'llama-3.3-70b-versatile',
  'llama3-70b-8192',
];

const SYSTEM_PROMPT = `You are an expert cycling coach with deep knowledge of:
- Training methodology: periodization, FTP development, zone training (Z1–Z5)
- Physiology: aerobic base, lactate threshold, VO2max, cardiac drift, fatigue management
- Ultracycling and endurance events (200–3000+ km)
- Nutrition and hydration for long-distance cycling
- Recovery protocols and training load management
- Bike fitting, gear selection, and equipment for different disciplines
- Race tactics and pacing strategy

The athlete's current parameters (FTP, HR zones, sessions/week, km/session) are provided in each message.
Be specific and practical. Always give numbers: watts, bpm, minutes, km.
Respond in the same language as the question (English, Ukrainian, or Polish).
Keep answers concise but complete. No generic advice — tailor everything to the provided athlete data.`;

async function callGroq(model, messages) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      stream: false,
    }),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

function buildMessages(message, history) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (Array.isArray(history)) {
    history.slice(-10).forEach(h => {
      const role = (h.role === 'bot' || h.role === 'model' || h.role === 'assistant')
        ? 'assistant' : 'user';
      if (h.text && h.text.trim()) messages.push({ role, content: h.text });
    });
  }
  messages.push({ role: 'user', content: message });
  return messages;
}

app.post('/api/gemini', async (req, res) => {
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY not set. Add it in Railway → Variables.' });
  }
  const { message, history } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Empty message' });

  const messages = buildMessages(message.trim(), history);
  let lastError = '';

  for (const model of MODELS) {
    try {
      console.log(`Trying: ${model}`);
      const { ok, status, data } = await callGroq(model, messages);
      if (ok) {
        const text = data.choices?.[0]?.message?.content || 'No response.';
        console.log(`OK: ${model} | tokens: ${data.usage?.total_tokens || '?'}`);
        return res.json({ reply: text, model });
      }
      lastError = data.error?.message || JSON.stringify(data);
      console.warn(`${model} → ${status}`);
      if (status === 401 || status === 403) return res.status(status).json({ error: lastError.substring(0, 300) });
    } catch (err) {
      lastError = err.message;
      console.error(`${model}:`, err.message);
    }
  }
  return res.status(429).json({ error: 'All models unavailable. Try again in a minute.' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', provider: 'Groq', keySet: !!GROQ_API_KEY, models: MODELS });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Cycling Coach (Groq) on port ${PORT} | key: ${GROQ_API_KEY ? 'SET' : 'MISSING'}`);
});
