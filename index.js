const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const https = require('https');
const admin = require('firebase-admin'); // ДОБАВЛЕНО
const nodemailer = require('nodemailer'); // ДОБАВЛЕНО

// 👇 ТВОИ ДАННЫЕ ИЗ PROXY.MARKET 👇
const PROXY_USER = 'Ypv5C2cPFjEX';
const PROXY_PASS = 'E1SRkj2oUfG3ZJcT';
const PROXY_HOST = 'mobpool.proxy.market';
const PROXY_PORT = '10000';

const PROXY_URL = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}`;
// 👆 ТВОИ ДАННЫЕ ИЗ PROXY.MARKET 👆

const proxyAgent = new HttpsProxyAgent(PROXY_URL);
https.globalAgent = proxyAgent;

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
    console.log('✅ Яндекс.Музыка успешно подключена!');
  } catch (error) {
    console.error('❌ Ошибка подключения:', error.message);
  }
}
initYM();

// --- ТВОИ СТАРЫЕ ЭНДПОИНТЫ ---

app.get('/api/check-ip', async (req, res) => {
  try {
    const response = await axios.get('https://ipinfo.io/json', { httpsAgent: proxyAgent });
    res.json({ country: response.data.country, isp: response.data.org });
  } catch (error) {
    res.status(500).json({ error: "Прокси не отвечает: " + error.message });
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

// --- НОВАЯ ЛОГИКА FIREBASE И ПОЧТЫ ---

// 1. Инициализация Firebase
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (serviceAccount && serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
} catch (e) {
  console.error("Ошибка чтения FIREBASE_SERVICE_ACCOUNT. Проверь переменные на Render!");
}

if (serviceAccount && !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

// 2. Настройка почты
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const verificationCodes = new Map();

// 3. Эндпоинт отправки кода
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

// 4. Эндпоинт проверки кода
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

// 5. Эндпоинт сброса сессий
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

// --- ЗАПУСК СЕРВЕРА (ТОЛЬКО ОДИН РАЗ В КОНЦЕ) ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
