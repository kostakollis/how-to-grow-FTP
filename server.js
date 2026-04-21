const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(express.json());

// Static files — працює і з public/ і без
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
} else {
  app.use(express.static(__dirname));
}

// Моделі в порядку пріоритету — якщо перша недоступна, пробує наступну
const MODELS = [
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash',
  'gemini-1.5-pro-latest',
  'gemini-pro',
];

async function callGemini(apiKey, model, contents) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    }),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

// Gemini proxy endpoint
app.post('/api/gemini', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY не налаштований на сервері' });
  }

  const { message, history } = req.body;
  if (!message) return res.status(400).json({ error: 'Повідомлення порожнє' });

  // Будуємо contents: системна інструкція + історія + поточне повідомлення
  const contents = [];

  // Системна інструкція через перший user/model обмін
  contents.push({
    role: 'user',
    parts: [{ text: 'Ти — персональний тренер з велоспорту. Твій атлет: Kosta, FTP ~279 W, 3.32 W/kg, вага 84 кг, спеціалізація — ultracycling 400–1000 km. Відповідай конкретно, без зайвих слів. Якщо питання про тренування — давай цифри (ватти, пульс, хвилини). Мова відповіді: та ж, що у питанні (українська або польська).' }],
  });
  contents.push({
    role: 'model',
    parts: [{ text: 'Зрозумів. Готовий. Яке питання?' }],
  });

  // Історія попередніх повідомлень
  if (Array.isArray(history)) {
    history.forEach(h => {
      const role = (h.role === 'bot' || h.role === 'model') ? 'model' : 'user';
      if (h.text && h.text.trim()) {
        contents.push({ role, parts: [{ text: h.text }] });
      }
    });
  }

  // Поточне повідомлення
  contents.push({ role: 'user', parts: [{ text: message }] });

  // Пробуємо моделі по черзі
  let lastError = null;
  for (const model of MODELS) {
    try {
      const { ok, status, data } = await callGemini(GEMINI_API_KEY, model, contents);

      if (ok) {
        const text = (data.candidates &&
                      data.candidates[0] &&
                      data.candidates[0].content &&
                      data.candidates[0].content.parts &&
                      data.candidates[0].content.parts[0] &&
                      data.candidates[0].content.parts[0].text)
          ? data.candidates[0].content.parts[0].text
          : 'Вибач, не вдалося отримати відповідь.';
        console.log(`OK: model=${model}`);
        return res.json({ reply: text, model });
      }

      // 429 = quota, 404 = модель не знайдена — пробуємо наступну
      if (status === 429 || status === 404) {
        console.warn(`Skip model=${model} status=${status}`);
        lastError = data.error && data.error.message ? data.error.message : JSON.stringify(data);
        continue;
      }

      // Інша помилка — повертаємо одразу
      console.error(`Error model=${model} status=${status}`, data);
      return res.status(status).json({
        error: data.error && data.error.message ? data.error.message : 'Gemini API error',
      });

    } catch (err) {
      console.error(`Exception model=${model}:`, err.message);
      lastError = err.message;
    }
  }

  // Всі моделі вичерпані
  return res.status(429).json({
    error: 'Всі доступні моделі недоступні або перевищена квота. Спробуй за кілька хвилин.',
    detail: lastError,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FTP Coach server running on port ${PORT}`);
});
