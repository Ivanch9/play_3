#!/usr/bin/env bash
# Запуск игры: статический сервер только на localhost (наружу порт не открывается).
# Подключение с локальной машины:  ssh -L 8080:localhost:8080 <user>@<server>
# Затем открыть в браузере:         http://localhost:8080
PORT="${1:-8080}"
cd "$(dirname "$0")"
echo "Lightspeed: http://localhost:${PORT}  (Ctrl+C — остановить)"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
