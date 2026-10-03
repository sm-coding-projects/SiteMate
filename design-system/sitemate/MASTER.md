# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/sitemate/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** SiteMate
**Generated:** 2026-10-03 (ui-ux-pro-max v2.13.0), then corrected by hand — see "Changes from generated output"
**Category:** Construction / field operations tool (B2B, mobile-first, outdoor use)
**Design Dials:** Variance 3/10 (Centered / Minimal) | Motion 2/10 (Subtle) | Density 7/10 (Standard)

**Implementation:** tokens live in `src/client/styles/globals.css` (Tailwind v4 + shadcn/ui CSS variables).
Components must use semantic tokens (`bg-primary`, `text-muted-foreground`, `status-*`), never raw hex.

---

## Global Rules

### Color Palette — Light (default)

| Role | Hex | Token | Contrast |
|------|-----|-------|----------|
| Background | `#F8FAFC` | `--background` | — |
| Foreground | `#0F172A` | `--foreground` | 17.1:1 AAA |
| Card | `#FFFFFF` | `--card` | — |
| Card foreground | `#0F172A` | `--card-foreground` | 17.9:1 AAA |
| Primary (safety orange) | `#EA580C` | `--primary` | — |
| Primary foreground | `#0B0F14` | `--primary-foreground` | 5.4:1 AA |
| Secondary | `#E2E8F0` | `--secondary` | — |
| Secondary foreground | `#0F172A` | `--secondary-foreground` | AAA |
| Muted | `#F1F5F9` | `--muted` | — |
| Muted foreground | `#475569` | `--muted-foreground` | 7.6:1 on card (AAA), 6.9:1 on muted |
| Accent (hover surface) | `#F1F5F9` | `--accent` | — |
| Destructive | `#B91C1C` | `--destructive` | white text 6.5:1 |
| Success | `#15803D` | `--success` | 5.0:1 on white |
| Warning | `#B45309` | `--warning` | 5.0:1 on white |
| Border (decorative) | `#CBD5E1` | `--border` | — |
| Input border | `#64748B` | `--input` | 4.8:1 (meets 3:1 non-text) |
| Focus ring | `#0F172A` | `--ring` | 17:1 |

### Color Palette — Dark

| Role | Hex | Token | Contrast |
|------|-----|-------|----------|
| Background | `#020617` | `--background` | — |
| Foreground | `#F1F5F9` | `--foreground` | 18.4:1 AAA |
| Card | `#0F172A` | `--card` | fg 16.3:1 |
| Primary | `#F97316` | `--primary` | fg `#0B0F14` 6.9:1 |
| Muted | `#1E293B` | `--muted` | — |
| Muted foreground | `#94A3B8` | `--muted-foreground` | 7.0:1 on card |
| Destructive | `#F87171` | `--destructive` | fg `#0B0F14` 7.0:1 |
| Border | `#334155` / input `#64748B` | `--border` / `--input` | input 3.8:1 |
| Focus ring | `#FDBA74` | `--ring` | 12:1 |

### Status colours (never colour alone — always icon + label)

| Status | Lucide icon | Light fg / bg | Dark fg / bg |
|--------|-------------|---------------|--------------|
| `not_started` | `Circle` | `#334155` / `#F1F5F9` (9.5:1) | `#CBD5E1` / `#1E293B` |
| `in_progress` | `CircleDashed` | `#9A3412` / `#FFEDD5` (6.4:1) | `#FDBA74` / `#431407` |
| `complete` | `CircleCheck` | `#166534` / `#DCFCE7` (6.5:1) | `#86EFAC` / `#052E16` |
| `on_hold` | `CirclePause` | `#1E40AF` / `#DBEAFE` (7.2:1) | `#93C5FD` / `#172554` |

Project status `active` / `archived` reuse `in_progress` / `not_started` styling with their own icons
(`HardHat`, `Archive`).

### Typography

- **Font:** Inter (variable, self-hosted via `@fontsource-variable/inter` — no Google Fonts request on slow 4G)
- **Numbers:** `font-variant-numeric: tabular-nums` for money, dates and counts
- **Scale:** body 16px / 1.5 (never below 14px for secondary text), labels 14px/600, page title 24px/700
  (28px ≥768px), section title 18px/600
- **Mono:** system `ui-monospace` stack for ids/ABNs only

### Spacing

Tailwind's 4px scale. Standard padding 16px (mobile) / 24px (≥768px). Gap between touch targets ≥ 8px.

### Touch targets

Minimum **44×44px** for every interactive element (buttons `h-11`, icon buttons `size-11`, nav items ≥ 56px tall
on the mobile tab bar). This is above WCAG's 24px web minimum on purpose — users may wear gloves.

### Radius & elevation

Radius 8px (`--radius: 0.5rem`). Flat surfaces with 1px borders; shadows only for overlays (menus, dialogs).
No hover lift transforms.

---

## Component Specs

- **Primary button:** `bg-primary text-primary-foreground`, 44px tall, 600 weight, hover = 8% darker, no transform.
  One primary action per screen.
- **Secondary button:** `bg-secondary`; **outline** for tertiary; **ghost** only inside toolbars/menus.
- **Inputs:** 44px tall, 16px font (prevents iOS zoom), 1px `--input` border, visible label above, error text below.
- **Cards:** `bg-card` + `border`, radius 8px, 16–24px padding, no shadow.
- **Status badge:** pill, icon + text, tinted bg + strong fg from the status table.
- **Focus:** 2px `--ring` outline with 2px offset on every focusable element (`focus-visible`).
- **Modals:** solid overlay `rgba(2,6,23,0.6)` — no backdrop blur.

---

## Style Guidelines

**Style:** Minimalism & Swiss Style — clean, functional, high contrast, grid-based, sans-serif.

**Page pattern:** App shell (not a marketing page). Desktop: fixed left sidebar (240px) + content column (max 1200px).
Mobile: top app bar + bottom tab bar (≤ 5 items, icon + label) respecting `env(safe-area-inset-bottom)`.

**Motion:** 150–200ms colour/opacity transitions only. No scroll reveals, no GSAP, no parallax.
All transitions disabled under `prefers-reduced-motion: reduce`.

---

## Anti-Patterns (Do NOT Use)

- ❌ Hero sections, marketing layouts, decorative illustrations
- ❌ AI purple/pink gradients, glassmorphism, backdrop blur
- ❌ Status conveyed by colour alone
- ❌ Emojis as icons — Lucide only
- ❌ Gray-on-gray low-contrast text; text under 14px
- ❌ Hover-only affordances (touch users can't hover)
- ❌ Layout-shifting hover transforms
- ❌ Invisible focus states

---

## Pre-Delivery Checklist

- [ ] No emojis used as icons; Lucide only
- [ ] All interactive elements ≥ 44×44px with `cursor-pointer`
- [ ] Text contrast ≥ 4.5:1 (body ≥ 7:1) in light and dark
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive at 375px, 768px, 1280px — no horizontal scroll
- [ ] No content hidden behind the fixed tab bar / safe area

---

## Changes from generated output

| Generated | Changed to | Why |
|-----------|-----------|-----|
| Pattern: Hero-Centric Design | App shell (sidebar / bottom tabs) | SiteMate is an authenticated tool, not a landing page |
| Body font: Playfair Display | Inter | Serif display face is poor for small UI text in sunlight; Inter has a tall x-height and tabular figures |
| Primary `#64748B` slate, accent orange | Primary = safety orange, neutrals slate | Brief asked for one construction accent; orange-with-dark-text reads like hi-vis gear |
| Foreground `#334155` | `#0F172A` | Maximum contrast outdoors |
| Border `#E2E8F0` on inputs | `#64748B` input border | Light border failed 3:1 non-text contrast |
| GSAP scroll reveal | None | Motion dial 2; no scroll-driven content in an app shell |
| Card hover lift / shadow | Flat bordered cards | Avoid layout shift; cards aren't all clickable |
| Modal backdrop blur | Solid overlay | Brief forbids glassmorphism; cheaper on low-end phones |
