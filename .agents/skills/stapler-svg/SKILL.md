---
name: stapler-svg
description: >-
  Author, visually self-evaluate, refine, and pack lineless geometric paper-cutout
  SVG sprites, portraits, and 2D props for Stapler Engine (Paper expressions) using
  the Unua style anchor and the local tools/svg/ CLI pipeline. Use whenever creating
  or editing character SVGs, expressions, walk cycles, or 2D paper-cutout props.
---

# Stapler Engine — SVG Asset Authoring & Visual Refinement Skill

Use this workflow whenever creating or modifying `.svg` sprites, portraits, walk-cycle sheets, or 2D paper cutouts for **Stapler Engine** / *Paper expressions*.

Never author an SVG "blind" and stop after writing XML. Always run the closed-loop **Write → Border → Preview → Inspect → Refine** cycle using the local toolkit in `tools/svg/`.

---

## 1. Style Anchor & Anatomical Contract

**Master Reference:** `games/paper-expressions/public/assets/sprites/unua.svg` (also check any concept sheets in `Concept Art/SVG and example character/`).

- **Canvas:** `viewBox="0 0 100 100"`, `width="100mm" height="100mm"`.
- **Floor grounding:** Bottom of shoes sits at `y ≈ 95.5–96.0`; the `#f9f9f9` sticker cutout bottom sits near `y ≈ 97.0`. Keep all geometry (including border) within `x ∈ [4, 96]`, `y ∈ [4, 98.5]`.
- **Unua reference proportions (`0..100`):**
  - Head & hair: `y ≈ 20..52` (~40% of character height), rounded geometric head, slight 3/4 rightward gaze (eyes near `x ≈ 46` and `x ≈ 55.4`, center `x ≈ 50`).
  - Face features: `y ≈ 36..48.5` — vertical pill eyes, crisp rectangular brows, short bar/curve mouth (`#483737`).
  - Torso & outfit: `y ≈ 51..79` — clean trapezoids/curves for torso, coat, skirt/trousers; angled trapezoid sleeves; oval hands (`rx ≈ 4, ry ≈ 2.1`).
  - Legs, socks & shoes: `y ≈ 78.6..96.0` — straight rectangular legs (`width ≈ 3.2`), socks, rounded quarter-arch shoes flat on `y = 96`.
  - Vary silhouette, height, hair, and outfit per character (e.g., taller bearded Professor Turrialba, Chloe's orange shirt & dark gray trousers, Ada's green beret, oversized round glasses & satchel) while keeping the same lineless geometric paper-cutout language.
- **Visual rules:**
  - **Lineless flat shading:** Flat hex fills with `stroke="none"`. Avoid gradients, blur `<filter>`s, or sketchy linework.
  - **Light clothing separation:** Tint white garments slightly (`#e3dedb`, `#dee3db`, `#cccccc`, `#e8e4dc`) so they remain distinct from the `#f9f9f9` cutout backing.
  - **Hard alpha (`alphaTest = 0.5`):** Keep `opacity="1"` on all silhouette-contributing elements so Three.js `PaperSprite` shadows stay crisp.
  - **Browser-safe SVG 1.1:** Emit pure `<path>`, `<rect>`, `<ellipse>`, `<polygon>` shapes. Never rely on unbaked Inkscape path effects.

## 2. Modular Group Structure

Author characters cleanly with named `<g id="...">` groups (in back-to-front painter's order) so emotions, walk frames, and manual Inkscape edits stay fast:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <g id="character_root">
    <!-- id="cutout_border" is injected here automatically by svg:border -->
    <g id="hair_back">...</g>
    <g id="arm_back">...</g>
    <g id="legs">
      <g id="leg_left">...</g>
      <g id="leg_right">...</g>
    </g>
    <g id="torso">...</g>
    <g id="head">...</g>
    <g id="face">...</g>
    <g id="hair_front">...</g>
    <g id="arm_front">...</g>
    <g id="props">...</g>
  </g>
</svg>
```

## 3. Mandatory Closed-Loop Workflow

1. **Draft the modular SVG** without manually guessing the white sticker outline. Keep coordinates crisp (1–2 decimal places) and aligned to the `0..100` anatomy above.
2. **Generate the die-cut paper border** (idempotent — safe to re-run after every edit):
   ```bash
   npm run svg:border -- <path/to/sprite.svg>
   ```
   Optional flags: `--padding 3.2 --close 1.2 --color "#f9f9f9" --floor-clip 97.0` (use `--no-floor-clip` for floating cutouts like clouds).
3. **Render the 4-panel diagnostic preview & linter**:
   ```bash
   npm run svg:preview -- <path/to/sprite.svg>
   ```
   This prints lint status (`PASS`/`WARN`/`FAIL`) and writes `.cache/svg-previews/<stem>_preview.png`.
4. **Inspect the PNG directly with `read_file`** and critique every panel explicitly:
   - **Panel 1 (Grid & Guides):** Check exact `(x, y)` coordinates against the 10-unit grid, `x = 50` center, and `y = 96` floor line. Fix floating shoes, detached limbs, or lopsided eyes using exact unit deltas.
   - **Panel 2 (Side-by-Side vs Unua):** Verify scale, head-to-body ratio, border snugness, and color harmony next to Unua.
   - **Panel 3 (`alphaTest = 0.5` Shadow Silhouette):** Verify the cast shadow reads cleanly with no stray pixels, jagged artifacts, or clipping.
   - **Panel 4 (Light Contrast):** Verify `#f9f9f9` edges and light clothing read cleanly on bright floors.
5. **Refine and re-verify:** Edit the SVG, re-run `svg:border` (if silhouette changed) and `svg:preview`, and inspect the new PNG. Complete **at least 2 visual inspection passes** (or repeat until lint passes with zero visual defects).

## 4. Emotions & Multi-Frame Walk Cycles

- **Emotion variants / dialogue portraits:** Duplicate the approved character master SVG and edit only `#face` (eyes, brows, mouth) plus small transforms on `#arm_left`/`#arm_right`/`#props`. Re-run `svg:border` + `svg:preview`.
- **Walk cycles & spritesheets:** Create per-frame SVGs by transforming `#leg_left`, `#leg_right`, `#arm_back`, `#arm_front` and subtle head/torso bob (`1–2` units), run `svg:border` per frame, then pack with:
  ```bash
  npm run svg:pack -- --cols 4 --rows 1 --out <sheet.svg> <f0.svg> <f1.svg> <f2.svg> <f3.svg>
  ```
  (or `--config <pack.json>`). Verify the packed sheet with:
  ```bash
  npm run svg:preview -- <sheet.svg> --sheet 4x1
  ```
  Use the printed `SpriteAnimationSpec` snippet to wire the sheet into `games/paper-expressions/src/manifest.ts`.
