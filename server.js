const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.use(express.json());

// Static files — works with /public subfolder or root
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath) && fs.existsSync(path.join(publicPath, 'index.html'))) {
  app.use(express.static(publicPath));
} else {
  app.use(express.static(__dirname));
}

// Groq models у порядку пріоритету (всі безкоштовні)
const MODELS = [
  'llama-4-scout-17b-16e-instruct', // найновіший Llama 4
  'llama-4-maverick-17b-128e-instruct',
  'llama-3.3-70b-versatile',        // перевірений fallback
  'llama3-70b-8192',                // класичний fallback
];

const SYSTEM_PROMPT = `Ти — персональний тренер з велоспорту. Запитай у атлета вік, вагу, FTP, спеціалізацію та очікування.  
Відповідай конкретно, без зайвих слів. Якщо питання про тренування — давай цифри (ватти, пульс, хвилини). 
Мова відповіді: та ж, що у питанні (українська або польська).`;

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
      if (h.text && h.text.trim()) {
        messages.push({ role, content: h.text });
      }
    });
  }

  messages.push({ role: 'user', content: message });
  return messages;
}

// Proxy endpoint (залишаємо /api/gemini щоб не міняти index.html)
app.post('/api/gemini', async (req, res) => {
  if (!GROQ_API_KEY) {
    return res.status(500).json({
      error: 'GROQ_API_KEY не налаштований. Додай змінну на Railway → Variables → GROQ_API_KEY.',
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
      const { ok, status, data } = await callGroq(model, messages);

      if (ok) {
        const text = data.choices &&
          data.choices[0] &&
          data.choices[0].message &&
          data.choices[0].message.content
            ? data.choices[0].message.content
            : 'Не вдалось отримати відповідь.';
        const tokens = data.usage ? data.usage.total_tokens : '?';
        console.log(`OK: ${model} | tokens: ${tokens}`);
        return res.json({ reply: text, model });
      }

      const errMsg = (data.error && data.error.message)
        ? data.error.message : JSON.stringify(data);
      console.warn(`${model} → ${status}: ${errMsg.substring(0, 120)}`);
      lastError = errMsg;

      if (status === 404) { continue; }   // модель не знайдена — наступна
      if (status === 429) { continue; }   // rate limit — наступна
      if (status === 503) { continue; }   // перевантаження — наступна

      // 401 неправильний ключ — немає сенсу пробувати далі
      return res.status(status).json({ error: errMsg.substring(0, 300) });

    } catch (err) {
      console.error(`${model} exception:`, err.message);
      lastError = err.message;
    }
  }

  return res.status(429).json({
    error: 'Groq недоступний. Ліміт вичерпано або всі моделі зайняті. Спробуй за хвилину.',
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    provider: 'Groq',
    keySet: !!GROQ_API_KEY,
    models: MODELS,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FTP Coach (Groq) on port ${PORT} | key: ${GROQ_API_KEY ? 'SET' : 'MISSING'}`);
});
