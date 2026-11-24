---
name: stapler-svg
description: >-
  Inspect, rig, lightly polish, and compile walk-cycle workbooks for hand-drawn
  Stapler Engine characters, or decorate background NPCs from base_npc.svg using
  tools/svg/ with developer feedback checkpoints.
---

# Stapler Engine — SVG Pipeline Skill

Keep SVG work tool-driven, minimal, and guided by developer feedback.

## 1. Scope & Core Rules

1. **Main characters (`Chloe`, `Unua`, `Ada`, `Turrialba`) are hand-drawn by the developer in Inkscape.** Never redesign or redraw them from scratch. AI inspects, rigs, applies light requested polish, prepares 4-frame walk workbooks, and compiles bordered spritesheets + GIF previews.
2. **Background NPCs start from `base_npc.svg`.** Never draw a character body from an empty canvas. Initialize with `npm run svg:npc` (`tools/svg/templates/base_npc.svg`), decorate `#hair_back`/`#hair_front`/`#torso`/`#props`, and animate with `svg:pose`.
3. **Never hand-rewrite Bezier `<path d="...">` to animate.** Use `svg:workbook` + Inkscape hand-sculpting + `svg:compile-sheet` for polished main-cast walk cycles, or `svg:pose` group transforms for background NPCs.
4. **Engine visual invariants:** `viewBox="0 0 100 100"` per cell, flat fills (`stroke="none"`, `opacity="1"`), boots grounded near `y = 96`, `#f9f9f9` `cutout_border` clipped at `y = 97`, light garments subtly tinted for contrast against `#f9f9f9` and snowy floors.

## 2. CLI Toolkit (`tools/svg/`)

- **Inspect hand-drawn SVG (always run first before editing):**
  `npm run svg:inspect -- <input.svg>`
- **Rig flat Inkscape IDs into semantic groups (zero pixel shift):**
  `npm run svg:rig -- <input.svg> --map <rig.json> --out <rigged.svg>`
- **Create 6-frame Inkscape walk workbook (main cast, stored in `assets-src/sprites/`):**
  `npm run svg:workbook -- <rigged.svg> --out <assets-src/..._workbook.svg> [--frames 6|4]`
- **Compile workbook(s) + idle into bordered spritesheet, 4-panel PNG, and animated GIF:**
  `npm run svg:compile-sheet -- <sheet_recipe.json>`
- **Initialize background NPC from base mannequin:**
  `npm run svg:npc -- <out.svg> [--skin HEX --hair HEX --coat HEX --bottoms HEX --height 1.0]`
- **Quick puppet animation for background NPCs:**
  `npm run svg:pose -- <npc.svg> --preset {idle,walk} [--amplitude 1.0] [--pack <sheet.svg>]`
- **Refresh `#f9f9f9` border / render 4-panel diagnostic preview:**
  `npm run svg:border -- <file.svg> [--replace-backdrop]`
  `npm run svg:preview -- <file.svg> [--sheet <CxR>]` (inspect PNG with `read_file`)

## 3. Mandatory Developer Checkpoints

- **Checkpoint 1 — Base / Polish Gate:** After rigging/polishing a hand-drawn character (keep the developer's source SVG untouched unless asked) or decorating an NPC from `base_npc.svg`, show `svg:preview` and **pause for feedback**.
- **Checkpoint 2 — Animation Gate:** After running `svg:compile-sheet` (or `svg:pose`), present the `--sheet` preview PNG and animated `.gif` path for developer review before wiring into `manifest.ts`.
