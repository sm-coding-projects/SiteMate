# SiteMate — Design System

Summary of the visual system. The full spec (every token, contrast ratio and component rule) is
[`design-system/sitemate/MASTER.md`](../design-system/sitemate/MASTER.md); the tokens are implemented in
[`src/client/styles/globals.css`](../src/client/styles/globals.css). Last reviewed 2026-10-03.

## Who it's for

Office and site managers, often on a phone, outdoors in bright sunlight, sometimes wearing gloves, on patchy 4G.
Every decision below favours **legibility, big targets and low weight** over decoration.

## Direction

**Minimalism / Swiss style** — flat, bordered surfaces, strong type hierarchy, one accent colour.
It should feel like a dependable professional tool, not a marketing site: no hero sections, gradients,
glassmorphism or decorative motion.

Generated with the `ui-ux-pro-max` skill (query: *construction project management field app, B2B dashboard,
trades, mobile-first, outdoor use*; dials variance 3, motion 2, density 7), then corrected by hand — see
"Changes from generated output" in MASTER.md.

## Palette

| | Light | Dark | Why |
|---|---|---|---|
| Primary | Safety orange `#EA580C` with near-black text | `#F97316` | Reads like hi-vis gear; dark text on orange passes AA (5.4:1) where white wouldn't (3.6:1) |
| Text | Slate 900 `#0F172A` on `#F8FAFC` (17:1) | `#F1F5F9` on `#020617` (18:1) | Maximum contrast for sunlight glare |
| Secondary text | Slate 600 `#475569` (7.6:1) | `#94A3B8` (7:1) | AAA even for de-emphasised text |
| Input borders | Slate 500 `#64748B` | same | Meets the 3:1 non-text contrast rule |
| Destructive / success / warning | Red 700, green 700, amber 700 | lighter 400 tints | All ≥ 5:1 |

**Status** (`not_started`, `in_progress`, `complete`, `on_hold`) uses tinted pills that always pair colour
with a Lucide icon (`Circle`, `CircleDashed`, `CircleCheck`, `CirclePause`) and a text label, so status is never
conveyed by colour alone. See `<StatusBadge>`.

## Type

**Inter** (variable), self-hosted via `@fontsource-variable/inter` — no extra Google Fonts round-trip on slow
connections, and the browser only downloads the Latin subset it needs. Chosen for its tall x-height and
tabular figures (use the `.tabular` class for money, dates and counts). Body text is 16px / 1.5, never below 14px.

The generator suggested Playfair Display for body text; that was rejected — a high-contrast serif is hard to
read at small UI sizes in glare.

## Interaction rules

- **Touch targets ≥ 44px** on every control (buttons, menu items, nav, icon buttons) — above WCAG's 24px
  minimum because of gloves.
- **Visible focus**: 2px ring with 2px offset everywhere.
- **Motion**: 150–200ms colour transitions only; all motion disabled under `prefers-reduced-motion`.
- **Layout**: sidebar ≥ 768px; top bar + bottom tab bar (icon + label) below that, safe-area aware.
- **Icons**: Lucide only, never emoji.
- **Theme**: light by default, follows the OS, user can override (Account page or user menu).
