# SiteMate — Design

Build-progress tracker for a Sydney residential builder. Admin users create projects; each project starts
from a templated NSW workflow that the team fills with documents, quotes, photos and notes.

Constraint: run on free tiers. Last reviewed 2026-10-03.

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
| `users` | id (Clerk user id), email, name, role (`admin` / `viewer`), created_at — upserted lazily on request |
| `workflow_templates` | id, name, description, is_default |
| `template_stages` | id, template_id, name, description, position |
| `template_items` | id, template_stage_id, title, position |
| `projects` | id, name, site_address, suburb, client_name, client_email, client_phone, status (`active`/`on_hold`/`complete`/`archived`), start_date, target_completion, template_id, created_by, timestamps |
| `project_stages` | id, project_id, name, description, position, status (`not_started`/`in_progress`/`complete`), source, started_at, completed_at |
| `project_items` | id, project_stage_id, title, position, source, completed_at, completed_by |
| `suppliers` | id, name, abn, trade, email, phone — shared across projects |
| `files` | id, project_id, project_stage_id?, category (`photo`/`document`/`quote`/`invoice`/`certificate`/`plan`/`other`), r2_key, thumb_key, filename, mime_type, size_bytes, caption, upload_status (`pending`/`uploaded`), uploaded_by, uploaded_at, deleted_at |
| `document_extractions` | id, file_id, detected_type, fields (JSON), validation (JSON: checks + warnings), confidence, provider, model, status (`queued`/`processing`/`needs_review`/`confirmed`/`failed`), error, reviewed_by, reviewed_at |
| `quotes` | id, project_id, file_id, supplier_id, trade, quote_number, quote_date, valid_until, amount_ex_gst_cents, gst_cents, amount_inc_gst_cents, status (`pending`/`accepted`/`rejected`), decided_by, decided_at, extraction_id |
| `notes` | id, project_id, project_stage_id?, body, author_id, timestamps, deleted_at |
| `activity` | id, project_id, actor_id, action, entity_type, entity_id, meta (JSON), created_at |

Project quote totals = sum of `quotes.amount_inc_gst_cents` grouped by status (and by trade).

## 4. File uploads

1. Browser compresses photos (~400 KB) and generates a WebP thumbnail.
2. `POST /api/projects/:id/files` → permission check, insert `pending` row, return presigned PUT URL(s) (≈5 min expiry).
3. Browser PUTs directly to R2.
4. `POST /api/files/:id/complete` → HEAD the object, mark `uploaded`, log activity, enqueue extraction for documents.

R2 keys: `projects/{projectId}/{fileId}/{filename}` and `projects/{projectId}/{fileId}/thumb.webp`.
Downloads use short-lived presigned GET URLs issued after a permission check. R2 bucket needs a CORS rule for the app origin.

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
6. Save to `document_extractions` with status `needs_review`; reviewer edits/confirms → creates/updates `quotes`.

Provider adapter (`AI_PROVIDER` env):

| Provider | Use | Cost |
|---|---|---|
| `workers-ai` (default) | `@cf/meta/llama-4-scout-17b-16e-instruct` (vision, 131k ctx) via the `AI` binding | Free within 10,000 neurons/day (~dozens of documents/day) |
| `anthropic` | Claude via the official `@anthropic-ai/sdk` — native PDF input, highest accuracy | Paid, a few cents per document |
| `openai-compatible` | Any OpenAI-compatible base URL + key (OpenAI, OpenRouter, Groq, etc.) | Depends on provider |

All provider calls route through **Cloudflare AI Gateway** (free) for logging, caching, retries and provider fallback.
Prompts and schemas live in one place so providers are swappable per document type.

## 6. Environments & domain

- No custom domain yet → app runs at `sitemate.<subdomain>.workers.dev`.
- Clerk **development** instance works on workers.dev (capped at 100 users, shows a dev badge).
  A Clerk **production** instance requires a domain we own.
- Resend without a verified domain can only send from `onboarding@resend.dev` to the account owner's own address.
- Buying a domain (≈US$10/yr for `.com` at Cloudflare Registrar, at cost) unlocks Clerk production and Resend to real recipients.

## 7. Build order

1. Scaffold + deploy: Worker, D1, R2, Queue bindings; Clerk sign-in; deployed to workers.dev.
2. Projects CRUD + template instantiation.
3. Project page: stages, checklist, per-project customisation, notes, activity timeline.
4. Files: presigned uploads, photo gallery, document list.
5. AI extraction pipeline + review screen; quotes + project totals.
6. Email via Resend (invites, stage-complete notifications).
7. Read-only `viewer` role enforcement.
