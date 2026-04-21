const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(express.json());
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

  const contents = [];

  // Конвертуємо історію, перевіряючи ролі (user/model)
  if (history && Array.isArray(history)) {
    history.forEach(h => {
      // Важливо: роль бота для Google API — "model"
      const role = h.role === 'bot' || h.role === 'model' ? 'model' : 'user';
      contents.push({ role: role, parts: [{ text: h.text }] });
    });
  }

  contents.push({ role: 'user', parts: [{ text: message }] });

  try {
    // Використовуємо стабільну модель 1.5 Flash
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: {
          parts: [{
            text: `Ти — персональний тренер з велоспорту. Твій атлет: Kosta, FTP ~279 W, 3.32 W/kg, вага 84 кг, спеціалізація — ultracycling 400–1000 km. 
Відповідай конкретно, без зайвих слів. Якщо питання про тренування — давай цифри (ватти, пульс, хвилини). 
Мова відповіді: та ж, що у питанні (українська або польська).`
          }]
        },
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024
        }
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      console.error('Gemini API Error:', errData);
      return res.status(response.status).json({ error: errData.error?.message || 'API Error' });
    }

    const data = await response.json();
    const text = data.candidates?.?.content?.parts?.?.text || '';
    res.json({ reply: text });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
