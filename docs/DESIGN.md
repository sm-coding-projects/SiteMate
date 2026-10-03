# BFH App — Design

Build-progress tracker for a Sydney residential builder. Admin users create projects; each project starts
from a templated NSW workflow that the team fills with documents, quotes, photos and notes.

Constraint: run on free tiers. Last reviewed 2026-10-03 (updated for the full build: steps 2–7).

## 1. Stack

| Layer | Choice |
|---|---|
| Hosting | One Cloudflare Worker (static assets for the SPA + API) on `*.workers.dev` |
| Frontend | Vite + React + TanStack Query + Tailwind + shadcn/ui (SPA, no SSR — free plan is 10 ms CPU/request) |
| API | Hono |
| Database | Cloudflare D1 (location hint `oc`) + Drizzle ORM |
| Files | Cloudflare R2 (location hint `oc`), browser uploads via presigned URLs |
| Background jobs | Cloudflare Queues (free: 10k ops/day, 24 h retention) |
| AI extraction | Provider adapter → Workers AI (free default) / Anthropic / any OpenAI-compatible API, via Cloudflare AI Gateway |
| Auth | Clerk (free Hobby), restricted (invite-only) sign-up, role in `publicMetadata` |
| Email | Resend (free: 3k/month, 100/day, 1 domain) |

## 2. Workflow

### Default template — "NSW Residential New Build"

| # | Stage | Default checklist |
|---|---|---|
| 1 | Pre-construction | Signed contract · HBCF insurance certificate · DA/CDC approval · Survey · Soil test · Engineering plans |
| 2 | Site preparation | Site set-up & fencing · Excavation · Services located |
| 3 | Base / Slab | Pre-pour inspection (certifier) · Slab pour photos · Termite protection certificate |
| 4 | Frame | Frame inspection · Truss certification · Roof on |
| 5 | Lock-up | Windows · External doors · Roof · External cladding |
| 6 | Fixing | Plaster · Cabinetry · Tiling · Waterproofing certificate · Internal doors |
| 7 | Practical completion | Final inspection · Occupation certificate · Compliance certificates |
| 8 | Handover & defects | Keys handed over · Defects list · Warranty documents |

### Per-project customisation

- On project creation the template's stages and items are **copied** into `project_stages` / `project_items`.
  Template edits never change existing projects.
- Within a project, admins can **add, rename, reorder and remove** stages, and add/edit/remove checklist items
  under any stage. Each row records `source` = `template` | `custom`.
- Later (nice-to-have): "Save this project's workflow as a new template".

## 3. Data model (D1 / SQLite)

Conventions: text ULID ids · timestamps as unix ms integers · money as integer cents (AUD) ·
soft delete via `deleted_at` on user content.

| Table | Key columns |
|---|---|
| `users` | id (Clerk user id), email, name, role (`admin` / `viewer`), email_notifications (opt-out), created_at — upserted lazily on request |
| `workflow_templates` | id, name, description, is_default |
| `template_stages` | id, template_id, name, description, position |
| `template_items` | id, template_stage_id, title, position |
| `projects` | id, name, site_address, suburb, client_name, client_email, client_phone, status (`active`/`on_hold`/`complete`/`archived`), start_date, target_completion, template_id, created_by, timestamps |
| `project_stages` | id, project_id, name, description, position, status (`not_started`/`in_progress`/`complete`), source, started_at, completed_at |
| `project_items` | id, project_stage_id, title, position, source, completed_at, completed_by |
| `suppliers` | id, name, abn, trade, email, phone — shared across projects |
| `files` | id, project_id, project_stage_id?, category (`photo`/`document`/`quote`/`invoice`/`certificate`/`plan`/`other`), r2_key, thumb_key, filename, mime_type, size_bytes, caption, upload_status (`pending`/`uploaded`), uploaded_by, uploaded_at, created_at, deleted_at |
| `document_extractions` | id, file_id, detected_type, fields (JSON), validation (JSON: checks + warnings), confidence, provider, model, status (`queued`/`processing`/`needs_review`/`confirmed`/`failed`), error, attempts, reviewed_by, reviewed_at |
| `quotes` | id, project_id, file_id, supplier_id, trade, quote_number, quote_date, valid_until, amount_ex_gst_cents, gst_cents, amount_inc_gst_cents, status (`pending`/`accepted`/`rejected`), decided_by, decided_at, extraction_id (unique: one quote per confirmed extraction) |
| `notes` | id, project_id, project_stage_id?, body, author_id, timestamps, deleted_at |
| `activity` | id, project_id, actor_id, action, entity_type, entity_id, meta (JSON), created_at |
| `email_log` | id, kind, intended_to, sent_to, subject, status (`sent`/`skipped`/`failed`), provider_id, error, created_at — enforces the daily cap and records sandbox redirects |

Project quote totals = sum of `quotes` amounts (ex‑GST, GST, inc‑GST) grouped by status and by trade.
A `quotes` row only exists once a reviewer has confirmed the extraction, so only confirmed quotes count.
Rejected quotes are excluded from the by‑trade view.

Indexes: every list is keyset‑paginated on `(sort column, id)` with a matching index
(`projects(status, updated_at)`, `activity(project_id, created_at)`, `activity(created_at)`,
`notes(project_id, created_at)`, `files(project_id, category, created_at)`,
`document_extractions(status, created_at)`, `quotes(project_id, status)`, `email_log(created_at)`).
Stage and item order use `(parent_id, position)` indexes. `suppliers.abn` is unique.

Access: viewers can read every project (there is no per-project membership); only admins write. The API
enforces this on every write route (`requireRole("admin")`, tested for all of them); the UI hides edit controls.

## 4. File uploads

1. Browser compresses photos (longest edge ~2000 px, ~400 KB JPEG) and generates a WebP thumbnail (JPEG where
   the browser can't encode WebP). Jobs and blobs are kept in IndexedDB and uploaded one at a time with
   progress, exponential backoff, resume on `online` and after a reload.
2. `POST /api/projects/:id/files` → permission check, validation (photos: images ≤ 10 MB after compression;
   documents: PDF, images, Office ≤ 25 MB), insert `pending` row, return presigned PUT URL(s) (5 min expiry,
   `Content-Type` and `Content-Length` signed so R2 rejects anything else). `POST /api/files/:id/upload-urls`
   re-issues URLs for an upload that outlived them.
3. Browser PUTs directly to R2 (XHR for progress).
4. `POST /api/files/:id/complete` → HEAD the object via the binding (size/type must match, otherwise it's
   deleted), mark `uploaded`, log activity, enqueue extraction for non-photo files.

R2 keys: `projects/{projectId}/{fileId}/{filename}` and `projects/{projectId}/{fileId}/thumb.webp`.
Downloads use presigned GET URLs issued after a permission check, signed for an hour-aligned window
(2 h expiry) so the same URL repeats and the browser caches thumbnails. Presigning uses an R2 API token
(aws4fetch); the bucket needs a CORS rule for the app origin (`scripts/r2-cors.mjs`). Delete is soft.

## 5. AI document extraction

Goal: extract and validate data from **any** uploaded document; quotes are the first structured target.
AI suggests, a human confirms — nothing counts towards project totals until confirmed.

Pipeline (Queue consumer):

1. Load the file from R2.
2. Get text: PDFs/Office docs via Workers AI `toMarkdown` (free for non-image formats). Photos/scans go to a vision model.
3. **Classify** the document (quote, invoice, certificate, plan, contract, other) and suggest a stage.
4. **Extract** type-specific fields with a JSON schema (structured output) — for quotes: supplier, ABN, trade,
   quote number, dates, line items, ex-GST, GST, inc-GST.
5. **Validate** in code (Zod + rules): GST ≈ 10% of ex-GST, line items sum to subtotal, ABN mod-89 checksum,
   dates plausible, supplier fuzzy-matched to `suppliers`. Failures become warnings shown to the reviewer.
6. Save to `document_extractions` with status `needs_review`; reviewer edits/confirms → creates/updates `quotes`
   and `suppliers` (explicit choice → exact ABN → name similarity ≥ 0.8 → new supplier; gaps filled, never overwritten).

Retries: the consumer retries twice with backoff (30 s, 60 s), recording "Retrying: …" on the row, then marks it
`failed`. Problems a retry can't fix (file missing, no readable text) fail immediately. A reviewer can re-run.
Documents longer than 60k characters are cut and the reviewer is warned. If Workers AI rejects a JSON schema,
the call is retried in plain JSON mode with the schema in the prompt.

Provider adapter. An admin-saved workspace endpoint (`ai_settings` table, Account → AI model) takes precedence:
any OpenAI- or Anthropic-compatible base URL + key + model (e.g. MiniMax M3 on a token plan), key encrypted with
`SETTINGS_ENCRYPTION_KEY`. Otherwise `AI_PROVIDER` env:

| Provider | Use | Cost |
|---|---|---|
| `workers-ai` (default) | `@cf/meta/llama-4-scout-17b-16e-instruct` (vision, 131k ctx) via the `AI` binding | Free within 10,000 neurons/day (~dozens of documents/day) |
| `anthropic` | Claude via the official `@anthropic-ai/sdk` — native PDF input, highest accuracy | Paid, a few cents per document |
| `openai-compatible` | Any OpenAI-compatible base URL + key (OpenAI, OpenRouter, Groq, etc.) | Depends on provider |

All provider calls route through **Cloudflare AI Gateway** (free) for logging, caching, retries and provider fallback
(`AI_GATEWAY_ID`, default `sitemate`). Prompts and schemas live in `src/worker/ai/prompts.ts`; validators in
`src/shared/validators.ts` (also used live on the review screen). A provider is used only if its key is present;
otherwise extraction falls back to Workers AI. The Anthropic provider uses `claude-opus-5-5` with native PDF input
(≤ 5 MB), structured JSON output and the server-side refusal fallback.

## 5a. Email

Resend, sent only from the Queue consumer. Notifications: *stage completed* (everyone with notifications on,
except the person who completed it) and *extraction ready for review* (admins). `EMAIL_MODE=sandbox` (default
while there is no domain) sends every email to `EMAIL_SANDBOX_TO` with the intended recipient in the subject.
A rolling 24 h cap (`EMAIL_DAILY_LIMIT`, default 90) keeps under Resend's 100/day; each event/recipient is sent at
most once per day (Resend idempotency key + `email_log`). Users opt out on the Account page. Team invitations are
emailed by Clerk, not Resend.

## 6. Environments & domain

- No custom domain yet → app runs at `sitemate.<subdomain>.workers.dev`.
- Clerk **development** instance works on workers.dev (capped at 100 users, shows a dev badge).
  A Clerk **production** instance requires a domain we own.
- Resend without a verified domain can only send from `onboarding@resend.dev` to the account owner's own address.
- Buying a domain (≈US$10/yr for `.com` at Cloudflare Registrar, at cost) unlocks Clerk production and Resend to real recipients.
- Clerk invitation links land on `/sign-up` (Clerk `<SignUp>` redeems the invitation ticket); sign-up stays restricted.
- When a domain is bought: create the Clerk **production** instance (new keys, DNS records, re-create users or
  invite again, re-add the session-token claims), verify the domain in Resend and set `EMAIL_FROM` to an address on
  it, switch `EMAIL_MODE=live`, add the custom domain to the Worker, update `APP_URL`, `AUTHORIZED_PARTIES` and
  the R2 CORS origins.

## 7. Build order

1. Scaffold + deploy: Worker, D1, R2, Queue bindings; Clerk sign-in; deployed to workers.dev.
2. Projects CRUD + template instantiation. ✅
3. Project page: stages, checklist, per-project customisation, notes, activity timeline. ✅
4. Files: presigned uploads, photo gallery, document list. ✅
5. AI extraction pipeline + review screen; quotes + project totals. ✅
6. Email via Resend (stage-complete and review-ready notifications; invites are sent by Clerk). ✅
7. Read-only `viewer` role enforcement + Team page. ✅

## 8. Testing

- `pnpm test` — API tests in the Workers runtime (`@cloudflare/vitest-pool-workers`) with migrations applied:
  auth and roles (a viewer gets 403 on every write route), template instantiation, stages/checklist/notes,
  presign flow, extraction pipeline with a fake AI binding, validators, email.
- `pnpm test:e2e` — Playwright against the SPA with Clerk stubbed and the API served from fixtures: no sideways
  scroll at 375/768/1280 on every screen, viewer has no edit controls, optimistic ticks, focus, reduced motion.

## 9. Layout notes

Two-column screens (stage rail + checklist, document + review form, settings rows) go side by side from 1024 px;
at 768 px they stack because the 224 px sidebar leaves too little room. Navigation: Projects, Review, Activity,
Team (admins; in the user menu on phones), Account.
