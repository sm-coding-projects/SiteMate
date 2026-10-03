# SiteMate — Design System

Summary of the visual system. The full spec is [`design-system/sitemate/MASTER.md`](../design-system/sitemate/MASTER.md);
tokens are in [`src/client/styles/globals.css`](../src/client/styles/globals.css). Last reviewed 2026-10-03.

## Who it's for

Office and site managers, often on a phone, outdoors in bright sunlight, sometimes wearing gloves, on patchy 4G.

## Direction: "Site Survey"

The look comes from construction drawings and survey markings: cool paper, ink linework, survey-blue drawings,
and one hi-vis yellow-green accent that only ever means **"where you are now"** — the current stage, the active
nav item, the primary action. Monospaced data labels (`STAGE 04/08 · FRAME`) make it read like a drawing set.

The 8-segment build bar is the brand: it's the logo mark, the hero, the top edge of the login card and the
progress bar on every project.

## Palette

| | Light | Dark |
|---|---|---|
| Paper / surface | `#F4F5F2` / `#FFFFFF` | `#0F1214` / `#171B1E` |
| Ink (text) | `#0F1214` | `#EEF0EC` |
| Graphite (secondary) | `#5B6168` | `#9AA1A8` |
| Line | `#D9DCD6` | `#2A2F33` |
| Hi-vis | `#E8FF3C`, ink text, ink edge on paper | same |
| Survey | `#2E5BFF` | `#7B93FF` |

Hi-vis against paper is only 1.02:1, so on light surfaces it always carries an ink edge and the focus ring is ink.

## Type

Archivo (variable, with width axis) for everything: semi-expanded for headings, expanded for the wordmark,
normal width for body. IBM Plex Mono for codes, counts, times and addresses. All self-hosted.

## Interaction rules

- Touch targets ≥ 44px; visible focus everywhere; Lucide icons at one 1.25px weight.
- Motion: 120ms hover, 200ms small, 320ms panels/pages, enter `cubic-bezier(0.2,0,0,1)`, 40ms list stagger, no bounce.
  Everything respects `prefers-reduced-motion` (sequences show their final state).
- Light by default, follows the OS, user can override (Account page or user menu).
