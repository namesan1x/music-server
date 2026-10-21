const express = require('express');
const cors = require('cors');
const { YMApi, WrappedYMApi } = require('yamd2');

const app = express();
app.use(cors());
app.use(express.json());

// Принудительно используем HTTPS для всех запросов
const https = require('https');
const http = require('http');
http.globalAgent = new https.Agent({ keepAlive: true });
https.globalAgent = new https.Agent({ keepAlive: true });

const YM_TOKEN = 'y0__wgBEOqFuegIGN74BiCA46y9GTDz5ujMCH2hA2Lx9We5OvpLpIBIirJrjP0O';
const YM_UID = 2366522090;

let api;
let wrappedApi;

async function initYM() {
  try {
    api = new YMApi();
    await api.init({ access_token: YM_TOKEN, uid: YM_UID });
    wrappedApi = new WrappedYMApi();
    await wrappedApi.init({ access_token: YM_TOKEN, uid: YM_UID });
    console.log('✅ Яндекс.Музыка успешно подключена (HTTPS)!');
  } catch (error) {
    console.error('❌ Ошибка подключения к Яндекс.Музыке:', error.message);
  }
}
initYM();

app.get('/api/search', async (req, res) => {
  try {
    if (!api || !wrappedApi) return res.status(503).json({ error: "Сервер еще не готов. Подождите." });
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: "Нет поискового запроса" });

    console.log(`Ищем: ${query}`);
    const searchResult = await api.search.tracks(query, { page: 0, pageSize: 30 });
    const tracks = searchResult.tracks?.results || [];

    const formattedTracks = await Promise.all(tracks.map(async (track) => {
      let previewUrl = null;
      try {
        previewUrl = await wrappedApi.getBestDownloadUrl(track.id);
      } catch (e) {
        console.error(`Не удалось получить ссылку для трека ${track.id}:`, e.message);
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
    res.json({ results: playableTracks });
  } catch (error) {
    console.error('Ошибка поиска:', error.message);
    res.status(500).json({ error: "Ошибка на сервере при поиске" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
