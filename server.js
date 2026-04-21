const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(express.json());

// Виправлена логіка статичних файлів для Railway
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) {
    app.use(express.static(publicPath));
} else {
    app.use(express.static(__dirname));
}

// Gemini proxy endpoint
app.post('/api/gemini', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  const { message, history } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });

  const contents = [];

  // 1. Системна інструкція (вшита в діалог)
  contents.push({
    role: 'user',
    parts: [{ text: "Ти — персональний тренер з велоспорту. Твій атлет: Kosta, FTP ~279 W, 3.32 W/kg, вага 84 кг, спеціалізація — ultracycling 400–1000 km. Відповідай конкретно, без зайвих слів. Якщо питання про тренування — давай цифри (ватти, пульс, хвилини). Мова відповіді: та ж, що у питанні." }]
  });

  contents.push({
    role: 'model',
    parts: [{ text: "Зрозумів. Я твій тренер. Готовий працювати з твоїми показниками. Яке питання?" }]
  });

  // 2. Додаємо історію
  if (history && Array.isArray(history)) {
    history.forEach(h => {
      const role = (h.role === 'bot' || h.role === 'model') ? 'model' : 'user';
      if (h.text) {
        contents.push({ role: role, parts: [{ text: h.text }] });
      }
    });
  }

  // 3. Поточне повідомлення
  contents.push({ role: 'user', parts: [{ text: message }] });

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('API Error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'Gemini API Error' });
    }

    // ВИПРАВЛЕНО: Прибрано подвійні знаки питання, які викликали Syntax Error
    const replyText = data.candidates?.?.content?.parts?.?.text || 'Вибач, я не зміг згенерувати відповідь.';
    res.json({ reply: replyText });

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Для Railway важливо слухати 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
  console.log(`FTP Coach server running on port ${PORT}`);
});
