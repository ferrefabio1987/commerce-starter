#!/usr/bin/env bash
# Clean-install acceptance test of the PRODUCTION stack (deploy/docker-compose.prod.yml):
# empty volumes -> build -> migrate -> minimal seed -> demo seed -> demo seed again (no duplicates)
# -> storefront image build -> stack up behind Caddy (HTTPS, local CA) -> minimal-only pages render
# -> demo seed -> demo seed again (no duplicates) -> smoke tests (pages, cart, checkout)
# -> restart everything -> data persisted -> teardown.
#
# Runs in an isolated compose project with generated secrets, so it never touches
# the local dev database. Uses host ports 8080/8443 (override: ACCEPT_HTTP_PORT/ACCEPT_HTTPS_PORT).
#   npm run test:acceptance          KEEP=1 npm run test:acceptance  (leave the stack running)
set -euo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME=commerce-acceptance
HTTPS_PORT=${ACCEPT_HTTPS_PORT:-8443}
STOREFRONT_URL="https://shop.localhost:${HTTPS_PORT}"
BACKEND_URL="https://api.localhost:${HTTPS_PORT}"
ENV_FILE=$(mktemp)
LOG_DIR=$(mktemp -d)
ADMIN_EMAIL=acceptance-admin@example.com
ADMIN_PASSWORD=$(openssl rand -hex 12)

cat > "$ENV_FILE" <<EOF
STOREFRONT_DOMAIN=shop.localhost
BACKEND_DOMAIN=api.localhost
STOREFRONT_URL=${STOREFRONT_URL}
BACKEND_URL=${BACKEND_URL}
HTTP_PORT=${ACCEPT_HTTP_PORT:-8080}
HTTPS_PORT=${HTTPS_PORT}
POSTGRES_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
COOKIE_SECRET=$(openssl rand -hex 32)
NEXT_PUBLIC_DEFAULT_REGION=de
BACKEND_IMAGE=commerce-acceptance-backend:test
STOREFRONT_IMAGE=commerce-acceptance-storefront:test
EOF

dc() { docker compose -f deploy/docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mFAIL: %s\033[0m\n' "$*"; exit 1; }
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "Logs: $LOG_DIR"; dc logs --no-color --tail 80 server worker storefront > "$LOG_DIR/stack.log" 2>&1 || true
  fi
  if [ "${KEEP:-0}" = "1" ]; then
    echo "KEEP=1: stack left running ($STOREFRONT_URL). Env file: $ENV_FILE"
  else
    dc down -v --remove-orphans > /dev/null 2>&1 || true
    rm -f "$ENV_FILE"
  fi
  exit "$status"
}
trap cleanup EXIT

wait_for() { # url, label
  for _ in $(seq 1 90); do
    if curl -ksf -o /dev/null "$1"; then return 0; fi
    sleep 2
  done
  fail "$2 not reachable at $1"
}

seed() { # preset -> log file
  dc run --rm --no-deps server node_modules/.bin/medusa exec ./src/scripts/seed.js "$1" 2>&1 \
    | sed 's/\x1b\[[0-9;]*m//g' | tee "$LOG_DIR/seed-$1-$2.log" | grep -E "created|Publishable|finished|rror" || true
  # Production logs are JSON, so the quotes around the preset may be escaped.
  grep -qE "Seed [^a-z]*$1[^a-z]* finished" "$LOG_DIR/seed-$1-$2.log" || fail "seed $1 ($2) did not finish"
}

admin_count() { # entity path -> count
  curl -ksf "$BACKEND_URL/admin/$1?limit=1&fields=id" -H "authorization: Bearer $TOKEN" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).count))'
}

step "Start from empty volumes"
dc down -v --remove-orphans > /dev/null 2>&1 || true

step "Build backend image"
dc build migrate

step "Migrate (empty PostgreSQL + Redis)"
dc run --rm migrate 2>&1 | tail -2

step "Seed: minimal"
seed minimal 1
KEY=$(grep -o 'pk_[a-f0-9]*' "$LOG_DIR/seed-minimal-1.log" | head -1)
[ -n "$KEY" ] || fail "no publishable key printed by minimal seed"
echo "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=$KEY" >> "$ENV_FILE"

step "Build storefront image (no backend needed at build time)"
dc build storefront

step "Start the stack"
dc up -d
wait_for "$BACKEND_URL/health" "backend (via Caddy)"
wait_for "$STOREFRONT_URL/de" "storefront (via Caddy)"
dc ps --format '{{.Service}}: {{.Status}}'

step "Minimal-only store renders (empty catalog)"
for path in /de /de/store /de/cart /de/account; do
  code=$(curl -ks -o /dev/null -w '%{http_code}' "$STOREFRONT_URL$path")
  echo "$path -> $code"; [ "$code" = "200" ] || fail "$path returned $code with the minimal seed"
done

step "Seed: demo (first run)"
seed demo 1
step "Seed: demo (second run must create nothing)"
seed demo 2
if grep -E "created [1-9]" "$LOG_DIR/seed-demo-2.log"; then fail "second demo seed created records"; fi
grep -q "product            created 0, existing 8" "$LOG_DIR/seed-demo-2.log" || fail "unexpected product counts on second run"

step "Admin is served"
curl -ksf "$BACKEND_URL/app/" | grep -c 'id="medusa"' > /dev/null || fail "admin HTML not served at /app"
dc run --rm --no-deps server node_modules/.bin/medusa user -e "$ADMIN_EMAIL" -p "$ADMIN_PASSWORD" 2>&1 | grep -i "created" || fail "admin user not created"
TOKEN=$(curl -ksf "$BACKEND_URL/auth/user/emailpass" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')
[ -n "$TOKEN" ] || fail "admin login failed"

step "Homepage picks up the new catalog (ISR, revalidate = 60 s)"
for _ in $(seq 1 20); do
  curl -ksf "$STOREFRONT_URL/de" | grep -c "Essential Tee" > /dev/null && break
  sleep 6
done
curl -ksf "$STOREFRONT_URL/de" | grep -c "Essential Tee" > /dev/null || fail "homepage never showed demo products"

step "Smoke tests through HTTPS (storefront pages, cart, checkout)"
NODE_TLS_REJECT_UNAUTHORIZED=0 STOREFRONT_URL="$STOREFRONT_URL" BACKEND_URL="$BACKEND_URL" PUBLISHABLE_KEY="$KEY" COUNTRY=de \
  node --test tests/smoke.test.mjs 2>&1 | grep -E "^(✔|✖)|order |^ℹ (pass|fail)|Error"
ORDERS=$(admin_count orders)
PRODUCTS=$(admin_count products)
echo "orders=$ORDERS products=$PRODUCTS"
[ "$ORDERS" -ge 1 ] || fail "no order recorded"
[ "$PRODUCTS" -eq 8 ] || fail "expected 8 products, got $PRODUCTS"
curl -ksf "$STOREFRONT_URL/de/products/essential-tee" | grep -c "/static/" > /dev/null || fail "product image not served from uploads volume"

step "Restart every container"
dc restart
wait_for "$BACKEND_URL/health" "backend after restart"
wait_for "$STOREFRONT_URL/de" "storefront after restart"

step "Data persisted across restart"
TOKEN=$(curl -ksf "$BACKEND_URL/auth/user/emailpass" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')
[ "$(admin_count orders)" = "$ORDERS" ] || fail "order count changed after restart"
[ "$(admin_count products)" = "$PRODUCTS" ] || fail "product count changed after restart"
PAGE=$(curl -ksf "$STOREFRONT_URL/de/products/essential-tee")
[[ $PAGE =~ (https://[^\"]*/static/[^\"]*\.png) ]] && IMG=${BASH_REMATCH[1]} || fail "no uploaded image URL on product page"
curl -ksf -o /dev/null "$IMG" || fail "uploaded image missing after restart: $IMG"
NODE_TLS_REJECT_UNAUTHORIZED=0 STOREFRONT_URL="$STOREFRONT_URL" BACKEND_URL="$BACKEND_URL" PUBLISHABLE_KEY="$KEY" COUNTRY=de \
  node --test --test-name-pattern="storefront renders" tests/smoke.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"

printf '\n\033[32mACCEPTANCE PASSED\033[0m\n'
