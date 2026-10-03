# Design System Master File — "Site Survey"

> **LOGIC:** When building a specific page, first check `design-system/sitemate/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file. If not, follow the rules below.

**Project:** BFH App · **Category:** Construction / field operations tool (B2B, mobile-first, outdoor use)
**Direction (2026-10-03 review):** construction drawings and survey markings, not generic SaaS.
**Implementation:** tokens in `src/client/styles/globals.css` (Tailwind v4 + shadcn/ui CSS variables).
Components use semantic tokens (`bg-primary`, `text-muted-foreground`, `bg-hivis`, `text-survey`), never raw hex —
except inside Clerk's `appearance` prop, which can't read CSS variables.

---

## Colour

Cool neutrals plus one high-visibility accent. **No orange anywhere**, logo included.

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--paper` → `--background` | `#F4F5F2` | `#0F1214` | Page |
| `--surface` → `--card` | `#FFFFFF` | `#171B1E` | Cards (popover `#1E2327` in dark) |
| `--ink` → `--foreground` | `#0F1214` (17.2:1 on paper) | `#EEF0EC` (16.4:1) | Text; the dark hero/panels |
| `--graphite` → `--muted-foreground` | `#5B6168` (5.7:1 paper, 6.3:1 white) | `#9AA1A8` (6.6:1 on card) | Secondary text |
| `--line` → `--border` | `#D9DCD6` | `#2A2F33` | Hairlines |
| `--input` | `#8A9096` (3.2:1 non-text) | `#737A81` | Form borders |
| `--hivis` → `--primary` | `#E8FF3C` | same | **"Where you are now"** only: current stage, active nav, primary action. Always ink text on it (16.8:1), never white |
| `--survey` → `--link` | `#2E5BFF` (5.2:1 white) | `#7B93FF` (6.7:1 on ink) | Line drawings, links, motion strokes |
| `--ring` | ink | hi-vis | Focus ring |

**Hi-vis on paper is 1.02:1** — invisible on its own. On light surfaces every hi-vis fill gets an ink edge
(`--primary-edge`: 1px border on buttons, inset ring on bar segments and rail nodes). The focus ring is ink on
paper and hi-vis on ink.

Dark mode is its own palette, not an inversion: sidebar `#0B0D0F` < page `#0F1214` < card `#171B1E` < popover `#1E2327`.
`.theme-ink` makes any block an always-dark island (landing hero, login drawing panel).

### Status (never colour alone — icon + label)

| Status | Icon | Light fg / bg | Dark fg / bg |
|--------|------|---------------|--------------|
| `not_started` | `Circle` | `#3F454B` / `#ECEEE9` | `#CFD3D7` / `#22272B` |
| `in_progress` | `CircleDashed` | ink / hi-vis | ink / hi-vis |
| `complete` | `CircleCheck` | `#166534` / `#DCFCE7` | `#86EFAC` / `#052E16` |
| `on_hold` | `CirclePause` | `#1F3FB8` / `#E3E9FF` | `#A9B8FF` / `#17204A` |

---

## Type

All self-hosted via Fontsource (no Google Fonts round-trip on slow 4G).

- **Headings:** Archivo variable at **semi-expanded width** (`font-stretch: 112.5%`), 600–700, tight tracking,
  balanced wrap. Applied to `h1`–`h3` in the base layer; `.stretch-semi` elsewhere.
- **Wordmark:** Archivo **expanded** (`.stretch-expanded`, 125%), 700.
- **Body:** Archivo at normal width, 16px / 1.5, never below 14px.
- **Data:** IBM Plex Mono 400/500 via `.label-mono` (13px, uppercase, +0.04em, tabular) for stage codes,
  counts, timestamps and addresses — `STAGE 04/08 · FRAME`, `11/30`, `09:42`, `14 BANKSIA ST`.
- Trade terms use a non-breaking hyphen (U+2011): "Pre‑construction" never splits. Copy capped at 60ch.

---

## Motif

- **The 8-segment bar** (`<StageBar>`) is the signature, repeated identically in the logo mark, landing hero,
  login card top edge and project card: done = ink (paper on ink surfaces), current = hi-vis, to come = line.
- **Stage rail** (`<StageRail>`): survey line — done = solid ink node + solid connector, current = hi-vis node with
  soft pulse, to come = dashed outline node + dashed connector.
- **Line drawings** in survey blue, one stroke weight. The house drawing (`<HouseDrawing>`) builds in template order.
- **Faint 8px grid** (`.bg-grid`, stronger every 64px) on ink panels; **diagonal hatching** (`.bg-hatch`) for
  "to be supplied" placeholders, labelled `IMG` in mono; **registration ticks** on example cards; **dimension lines**.
- **Icons:** Lucide only, one weight: 1.25px stroke globally (`.lucide` in CSS). 18px in nav and rows.
- **Logo:** ink plate carrying the 8-segment bar with segment 4 in hi-vis + "BFH App" in Archivo Expanded.

---

## Motion

| | Value |
|---|---|
| Hover / press | 120ms |
| Small transitions | 200ms |
| Panels / pages | 320ms |
| Hero sequences | 600–900ms per step, landing and login only |
| Easing | enter `cubic-bezier(0.2,0,0,1)` (`ease-enter`), exit `cubic-bezier(0.4,0,1,1)` (`ease-exit`). No bounce |
| Stagger | 40ms between list items |
| Page change | 8px fade-up, content only (`animate-page-in`, keyed on route); sidebar stays still |

Signature moments: stage segments fill then counts roll up (`useCountUp`); new activity rows slide in from the top
(`animate-row-in`); line drawings draw themselves (`.draw` + `pathLength="1"`); hero bar morphs into the login card's
top edge (View Transitions API via React Router `viewTransition`, `view-transition-name: stage-bar`).
Implemented with CSS + small hooks (`src/client/hooks/use-motion.ts`) — no animation library.

**Reduced motion:** all transitions/animations collapse to ~0ms; sequences jump to the finished state (the hero
shows the completed drawing); view transitions are disabled.

---

## Layout & spacing

Spacing scale **4 / 8 / 12 / 16 / 24 / 32 / 48px**. Radius **6px** (`--radius: 0.375rem`). Flat surfaces, hairline
borders; shadows only on overlays. One content width: max 1200px, 40px side padding ≥768px.
App shell: 224px sidebar ≥768px; top bar + bottom tab bar (≤5 items) below, safe-area aware.

**Touch targets ≥ 44×44px** (gloves). Exception: segmented controls may shrink to 32px under `pointer-fine:`.

---

## Components

- **Primary button:** hi-vis fill, ink text, 1px ink edge (light), 44px, 600. One per screen, top-right in the page header.
- **Unavailable action:** `aria-disabled="true"` (stays focusable) → muted surface + muted text, with the reason in
  a tooltip and visible copy ("Coming in the next update").
- **Page header:** title + one-line description left, primary action right.
- **Sidebar:** "Workspace" group; active = 4px hi-vis bar (ink edge) + ink label, no fill. User block = initials on ink
  (real photo only if uploaded), name, role as plain muted text; block → Account, ⋮ → theme + sign out.
- **Activity row:** bare icon · mono stage tag (survey tint) · sentence · right-aligned mono time.
- **Empty states:** no dashed boxes or icon-in-circle. Show a labelled example ("Example — not real data").
- **Clerk:** flattened inside our own card; flat hi-vis button, ink text, no gradient/shadow/arrow; 6px radius;
  hairlines; "last used" as a mono tag inside the button.

---

## Anti-patterns

- ❌ Orange, cream/terracotta, purple gradients, glassmorphism, backdrop blur
- ❌ Hi-vis as decoration, or with white text, or on paper without an ink edge
- ❌ Inter-everywhere / a single generic sans; mixed icon weights
- ❌ Grey icon-in-square rows, dashed-box empty states, cartoon avatars
- ❌ Status by colour alone; text under 14px outside mono labels; hover-only affordances; bounce easing

---

## Pre-delivery checklist

- [ ] Hi-vis only marks "where you are now"; ink text on it; ink edge on light surfaces
- [ ] Focus visible (ink on paper, hi-vis on ink)
- [ ] Text ≥ 4.5:1 in light and dark
- [ ] Touch targets ≥ 44px
- [ ] `prefers-reduced-motion` shows final states
- [ ] 375 / 768 / 1280px with no horizontal scroll
