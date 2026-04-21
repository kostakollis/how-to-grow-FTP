const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const fs = require('fs');
const staticDir = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
app.use(express.static(staticDir));

// Gemini proxy endpoint
app.post('/api/gemini', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  const { message, history } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });

  // Формуємо масив contents
  const contents = [];

  // 1. Додаємо роль тренера як перше повідомлення в контексті
  contents.push({
    role: 'user',
    parts: [{ text: `Ти — персональний тренер з велоспорту. Запитай у атлета вік, вагу, FTP, спеціалізацію та очікування.  
Відповідай конкретно, без зайвих слів. Якщо питання про тренування — давай цифри (ватти, пульс, хвилини). 
Мова відповіді: та ж, що у питанні (українська або польська).` }]
  });

  // 2. Імітуємо підтвердження від моделі
  contents.push({
    role: 'model',
    parts: [{ text: "Так, я зрозумів. Я твій тренер. Готовий аналізувати твої показники та давати плани на ультрадистанції. Яке питання на сьогодні?" }]
  });

  // 3. Додаємо реальну історію розмови з фронтенду
  if (history && Array.isArray(history)) {
    history.forEach(h => {
      // Важливо: Google очікує ролі 'user' та 'model'
      const role = (h.role === 'bot' || h.role === 'model') ? 'model' : 'user';
      contents.push({ role: role, parts: [{ text: h.text }] });
    });
  }

  // 4. Додаємо поточне повідомлення користувача
  contents.push({ role: 'user', parts: [{ text: message }] });

  try {
    // Використовуємо СТАБІЛЬНУ версію v1 та модель gemini-1.5-flash
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

    if (!response.ok) {
      const errText = await response.text();
      console.error('API Error:', errText);
      return res.status(response.status).json({ error: 'Gemini API Error' });
    }

    const data = await response.json();
    const replyText = data.candidates?.?.content?.parts?.?.text || '';
    res.json({ reply: replyText });

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`FTP Coach server running on port ${PORT}`);
});
