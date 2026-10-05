# Заява на Лимузинова

Telegram Web App-пародия: пользователь создаёт **игровые вымышленные заявления**, получает RP и виртуальные «З», улучшает заявы в серверном апгрейдере и крутит колесо с виртуальными наградами.

> Никакие формы из приложения не отправляются в МВД, полицию, Госуслуги или другие реальные организации.

## Запуск

```bash
cp .env.example .env
npm install
npm run dev
```

Frontend: `http://localhost:5173`  
API: `http://localhost:8787`

Production:

```bash
npm run build
npm start
```

Express в production сам раздаёт `dist/`.

## Telegram

1. Укажи `BOT_TOKEN` в `.env`.
2. Установи публичный HTTPS URL приложения для Web App `zayava` в `@BotFather`/настройках существующего бота.
3. Открывай через `https://t.me/perekup_app_bot/zayava`.
4. На production поставь `ALLOW_DEMO_AUTH=false`, чтобы API принимал только валидный Telegram `initData`.

## Что реализовано

- Telegram `initData` validation на сервере.
- SQLite + WAL.
- Создание/оценка заявы, защита от простого спама и повторов.
- Редкость, стоимость, RP, баланс.
- Серверный апгрейд x1.5/x2/x3/x5 с транзакционным списанием заявы.
- Колесо: сервер выбирает награду, клиент только анимирует результат.
- 12-часовое бесплатное вращение + дополнительное за виртуальные 250 З.
- Рейтинг день/неделя/месяц/всё время.
- Профиль и статистика.
- Мобильная Telegram UI, safe-area, haptic feedback.
- Demo auth для локальной разработки.

## Переменные

- `PORT` — API/production порт.
- `BOT_TOKEN` — токен Telegram-бота для проверки `initData`.
- `ALLOW_DEMO_AUTH` — `true` локально, `false` на production.
- `DATABASE_PATH` — путь к SQLite.
