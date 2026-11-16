#!/usr/bin/env bash
# bash scripts/verify-image.sh <образ> [очікуваний git sha]
# Перевіряє образ так, як цього вимагає лаба 8:
#   - розмір менший за 200 МБ
#   - процес не від root, у фінальному образі немає dev-залежностей
#   - команда запуску: node і файл, а не npm
#   - HEALTHCHECK є і стає healthy, /health віддає sha, /ready відповідає 200
#   - docker stop завершує процес з кодом 0 менше ніж за 10 с, клієнт отримує shutdown і код 1001
set -euo pipefail

IMAGE="${1:?usage: verify-image.sh <image> [sha]}"
EXPECTED_SHA="${2:-}"
NAME="dogfight-verify-$$"
PORT="${PORT:-3999}"
fail() { echo "FAIL: $*" >&2; docker logs "$NAME" 2>&1 | tail -20 >&2 || true; docker rm -f "$NAME" >/dev/null 2>&1 || true; exit 1; }
pass() { echo "ok:   $*"; }

# 1. розмір: уся файлова система контейнера (однаково для будь-якого сховища образів)
SIZE_MB=$(docker run --rm --entrypoint sh "$IMAGE" -c 'du -sm / 2>/dev/null | tail -1 | cut -f1')
[ "$SIZE_MB" -lt 200 ] || fail "образ $SIZE_MB МБ, ліміт 200"
pass "розмір образу $SIZE_MB МБ (< 200)"

# 2. не root
USER_ID=$(docker run --rm --entrypoint id "$IMAGE" -u)
[ "$USER_ID" != "0" ] || fail "процес у контейнері від root"
pass "процес не від root (uid $USER_ID)"

# 3. команда запуску
CMD=$(docker image inspect "$IMAGE" --format '{{json .Config.Cmd}}')
[[ "$CMD" == '["node","server/src/index.ts"]' ]] || fail "CMD має бути node + файл, а є $CMD"
pass "CMD $CMD (SIGTERM іде прямо в node)"

# 4. без dev-залежностей
for dev in typescript vite vitest eslint playwright @playwright prettier; do
  docker run --rm --entrypoint sh "$IMAGE" -c "test ! -e node_modules/$dev" || fail "у фінальному образі є dev-залежність $dev"
done
pass "dev-залежностей (typescript, vite, vitest, eslint, playwright, prettier) нема"

# 5. HEALTHCHECK оголошений
HC=$(docker image inspect "$IMAGE" --format '{{json .Config.Healthcheck}}')
[ "$HC" != "null" ] || fail "нема HEALTHCHECK"
pass "HEALTHCHECK оголошений"

# 6. запуск
docker run -d --name "$NAME" -p "$PORT:3000" "$IMAGE" >/dev/null
for i in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.5
  [ "$i" -lt 40 ] || fail "сервер не відповів на /health"
done
HEALTH=$(curl -fsS "http://127.0.0.1:$PORT/health")
echo "      /health -> $HEALTH"
if [ -n "$EXPECTED_SHA" ]; then
  echo "$HEALTH" | grep -q "\"sha\":\"$EXPECTED_SHA\"" || fail "sha у /health не збігається з $EXPECTED_SHA"
  pass "/health віддає sha збірки $EXPECTED_SHA"
fi
curl -fsS "http://127.0.0.1:$PORT/ready" >/dev/null || fail "/ready не 200"
pass "/ready 200"
curl -fsS "http://127.0.0.1:$PORT/metrics" | grep -q "dogfight_players" || fail "/metrics не віддає метрик"
pass "/metrics віддає метрики"

# 7. HEALTHCHECK спрацював
for i in $(seq 1 30); do
  STATUS=$(docker inspect "$NAME" --format '{{.State.Health.Status}}')
  [ "$STATUS" = "healthy" ] && break
  sleep 1
  [ "$i" -lt 30 ] || fail "контейнер так і не став healthy (статус $STATUS)"
done
pass "контейнер healthy"

# 8. клієнт у кімнаті, потім docker stop
ROOM=$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/rooms" -d '{"name":"verify"}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
node scripts/ws-probe.ts "ws://127.0.0.1:$PORT/ws" "$ROOM" > /tmp/ws-probe.$$ 2>&1 &
PROBE=$!
sleep 1.5

START=$(date +%s.%N)
docker stop "$NAME" >/dev/null
END=$(date +%s.%N)
ELAPSED=$(awk -v s="$START" -v e="$END" 'BEGIN { printf "%.2f", e - s }')
EXIT_CODE=$(docker inspect "$NAME" --format '{{.State.ExitCode}}')
[ "$EXIT_CODE" = "0" ] || fail "docker stop: код виходу $EXIT_CODE, очікували 0"
awk -v e="$ELAPSED" 'BEGIN { exit !(e < 10) }' || fail "docker stop тривав $ELAPSED с (ліміт 10)"
pass "docker stop: ${ELAPSED} с, код виходу 0"

wait "$PROBE" || true
grep -q "shutdown" /tmp/ws-probe.$$ || { cat /tmp/ws-probe.$$; fail "клієнт не отримав повідомлення shutdown"; }
grep -q "close 1001" /tmp/ws-probe.$$ || { cat /tmp/ws-probe.$$; fail "сокет закрито не кодом 1001"; }
pass "клієнт отримав shutdown і закриття 1001"

# 9. журнал контейнера це рядки JSON, секретів нема
docker logs "$NAME" 2>&1 | head -50 | while read -r line; do
  echo "$line" | grep -q '^{.*}$' || fail "рядок логу не JSON: $line"
done
pass "логи контейнера це рядки JSON"

docker rm -f "$NAME" >/dev/null
rm -f /tmp/ws-probe.$$
echo "Усі перевірки образу пройдені."
