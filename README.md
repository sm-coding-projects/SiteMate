# BFH App

Build-progress tracker for a Sydney residential builder. One Cloudflare Worker serves a React SPA and a Hono API,
backed by D1, R2, Queues and Workers AI, with Clerk for auth and Resend for email. Everything runs on free tiers.

- Design & data model: [`docs/DESIGN.md`](docs/DESIGN.md)
- Visual design system: [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) → full spec in
  [`design-system/sitemate/MASTER.md`](design-system/sitemate/MASTER.md)

## What it does

- **Projects** start from the *NSW Residential New Build* template (8 stages, 30 checks), copied per project and
  customisable: add, rename, reorder (drag on desktop, up/down on touch) and remove stages and checks.
- **Checklist** ticks record who and when; stage status follows the checklist (or is set by hand). Completing a
  stage emails the team.
- **Photos** are compressed on the phone (~2000 px, ~400 KB, WebP thumbnail) and uploaded straight to R2 through
  a queue that survives patchy 4G. **Documents** (PDF, images, Office, ≤ 25 MB) have categories and stages.
- **AI extraction** reads quotes, invoices and certificates in the background, validates the numbers (GST,
  totals, line items, ABN checksum, dates, supplier match) and puts them up for **review**. Confirmed quotes
  can be accepted or rejected and roll up into project totals by status and trade.
- **Notes**, an **activity** timeline per project and across the workspace, and a **Team** page to invite people
  as admins or read-only viewers.

## Prerequisites

- Node 22+ and pnpm 10+
- A Cloudflare account (free plan), logged in with `pnpm wrangler login`
- A Clerk application (free Hobby plan): the **development** instance for `pnpm dev`, a **production** instance
  on the custom domain for the deployed app
- A Resend account (free) for email

## Project layout

```
src/client/   React SPA (Vite, TanStack Query, React Router, Tailwind v4, shadcn/ui)
src/worker/   Hono API under /api, Queue consumer (extraction + email), AI providers
src/db/       Drizzle schema (D1 / SQLite)
src/shared/   Zod request schemas, response types, validators and progress rules shared by both sides
migrations/   SQL migrations (0002 seeds the NSW template), applied by wrangler
scripts/      deploy.sh, secrets.mjs (check/push secrets), r2-cors.mjs
test/         API tests (Vitest in the Workers runtime)
e2e/          UI tests (Playwright, Clerk stubbed, API from fixtures)
```

## One-time setup

### 1. Cloudflare resources

```bash
pnpm wrangler d1 create sitemate-db --location oc
pnpm wrangler r2 bucket create sitemate-files --location oc
pnpm wrangler queues create sitemate-jobs
```

Copy the `database_id` printed by the first command into `wrangler.jsonc`, then run `pnpm cf-typegen`.

**AI Gateway:** Dashboard → **AI** → **AI Gateway** → **Create Gateway**, name it `sitemate` (matches
`AI_GATEWAY_ID`). Every AI call goes through it (logs, caching, retries). Free.

### 2. R2 API token and CORS (for presigned uploads)

The browser uploads and downloads files directly from R2 with short-lived presigned URLs, which are signed
with an R2 API token (the Worker binding can't sign URLs).

1. Dashboard → **R2 Object Storage** → **Manage API tokens** (in *Account details* on the right) →
   **Create Account API token**.
2. Name `sitemate-presign`; Permissions **Object Read & Write**; **Apply to specific buckets only** →
   `sitemate-files`; TTL **Forever** → **Create Account API Token**.
3. Put the values in `.dev.vars`: `R2_ACCESS_KEY_ID` (Access Key ID), `R2_SECRET_ACCESS_KEY` (Secret Access Key)
   and `R2_ACCOUNT_ID` (Account ID on the R2 overview page). The secret is shown once.
4. Set the bucket's CORS rules (localhost:5173 and your workers.dev origin; GET/PUT/HEAD; `content-type`):

   ```bash
   node scripts/r2-cors.mjs https://sitemate.<subdomain>.workers.dev
   ```

### 3. Clerk

Clerk has two instances with separate users, settings and keys: **development** (`pk_test_`/`sk_test_`, for
`pnpm dev` on localhost) and **production** (`pk_live_`/`sk_live_`, for `bfhapp.com`). Live keys don't work on
localhost, and test keys don't belong in production, so each has its own files (see step 5).

In the [Clerk dashboard](https://dashboard.clerk.com), for **each** instance:

1. **Configure → Restrictions → Sign-up mode: Restricted.** Users can only join by invitation.
2. **Configure → Sessions → Customize session token**, add these claims so the API can read the user's
   profile and role without calling Clerk on every request:
   ```json
   {
     "email": "{{user.primary_email_address}}",
     "name": "{{user.full_name}}",
     "role": "{{user.public_metadata.role}}"
   }
   ```
3. Make yourself an admin. Restricted sign-up blocks the very first account too, so create it by hand:
   **Users → Create user** with your email (the same address as your Google account), then **Metadata →
   Public** → `{ "role": "admin" }`. **Sign in** (not sign up) with Google or that email; Clerk links the Google
   account to the user by email.

After that, invite everyone else from **BFH App → Team** (Clerk emails the invitation; the role is stored in
`publicMetadata.role`). Anyone without `"role": "admin"` is a read-only **viewer** who sees only the projects
shared with them: pick them in the invite, or later from the member's **⋯ → Projects…** (stored in
`project_access`; a viewer with none sees an empty list). Viewers get no sidebar, Review or workspace Activity.
Role changes reach a session when its token refreshes (within about a minute). Users don't carry over between instances: invite people again
in production.

**Production instance, once.** Create it from the instance switcher (clone the development settings), with
`bfhapp.com` as the domain, then:

- **DNS:** add the CNAMEs from **Domains** (`clerk.`, `accounts.`, `clkmail.`, `clk._domainkey.`,
  `clk2._domainkey.`) in Cloudflare as **DNS only** (grey cloud); proxied records fail verification. The mail
  records are what keep invitations out of spam.
- **Google sign-in:** development borrows Clerk's shared Google credentials; production needs your own, or Google
  answers `Missing required parameter: client_id`. In Google Cloud Console create an OAuth consent screen
  (External, authorised domain `bfhapp.com`, then **Publish app** so it's *In production*) and an OAuth client
  ID (*Web application*, origin `https://app.bfhapp.com`, redirect URI
  `https://clerk.bfhapp.com/v1/oauth_callback`). Paste the client ID and secret into **Configure → SSO
  connections → Google → Use custom credentials**. The same goes for any other social provider.
- Repeat steps 1–3 above; cloning doesn't copy users, and check the settings carried over.

A production instance only serves its own domain and subdomains, so sign-in works on `app.bfhapp.com`, not on
`*.workers.dev`. The Worker's `AUTHORIZED_PARTIES` must list the app's origin (the deploy script sets it).

### 4. Resend

Create an API key (resend.com → **API Keys**, *Sending access*) and put it in `.dev.vars` as `RESEND_API_KEY`.
Without a verified domain Resend only delivers from `onboarding@resend.dev` to **your own** account address,
so the app runs in **sandbox mode**: every email goes to `EMAIL_SANDBOX_TO` (set it to that address), with the
intended recipient in the subject, e.g. `[to priya@example.com] Frame complete — 14 Banksia St`.

### 5. Local environment files

```bash
cp .dev.vars.example .dev.vars     # Worker secrets for pnpm dev (Clerk development instance)
cp .env.example .env               # SPA for pnpm dev: VITE_CLERK_PUBLISHABLE_KEY=pk_test_…
cp .prod.vars.example .prod.vars   # Production overrides: the Clerk production keys (sk_live_/pk_live_)
echo 'VITE_CLERK_PUBLISHABLE_KEY=pk_live_…' > .env.production   # SPA for production builds
node scripts/secrets.mjs check     # production secrets, name + prefix only, never values
```

| File | Used by | Clerk instance |
|---|---|---|
| `.dev.vars` | `pnpm dev`, tests; production for every non-Clerk secret not in `.prod.vars` | development |
| `.env` | `pnpm dev` | development |
| `.prod.vars` | `scripts/deploy.sh` → Worker secrets (Clerk keys come only from here) | production |
| `.env.production` | `vite build` (read over `.env`) | production |

All four are gitignored. The deploy refuses to run with test Clerk keys.

## Configuration reference

**Secrets** (`.dev.vars` locally; `.prod.vars` over `.dev.vars` for production, uploaded by
`node scripts/secrets.mjs push <origin>`):

| Name | Required | Purpose |
|---|---|---|
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | yes | Clerk Backend API and session verification |
| `CLERK_JWT_KEY` | no | PEM key for networkless session verification |
| `AUTHORIZED_PARTIES` | yes | Comma-separated origins allowed to send session tokens |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | yes | Presigned R2 URLs |
| `RESEND_API_KEY` | for email | Resend API key; without it emails are skipped (logged) |
| `EMAIL_SANDBOX_TO` | sandbox mode | Where every email goes in sandbox mode (your Resend account address) |
| `ANTHROPIC_API_KEY` | no | Enables `AI_PROVIDER=anthropic` |
| `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_BASE_URL` | no | Enables `AI_PROVIDER=openai-compatible` |
| `AI_GATEWAY_TOKEN` | no | Only if the gateway is set to *Authenticated* |
| `SETTINGS_ENCRYPTION_KEY` | for Account → AI model | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts the API key saved in the app. Changing it makes the saved key unreadable (re-enter it) |

**Vars** (`wrangler.jsonc` → `vars`):

| Name | Default | Purpose |
|---|---|---|
| `APP_ENV` | `production` | Shown by `/api/health` |
| `APP_URL` | `https://app.bfhapp.com` | Public origin of the app, used in email links (`deploy.sh` overrides it with its first origin) |
| `SITE_HOST`, `APP_HOST` | `bfhapp.com`, `app.bfhapp.com` | Landing-page host and app host (see Deploy) |
| `R2_BUCKET` | `sitemate-files` | Bucket name for presigned URLs |
| `AI_PROVIDER` | `workers-ai` | `workers-ai` \| `anthropic` \| `openai-compatible` (falls back to workers-ai without a key) |
| `AI_GATEWAY_ID` | `sitemate` | AI Gateway every provider call goes through |
| `WORKERS_AI_MODEL` | `@cf/meta/llama-4-scout-17b-16e-instruct` | Default model (vision + JSON) |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model for the Anthropic provider (native PDF input) |
| `OPENAI_COMPAT_MODEL` | `openai/gpt-5-mini` | Model for the OpenAI-compatible provider |
| `EMAIL_MODE` | `sandbox` | `sandbox` redirects to `EMAIL_SANDBOX_TO`; `live` sends to real recipients |
| `EMAIL_FROM` | `BFH App <onboarding@resend.dev>` | Sender |
| `EMAIL_DAILY_LIMIT` | `90` | Rolling 24 h cap (Resend free: 100/day) |

`VITE_CLERK_PUBLISHABLE_KEY` goes in `.env` (development) and `.env.production` (production builds); Vite
inlines it at build time.

## AI providers

**Workspace model (Account → AI model, admins).** Enter any OpenAI-compatible (`/chat/completions`) or
Anthropic-compatible (`/v1/messages`) base URL and API key, fetch the endpoint's model list (or type a model ID),
test it and save. That model then serves every AI call, overriding `AI_PROVIDER`; **Use the default** removes it.
For a MiniMax token plan use `https://api.minimax.io/v1` (OpenAI format) or `https://api.minimax.io/anthropic`
(Anthropic format) with model `MiniMax-M3`. The key is AES-GCM encrypted in D1 with `SETTINGS_ENCRYPTION_KEY`
and never returned to the browser. These calls go straight to the endpoint (not through AI Gateway); file → text
still uses Workers AI `toMarkdown` and image transcription.

Extraction runs in the Queue consumer, never in a request: R2 → Workers AI `toMarkdown` (PDF/Office; images are
transcribed by the vision model) → classify → extract with a JSON schema → validate in code → *needs review*.

- **workers-ai** (default, free within 10,000 neurons/day — dozens of documents): Llama 4 Scout via the `AI`
  binding. If the model rejects a JSON schema it retries in plain JSON mode.
- **anthropic**: official `@anthropic-ai/sdk` with native PDF input (≤ 5 MB; larger PDFs and Office files use
  `toMarkdown` text), structured JSON output and server-side refusal fallback. Paid per document.
- **openai-compatible**: any OpenAI-style `/chat/completions` endpoint. By default the AI Gateway's compat
  endpoint (model `provider/model`); set `OPENAI_COMPAT_BASE_URL` to use another host directly.

Failures retry twice with backoff (`max_retries` on the consumer), then the extraction is marked *failed* with
the error; **Re-run extraction** on the review screen queues it again.

## Development

```bash
pnpm install
pnpm db:migrate:local   # apply migrations (incl. the template seed) to the local D1
pnpm dev                # Vite + Worker runtime on http://localhost:5173
```

`pnpm dev` runs the SPA and Worker together in the real Workers runtime with local D1 and Queues. Workers AI and
the R2 bucket are **remote** even in dev (`"remote": true`): presigned uploads land in the real bucket, so the
Worker must read the same one. You need `wrangler login` for that.

| Command | What it does |
|---|---|
| `pnpm typecheck` | TypeScript (client, worker, tests, config projects) |
| `pnpm lint` / `pnpm format` | Biome |
| `pnpm test` | API tests in the Workers runtime (auth & roles, template instantiation, stages, presign flow, extraction pipeline, validators, email) |
| `pnpm test:e2e` | UI tests with Playwright at 375/768/1280 px (set `PW_CHROMIUM` to use a preinstalled Chromium) |
| `pnpm db:generate --name <name>` | Generate a migration after editing `src/db/schema.ts` |
| `pnpm db:migrate:local` / `pnpm db:migrate:remote` | Apply migrations |
| `pnpm cf-typegen` | Regenerate binding types after editing `wrangler.jsonc` |
| `node scripts/secrets.mjs check` | Which secrets are set (name + prefix only) |

## Deploy

The Worker answers on two hostnames (`routes` in `wrangler.jsonc`; Cloudflare creates their DNS records and
certificates on deploy) plus the workers.dev fallback:

| Host | Serves |
|---|---|
| `bfhapp.com` | The landing page. Every other path 301s to the same path on `app.bfhapp.com`; `www.` 301s to the bare domain |
| `app.bfhapp.com` | The app, sign-in and `/api`. `/` 302s to `/projects` |
| `sitemate.<subdomain>.workers.dev` | Everything, on one origin, but Clerk production sign-in doesn't work here |

Page requests run through the Worker first (`run_worker_first`) for this; built files under `/assets` don't.
`SITE_HOST`/`APP_HOST` in `vars` set the two hosts (unset either to serve everything everywhere).

```bash
scripts/deploy.sh https://app.bfhapp.com
```

The first origin becomes `APP_URL` (email links); all of them go into `AUTHORIZED_PARTIES` and the R2 CORS
rules. It checks the production secrets (live Clerk keys in `.prod.vars` and `.env.production`), runs
typecheck/lint/tests, applies remote migrations, uploads secrets from `.prod.vars` over `.dev.vars` (values are
piped, never printed), sets R2 CORS, builds, deploys and calls `/api/health`. To redeploy code only: `pnpm run deploy`. (Note: plain `pnpm deploy` is pnpm's
own workspace command, not this script.)

Watch the Worker and the queue consumer with `pnpm wrangler tail`.

## API

All routes are under `/api`. Every write route requires the `admin` role (`requireRole("admin")`); viewers get
403. Viewers can read only projects in their `project_access` rows (`src/worker/lib/access.ts`): anything under
`/projects/:id`, plus `/files/:id/url` and `/stages/:id/items`, answers 404 otherwise, and `/activity`,
`/extractions`, `/suppliers` and `/templates` are admin-only. Bodies, queries and params are validated with the Zod schemas in `src/shared/schemas.ts`.

| Route | Purpose |
|---|---|
| `GET /health` | Public liveness check |
| `GET /me`, `PATCH /me/preferences` | Current user and role; email opt-out (any role) |
| `GET /templates` | Workflow templates |
| `GET/POST /projects`, `GET/PATCH /projects/:id`, `POST /projects/:id/archive` | Projects (list filters: `status`, `q`, `cursor`) |
| `POST /projects/:id/stages`, `POST /projects/:id/stages/reorder` | Add / reorder stages |
| `PATCH/DELETE /stages/:id`, `POST /stages/:id/items`, `POST /stages/:id/items/reorder` | Stage edits, checklist items |
| `PATCH/DELETE /items/:id` | Tick/untick, rename, remove |
| `GET/POST /projects/:id/notes`, `PATCH/DELETE /notes/:id` | Notes (soft delete) |
| `GET /activity`, `GET /projects/:id/activity` | Activity timelines |
| `GET/POST /projects/:id/files` | List / presign an upload |
| `POST /files/:id/upload-urls`, `POST /files/:id/complete` | Refresh upload URLs; confirm upload |
| `GET /files/:id/url`, `PATCH/DELETE /files/:id` | Download link; caption/stage/category; soft delete |
| `GET /extractions`, `GET /extractions/:id` | Review queue and detail |
| `POST /extractions/:id/rerun`, `POST /extractions/:id/confirm` | Re-run; confirm (creates supplier + quote) |
| `GET /projects/:id/quotes`, `PATCH /quotes/:id/status`, `GET /suppliers` | Quotes with totals; accept/reject |
| `GET /admin/team`, `POST /admin/invitations`, `DELETE /admin/invitations/:id`, `PATCH /admin/users/:id/role`, `PUT /admin/users/:id/projects`, `POST /admin/users/:id/remove-access`, `POST /admin/users/:id/restore-access`, `DELETE /admin/users/:id` | Team (Clerk); viewers' projects |
| `POST /admin/test-email`, `GET /admin/email-log`, `POST /admin/queue-ping` | Ops checks |

## Address suggestions

The project form suggests addresses without any API key or account:

- **Street addresses** come from [Photon](https://photon.komoot.io), a free public geocoder over OpenStreetMap
  data, called straight from the browser (fair use, no uptime guarantee). Data © OpenStreetMap contributors,
  ODbL.
- **Suburb → state + postcode** comes from `src/client/data/au-suburbs.json`, built from G-NAF and loaded only
  when an address field is focused. Rebuild it for a newer G-NAF release with `node scripts/build-suburbs.mjs`.
  Incorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under
  the Open Geo-coded National Address File (G-NAF) End User Licence Agreement.

Both are hints: new estates are often in neither, so every address field can be typed by hand.

## Free-tier budget

| Service | Free limit | How BFH App stays under it |
|---|---|---|
| Workers | 100k requests/day, 10 ms CPU/request | SPA is static assets; AI, file and email work run in the Queue consumer; files go browser↔R2 directly |
| D1 | 100k row writes/day | Writes only on user actions; keyset pagination; indexed queries |
| R2 | 10 GB | Photos compressed to ~400 KB in the browser before upload |
| Queues | 10k operations/day | ~3 operations per document or notification |
| Workers AI | 10k neurons/day | Only non-photo documents are extracted; 60k-character cap per document |
| Resend | 100 emails/day | 90/day rolling cap, per-user opt-out, one email per event and recipient |
