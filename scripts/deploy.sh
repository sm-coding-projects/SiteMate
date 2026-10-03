#!/usr/bin/env bash
# One-shot production deploy (run from your machine, logged in with `pnpm wrangler login`).
#   scripts/deploy.sh https://app.bfhapp.com https://sitemate.<subdomain>.workers.dev
# The first origin is the app's public address (APP_URL, email links); any others (e.g. the workers.dev
# fallback) may also sign in and upload.
set -euo pipefail
ORIGIN="${1:?Pass the app origin, e.g. https://app.bfhapp.com}"
ORIGIN="${ORIGIN%/}"
ORIGINS=("$@")

echo "▸ Checking local secrets (names and prefixes only)"
node scripts/secrets.mjs check
grep -q '^VITE_CLERK_PUBLISHABLE_KEY=pk_' .env || { echo ".env needs VITE_CLERK_PUBLISHABLE_KEY (inlined at build time)"; exit 1; }

echo "▸ Quality gates"
pnpm typecheck && pnpm lint && pnpm test

echo "▸ Remote D1 migrations"
pnpm db:migrate:remote

echo "▸ Production secrets (AUTHORIZED_PARTIES=${ORIGINS[*]})"
node scripts/secrets.mjs push "${ORIGINS[@]}"

echo "▸ R2 CORS"
node scripts/r2-cors.mjs "${ORIGINS[@]}"

echo "▸ Build + deploy"
pnpm build
pnpm wrangler deploy --var "APP_URL:$ORIGIN"

echo "▸ Smoke test"
curl -fsS "$ORIGIN/api/health" && echo
echo "Done. Open $ORIGIN and sign in."
