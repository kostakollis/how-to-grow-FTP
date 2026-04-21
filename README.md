# FTP Coach — деплой на Railway

## Структура проекту
```
ftp-coach/
├── public/
│   └── index.html      ← весь фронтенд (тренувальний план + чат)
├── server.js           ← Express проксі для Gemini API
├── package.json
├── railway.json        ← конфіг для Railway
├── .env.example        ← шаблон змінних середовища
└── .gitignore
```

---

## Деплой крок за кроком

### 1. Підготуй GitHub репо

```bash
# Клонуй або створи репо, скопіюй файли проекту, потім:
git add .
git commit -m "initial commit"
git push origin main
```

### 2. Створи акаунт на Railway
Відкрий [railway.app](https://railway.app) → Sign up with GitHub

### 3. Новий проект
- Dashboard → **New Project** → **Deploy from GitHub repo**
- Вибери своє репо `ftp-coach`
- Railway автоматично знайде `railway.json` і `package.json`

### 4. Додай змінну середовища (ВАЖЛИВО)
- У проекті Railway → вкладка **Variables**
- Додай: `GEMINI_API_KEY` = `твій_ключ_з_aistudio.google.com`
- Railway автоматично перезапустить сервер

### 5. Відкрий сайт
- Вкладка **Settings** → **Domains** → згенеруй публічний URL
- Або одразу натисни **View Deployment**

---

## Локальний запуск (для тестування)

```bash
# Встанови залежності
npm install

# Створи .env файл
cp .env.example .env
# Відкрий .env і встав свій GEMINI_API_KEY

# Запусти сервер
npm start
# або для розробки з auto-reload:
npm run dev

# Відкрий браузер: http://localhost:3000
```

---

## Як отримати Gemini API ключ
1. Відкрий [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. **Create API key** → вибери проект
3. Скопіюй ключ → встав у Railway Variables або `.env`

> Ключ зберігається тільки на сервері у змінних середовища.
> Він ніколи не потрапляє у HTML або браузер клієнта.

---

## Безпека
- `.env` файл додано в `.gitignore` — не потрапить у Git
- Ключ передається тільки між сервером і Gemini API
- Клієнт (браузер) звертається тільки до `/api/gemini` на твоєму сервері

---

## Оновлення після змін
```bash
git add .
git commit -m "update"
git push origin main
# Railway автоматично зробить redeploy
```
