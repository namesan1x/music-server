const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const https = require('https');

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

const YM_TOKEN = 'y0__wgBEOqFuegIGN74BiCA46y9GTDz5ujMCH2hA2Lx9We5OvpLpIBIirJrjP0O'; // Убедись, что тут новый токен!
const YM_UID = 2366522090;

app.get('/api/check-ip', async (req, res) => {
  try {
    const response = await axios.get('https://ipinfo.io/json', { httpsAgent: proxyAgent });
    res.json({ country: response.data.country, isp: response.data.org });
  } catch (error) {
    res.status(500).json({ error: "Прокси не отвечает: " + error.message });
  }
});

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

app.get('/api/search', async (req, res) => {
  try {
    if (!api || !wrappedApi) return res.status(503).json({ error: "Сервер еще не готов." });
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: "Нет запроса" });

    console.log(`Ищем: ${query}`);
    const searchResult = await api.search.tracks(query, { page: 0, pageSize: 30 });
    const tracks = searchResult.tracks?.results || [];
    
    console.log(`Найдено треков в API Яндекса: ${tracks.length}`);

    let errors = [];

    const formattedTracks = await Promise.all(tracks.map(async (track) => {
      let previewUrl = null;
      
      // 1. Пытаемся получить FLAC
      try {
        const flacInfo = await wrappedApi.getDownloadInfo(track.id, { codec: "flac" });
        previewUrl = flacInfo?.[0]?.directLink;
      } catch (e) {
        // Если FLAC недоступен (нет Плюса), игнорируем и идем дальше
      }

      // 2. Если FLAC не дал ссылку, пытаемся получить MP3
      if (!previewUrl) {
        try {
          const mp3Info = await wrappedApi.getDownloadInfo(track.id, { codec: "mp3" });
          previewUrl = mp3Info?.[0]?.directLink;
        } catch (e) {
          errors.push(`Ошибка MP3 для ${track.title}: ${e.message}`);
        }
      }

      if (!previewUrl) {
        errors.push(`Нет ссылки для ${track.title}`);
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
    
    // Если ничего не нашли, выводим отладку (что именно пошло не так)
    if (playableTracks.length === 0) {
      return res.json({
        results: [],
        debug_info: {
          total_tracks_found: tracks.length,
          errors: errors.slice(0, 5) // Показываем первые 5 ошибок
        }
      });
    }

    res.json({ results: playableTracks });
  } catch (error) {
    console.error('Ошибка поиска:', error.message);
    res.status(500).json({ error: "Ошибка поиска: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
