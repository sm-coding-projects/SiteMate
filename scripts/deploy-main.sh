#!/usr/bin/env bash
# Deploys whatever is on origin/main, from any folder or branch of this repo (run after merging a PR).
#   scripts/deploy-main.sh             # deploy
#   scripts/deploy-main.sh --dry-run   # everything except migrations and the upload
# It builds in a throwaway worktree of origin/main, so your own checkout and branch are never touched. Uses
# .env.production from the main checkout (override with ENV_FILE=…) and APP_URL from wrangler.jsonc.
# First-time setup (secrets, R2 CORS) is scripts/deploy.sh.
set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# The main checkout is the parent of the shared .git directory, whichever worktree this runs from.
MAIN="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
ENV_FILE="${ENV_FILE:-$MAIN/.env.production}"
grep -q '^VITE_CLERK_PUBLISHABLE_KEY=pk_live_' "$ENV_FILE" 2>/dev/null || {
	echo "$ENV_FILE needs VITE_CLERK_PUBLISHABLE_KEY=pk_live_… (production instance, inlined at build time)"
	exit 1
}

echo "▸ Fetching origin/main"
git -C "$MAIN" fetch --quiet origin main
SHA="$(git -C "$MAIN" rev-parse --short origin/main)"
echo "  $SHA $(git -C "$MAIN" log -1 --format=%s origin/main)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/sitemate-deploy.XXXXXX")"
cleanup() {
	git -C "$MAIN" worktree remove --force "$WORK" 2>/dev/null || rm -rf "$WORK"
	git -C "$MAIN" worktree prune
}
trap cleanup EXIT
git -C "$MAIN" worktree add --quiet --detach "$WORK" origin/main
cp "$ENV_FILE" "$WORK/.env.production"
cd "$WORK"

echo "▸ Installing dependencies"
pnpm install --frozen-lockfile --silent

echo "▸ Quality gates"
pnpm typecheck && pnpm lint && pnpm test

APP_URL="$(grep -o '"APP_URL":[[:space:]]*"[^"]*"' wrangler.jsonc | sed 's/.*"\([^"]*\)"$/\1/')"
[[ -n "$APP_URL" ]] || { echo "No APP_URL in wrangler.jsonc"; exit 1; }

if $DRY_RUN; then
	echo "▸ Remote D1 migrations (dry run: listing only)"
	pnpm wrangler d1 migrations list sitemate-db --remote
else
	echo "▸ Remote D1 migrations"
	pnpm db:migrate:remote
fi

echo "▸ Build"
pnpm build
ASSET="$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/client/index.html | head -1)"

if $DRY_RUN; then
	echo "▸ Deploy (dry run)"
	pnpm wrangler deploy --dry-run --var "APP_URL:$APP_URL"
	echo "Dry run done: $SHA builds and passes the checks. Nothing was deployed."
	exit 0
fi

echo "▸ Deploy ($APP_URL)"
pnpm wrangler deploy --var "APP_URL:$APP_URL"

echo "▸ Smoke test"
curl -fsS "$APP_URL/api/health" && echo
# The edge can take a few seconds to serve the new version.
for _ in 1 2 3 4 5 6; do
	if curl -fsS "$APP_URL/projects?v=$SHA" | grep -q "$ASSET"; then
		echo "Done: $APP_URL is serving $SHA ($ASSET)."
		exit 0
	fi
	sleep 5
done
echo "Deployed, but $APP_URL isn't serving $ASSET yet. Check again in a minute."
