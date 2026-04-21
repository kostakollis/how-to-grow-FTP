const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Gemini proxy endpoint
app.post('/api/gemini', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  const { message, history } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });

  const contents = [];

  // Add conversation history
  if (history && Array.isArray(history)) {
    history.forEach(h => {
      contents.push({ role: h.role, parts: [{ text: h.text }] });
    });
  }

  // Add current user message
  contents.push({ role: 'user', parts: [{ text: message }] });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
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
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ reply: text });

  } catch (err) {
    console.error('Gemini error:', err);
    res.status(500).json({ error: 'Proxy error: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`FTP Coach server running on port ${PORT}`);
});
