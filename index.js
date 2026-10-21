const express = require('express');
const cors = require('cors');
const app = express();

// Разрешаем твоему приложению на телефоне делать запросы к этому серверу
app.use(cors()); 
app.use(express.json());

// Адрес, по которому мы будем проверять работу
app.get('/api/hello', (req, res) => {
  res.json({ message: "Сервер работает! Ура!" });
});

// Render сам выдаст нужный порт
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
