const express = require('express');
const cors = require('cors');
const { YMApi } = require('yamd2');

const app = express();
app.use(cors());
app.use(express.json());

// ТВОИ ДАННЫЕ
const YM_TOKEN = 'y0__wgBEOqFuegIGN74BiCA46y9GTDz5ujMCH2hA2Lx9We5OvpLpIBIirJrjP0O';
const YM_UID = 2366522090;

let api;

async function initYM() {
  try {
    api = new YMApi();
    // Инициализируем API с твоим токеном
    await api.init({ access_token: YM_TOKEN, uid: YM_UID });
    console.log('✅ Яндекс.Музыка успешно подключена!');
  } catch (error) {
    console.error('❌ Ошибка подключения к Яндекс.Музыке:', error.message);
  }
}
initYM();

app.get('/api/search', async (req, res) => {
  try {
    if (!api) return res.status(503).json({ error: "Сервер еще не готов. Подождите." });
    
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: "Нет поискового запроса" });

    console.log(`Ищем: ${query}`);
    // Ищем треки в Яндекс.Музыке
    const searchResult = await api.searchTracks(query, { page: 0, pageSize: 30 });
    const tracks = searchResult.tracks?.results || [];

    // Получаем прямые ссылки для каждого трека
    const formattedTracks = await Promise.all(tracks.map(async (track) => {
      let previewUrl = null;
      try {
        // Получаем ссылку на скачивание
        const downloadInfo = await api.getTrackDownloadInfo(track.id);
        if (downloadInfo && downloadInfo.length > 0) {
           // Берем лучший доступный кодек (обычно mp3)
           previewUrl = downloadInfo[0].directLink; 
        }
      } catch (e) {
        // Если не удалось получить ссылку, просто пропускаем
      }

      return {
        trackId: track.id,
        trackName: track.title,
        artistName: track.artists?.map(a => a.name).join(', '),
        artworkUrl100: track.coverUri ? `https://${track.coverUri.replace('%%', '400x400')}` : null,
        previewUrl: previewUrl || track.id // Если ссылки нет, ставим ID, чтобы приложение не упало
      };
    }));

    // Фильтруем треки, у которых не удалось получить ссылку
    const playableTracks = formattedTracks.filter(t => t.previewUrl !== t.trackId);

    res.json({ results: playableTracks });
  } catch (error) {
    console.error('Ошибка поиска:', error.message);
    res.status(500).json({ error: "Ошибка на сервере при поиске" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
