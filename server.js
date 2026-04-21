const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const GROK_API_KEY = process.env.GROK_API_KEY;

app.use(express.json());

// Static files — works with /public or root
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath) && fs.existsSync(path.join(publicPath, 'index.html'))) {
  app.use(express.static(publicPath));
} else {
  app.use(express.static(__dirname));
}

// Grok models in priority order
const MODELS = [
  'grok-3-mini',   // найшвидший і найдешевший
  'grok-3',        // потужніший
  'grok-2',        // fallback
];

const SYSTEM_PROMPT = `Ти — персональний тренер з велоспорту. Запитай у атлета вік, вагу, FTP, спеціалізацію та очікування.  
Відповідай конкретно, без зайвих слів. Якщо питання про тренування — давай цифри (ватти, пульс, хвилини). 
Мова відповіді: та ж, що у питанні (українська або польська).`;

async function callGrok(apiKey, model, messages) {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
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
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  if (Array.isArray(history)) {
    history.slice(-10).forEach(h => {
      const role = (h.role === 'bot' || h.role === 'model' || h.role === 'assistant')
        ? 'assistant'
        : 'user';
      if (h.text && h.text.trim()) {
        messages.push({ role, content: h.text });
      }
    });
  }

  messages.push({ role: 'user', content: message });
  return messages;
}

// Grok proxy endpoint
app.post('/api/gemini', async (req, res) => {
  if (!GROK_API_KEY) {
    return res.status(500).json({
      error: 'GROK_API_KEY не налаштований. Додай змінну на Railway → Variables.',
    });
  }

  const { message, history } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Повідомлення порожнє' });
  }

  const messages = buildMessages(message.trim(), history);
  let lastError = '';

  for (const model of MODELS) {
    try {
      console.log(`Trying: ${model}`);
      const { ok, status, data } = await callGrok(GROK_API_KEY, model, messages);

      if (ok) {
        const text =
          data.choices &&
          data.choices[0] &&
          data.choices[0].message &&
          data.choices[0].message.content
            ? data.choices[0].message.content
            : 'Не вдалось отримати відповідь.';
        console.log(`OK: ${model} | tokens: ${data.usage ? data.usage.total_tokens : '?'}`);
        return res.json({ reply: text, model });
      }

      const errMsg = (data.error && data.error.message)
        ? data.error.message
        : JSON.stringify(data);
      console.warn(`${model} -> ${status}: ${errMsg.substring(0, 120)}`);
      lastError = errMsg;

      // 429 rate limit — спробуємо наступну модель
      if (status === 429) { continue; }
      // 404 модель не знайдена — наступна
      if (status === 404) { continue; }
      // 401/403 — неправильний ключ, немає сенсу далі
      return res.status(status).json({ error: errMsg.substring(0, 400) });

    } catch (err) {
      console.error(`${model} exception:`, err.message);
      lastError = err.message;
    }
  }

  return res.status(429).json({
    error: 'Всі моделі недоступні. Перевір ключ або спробуй пізніше.',
    detail: lastError.substring(0, 200),
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    provider: 'xAI Grok',
    keySet: !!GROK_API_KEY,
    models: MODELS,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FTP Coach (Grok) on port ${PORT} | key: ${GROK_API_KEY ? 'SET' : 'MISSING'}`);
});
