#!/usr/bin/env bash
# One-shot production deploy (run from your machine, logged in with `pnpm wrangler login`).
#   scripts/deploy.sh https://sitemate.<subdomain>.workers.dev
set -euo pipefail
ORIGIN="${1:?Pass the workers.dev origin, e.g. https://sitemate.you.workers.dev}"
ORIGIN="${ORIGIN%/}"

echo "▸ Checking local secrets (names and prefixes only)"
node scripts/secrets.mjs check
grep -q '^VITE_CLERK_PUBLISHABLE_KEY=pk_' .env || { echo ".env needs VITE_CLERK_PUBLISHABLE_KEY (inlined at build time)"; exit 1; }

echo "▸ Quality gates"
pnpm typecheck && pnpm lint && pnpm test

echo "▸ Remote D1 migrations"
pnpm db:migrate:remote

echo "▸ Production secrets (AUTHORIZED_PARTIES=$ORIGIN)"
node scripts/secrets.mjs push "$ORIGIN"

echo "▸ R2 CORS"
node scripts/r2-cors.mjs "$ORIGIN"

echo "▸ Build + deploy"
pnpm build
pnpm wrangler deploy --var "APP_URL:$ORIGIN"

echo "▸ Smoke test"
curl -fsS "$ORIGIN/api/health" && echo
echo "Done. Open $ORIGIN and sign in."
