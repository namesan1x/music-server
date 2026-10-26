const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// ❌ УДАЛЕНО: const { HttpsProxyAgent } = require('https-proxy-agent');
// ❌ УДАЛЕНО: const https = require('https');

// ❌ УДАЛЕНО: Все переменные PROXY_USER, PROXY_PASS, PROXY_HOST, PROXY_PORT, PROXY_URL
// ❌ УДАЛЕНО: const proxyAgent = new HttpsProxyAgent(PROXY_URL);
// ❌ УДАЛЕНО: https.globalAgent = proxyAgent;

const app = express();
app.use(cors());
app.use(express.json());

const YM_TOKEN = 'y0__wgBEOqFuegIGN74BiDK89m-GSEPFhTXV_GJfDSg1Lc9qqVU9KLB'; 
const YM_UID = 2366522090;

let api;
let wrappedApi;

async function initYM() {
  try {
    const { YMApi, WrappedYMApi } = await import('yamd2');
    api = new YMApi();
    await api.init({ access_token: YM_TOKEN, uid: YM_UID });
    wrappedApi = new WrappedYMApi();
    await wrappedApi.init({ access_token: YM_TOKEN, uid: YM_UID });
    console.log('✅ Яндекс.Музыка успешно подключена (напрямую из РФ)!');
  } catch (error) {
    console.error('❌ Ошибка подключения к ЯМ:', error.message);
  }
}
initYM();

// Эндпоинт для проверки, что сервер работает и видит российский IP
app.get('/api/check-ip', async (req, res) => {
  try {
    // Теперь запрос идет напрямую, без прокси
    const response = await axios.get('https://ipinfo.io/json');
    res.json({ country: response.data.country, isp: response.data.org });
  } catch (error) {
    res.status(500).json({ error: "Ошибка проверки IP: " + error.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    if (!api || !wrappedApi) return res.status(503).json({ error: "Сервер еще не готов." });
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: "Нет запроса" });

    console.log(`Ищем: ${query}`);
    const searchResult = await api.search.tracks(query, { page: 0, pageSize: 30 });
    const tracks = searchResult.tracks?.results || [];
    
    console.log(`Найдено треков: ${tracks.length}`);

    let errors = [];

    const formattedTracks = await Promise.all(tracks.map(async (track) => {
      let previewUrl = null;
      
      try {
        previewUrl = await wrappedApi.getBestDownloadUrl(track.id);
      } catch (e) {
        errors.push(`getBestDownloadUrl для ${track.title}: ${e.message}`);
      }

      if (!previewUrl) {
        try {
          previewUrl = await wrappedApi.getMp3DownloadUrl(track.id);
        } catch (e) {
          errors.push(`getMp3DownloadUrl для ${track.title}: ${e.message}`);
        }
      }

      if (!previewUrl) {
        try {
          const info = await wrappedApi.getDownloadInfo(track.id, { codec: 'mp3' });
          if (info && info.length > 0) {
            previewUrl = info[0].directLink || info[0].downloadUrl || info[0].url;
            if (!previewUrl) {
              errors.push(`getDownloadInfo вернул объект без ссылки для ${track.title}`);
            }
          } else {
            errors.push(`getDownloadInfo вернул пустой массив для ${track.title}`);
          }
        } catch (e) {
          errors.push(`getDownloadInfo для ${track.title}: ${e.message}`);
        }
      }

      return {
        trackId: track.id,
        trackName: track.title,
        artistName: track.artists?.map(a => a.name).join(', '),
        artworkUrl100: track.coverUri ? `https://${track.coverUri.replace('%%', '400x400')}` : null,
        previewUrl: previewUrl
      };
    }));

    const playableTracks = formattedTracks.filter(t => t.previewUrl);
    
    if (playableTracks.length === 0) {
      return res.json({
        results: [],
        debug_info: {
          total_tracks_found: tracks.length,
          errors: errors.slice(0, 10)
        }
      });
    }

    res.json({ results: playableTracks });
  } catch (error) {
    console.error('Ошибка поиска:', error.message);
    res.status(500).json({ error: "Ошибка поиска: " + error.message });
  }
});

// --- ЛОГИКА FIREBASE И ПОЧТЫ (без изменений) ---

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (serviceAccount && serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
} catch (e) {
  console.error("Ошибка чтения FIREBASE_SERVICE_ACCOUNT. Проверь переменные на Amvera!");
}

if (serviceAccount && !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const verificationCodes = new Map();

app.post('/api/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email обязателен' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  verificationCodes.set(email, code);

  try {
    await transporter.sendMail({
      from: '"n.smusic" <no-reply@nsmusic.com>',
      to: email,
      subject: 'Код подтверждения n.smusic',
      html: `<h2>Ваш код: <b>${code}</b></h2>`
    });
    res.json({ success: true, message: 'Код отправлен' });
  } catch (error) {
    console.error("Ошибка отправки письма:", error);
    res.status(500).json({ error: 'Ошибка отправки' });
  }
});

app.post('/api/verify-code', (req, res) => {
  const { email, code } = req.body;
  const savedCode = verificationCodes.get(email);
  
  if (savedCode && savedCode === code) {
    verificationCodes.delete(email);
    res.json({ success: true, message: 'Код верный' });
  } else {
    res.status(400).json({ error: 'Неверный код' });
  }
});

app.post('/api/revoke-sessions', async (req, res) => {
  const { uid } = req.body;
  try {
    await admin.auth().revokeRefreshTokens(uid);
    res.json({ success: true, message: 'Сессии завершены' });
  } catch (error) {
    console.error("Ошибка сброса сессий:", error);
    res.status(500).json({ error: 'Ошибка сброса' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
