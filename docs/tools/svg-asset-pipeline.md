# SVG Asset Pipeline & AI Self-Evaluation Toolkit

Date: 2026-11-22  
Status: Specification & Implementation Plan v1.0  
Related: [02-assets-and-memory.md](../02-assets-and-memory.md), [1-Stapler_Engine.md](../software_specifications/1-Stapler_Engine.md), [2-Architecture.md](../software_specifications/2-Architecture.md)

---

## 1. Purpose & Problem Statement

Stapler Engine renders 2D characters and paper-cutout props by rasterizing `.svg` files onto high-DPI GPU textures (`SvgTextureLoader.ts`) and displaying them on lit 3D planes with alpha-cutout silhouette shadows (`PaperSprite.ts`).

Authoring SVGs with an LLM "blind" (generating raw XML without inspecting rendered output) consistently fails due to:
1. **Spatial drift:** Detached limbs, asymmetric faces, or shoes floating above the `y = 96` floor anchor.
2. **Style & scale drift:** Inconsistent head-to-body proportions, border widths, or color values across characters and animation frames.
3. **Irregular die-cut borders:** Hand-authoring a smooth, snug `#f9f9f9` sticker outline around every pose and walk-cycle frame is error-prone in raw Bézier coordinates.
4. **Engine shadow defects:** Semi-transparent edges, stray pixels, or overly inflated cutout shapes degrade `PaperSprite`'s `alphaTest = 0.5` `customDepthMaterial` silhouette shadows.

### Objective

Provide a lightweight, local, zero-cloud CLI toolkit (`tools/svg/`) plus a project-scoped agent skill (`.agents/skills/stapler-svg/SKILL.md`) that establishes a reliable **closed-loop visual workflow**:

```text
Author modular SVG ──▶ Auto-generate die-cut border ──▶ Render 4-panel diagnostic PNG + Lint
        ▲                                                              │
        └──────────── Inspect PNG visually & refine coordinates ───────┘
                                       │
                                       ▼ (when approved)
                        Pack multi-frame spritesheet (.svg)
```

---

## 2. Style Anchor & Technical Contract

All character SVGs for *Paper expressions* follow the lineless, flat-shaded geometric paper-cutout style anchored by `games/paper-expressions/public/assets/sprites/unua.svg` (evolved from root `Unua.svg`).

### 2.1 Canvas & Grounding Contract
- **ViewBox (single frame):** `viewBox="0 0 100 100"`, `width="100mm" height="100mm"` (or `100`×`100` unit aspect).
- **ViewBox (multi-frame spritesheet):** `viewBox="0 0 (cols*100) (rows*100)"`, aligned to exact `100 × 100` cells matching `PaperSprite`'s `columns` and `rows` UV slicing.
- **Floor baseline:** Bottom of shoes sits at `y ≈ 95.5–96.0`; bottom edge of the `#f9f9f9` paper border sits at `y ≈ 96.5–97.5`. `SvgTextureLoader` bottom-anchors textures, and `PaperSprite.groundOffset` seats feet flush on `y = 0`.
- **Safe margins:** Keep all artwork (including `#cutout_border`) inside `x ∈ [4, 96]`, `y ∈ [4, 98.5]` so nothing clips when rasterized.

### 2.2 Anatomical Reference (Unua Baseline, `0..100` Units)
Characters should vary in height, silhouette, hair, and outfit, while sharing this geometric visual grammar:

| Region | Unua Baseline (`y` range) | Style Notes |
| :--- | :--- | :--- |
| **Die-cut border** | `y ≈ 15.0 .. 97.0` | Smooth `#f9f9f9` backing, ~`3.0–3.8` units snug around the silhouette. |
| **Head & hair** | `y ≈ 19.5 .. 52.2` | ~40% of character height; stylized rounded-geometric head (`x ≈ 33..62`), slight 3/4 rightward gaze (eyes near `x=46` and `x=55.4`, center `x≈50`). |
| **Facial features** | `y ≈ 36.0 .. 48.5` | Minimalist lineless shapes: vertical pill/oval eyes, crisp rectangular brows, short bar/curve mouth (`#483737`). |
| **Torso & clothing** | `y ≈ 51.0 .. 79.5` | Simple trapezoidal torso/skirt/coat panels, angled trapezoid sleeves, pill-shaped hands (`rx ≈ 4, ry ≈ 2.1`). |
| **Legs, socks & shoes** | `y ≈ 78.6 .. 96.0` | Straight rectangular legs (`width ≈ 3.2`), distinct socks, quarter-arch rounded shoes seated flat at `y ≈ 96`. |

### 2.3 Rendering & Authoring Rules
- **Lineless flat shading:** Use flat hex `fill` colors with `stroke="none"`. Avoid gradients, blur filters, or sketchy outlines on characters.
- **Light clothing separation:** White/light garments (e.g., lab coats, scrubs, white socks) MUST be subtly tinted (`#e3dedb`, `#dee3db`, `#cccccc`, `#e8e4dc`) so they stay legible against the `#f9f9f9` sticker cutout border.
- **Hard cutout silhouette:** All silhouette-contributing shapes must have `opacity="1"` (`fill-opacity="1"`) to match Three.js `alphaTest = 0.5`, `transparent: false`.
- **Browser-safe SVG 1.1:** Output standard `<path>`, `<rect>`, `<ellipse>`, `<circle>`, `<polygon>` elements with baked geometry—never rely on unbaked Inkscape-only Live Path Effects (`inkscape:path-effect` without a matching `d` path).
- **Modular semantic groups:** Structure character SVGs with predictable named groups so emotions, walk frames, and manual Inkscape tweaks are fast:
  - `cutout_border` (first child, auto-generated or hand-edited)
  - `hair_back` (optional)
  - `arm_back` (optional)
  - `legs` (with `leg_left`, `leg_right`)
  - `torso`
  - `head`
  - `face`
  - `hair_front`
  - `arm_front`
  - `props` (optional handhelds/satchels/accessories)

---

## 3. Functional Requirements

### FR-1: Diagnostic Preview & Linter (`tools/svg/svg_preview.py`)
CLI entry point: `npm run svg:preview -- <input.svg> [options]`

1. **Accurate Rasterization:** Render the target SVG (and reference anchor SVG) using the local `inkscape` CLI to PNG.
2. **4-Panel Diagnostic Image:** Generate a single composite PNG (default `1024×1024`, 4 panels of `512×512`) saved to `.cache/svg-previews/<stem>_preview.png` (or custom `--out`):
   - **Panel 1 (Top-Left) — Coordinate Grid & Proportion Guides:** Target SVG rendered over dark slate (`#2b2d38`) with a crisp 10×10 coordinate grid (`0..100` labeled every 10 units), vertical center guide (`x = 50`), highlighted floor baseline (`y = 96`), and subtle Unua proportion bands (`y = 20, 52, 79`).
   - **Panel 2 (Top-Right) — Style Anchor Comparison:** Target SVG rendered side-by-side with the style anchor (`games/paper-expressions/public/assets/sprites/unua.svg`, overridable via `--ref`) on `#2b2d38`, sharing a continuous `y = 96` floor line so scale, head ratio, palette, and border thickness can be compared at a glance.
   - **Panel 3 (Bottom-Left) — `alphaTest = 0.5` Shadow Silhouette:** Binary silhouette mask (`alpha >= 128` painted solid charcoal on warm paper `#e8e2d5`) mimicking `PaperSprite`'s `customDepthMaterial` shadow, with drawn bounding-box dimensions in SVG units.
   - **Panel 4 (Bottom-Right) — Light-Background Contrast Check:** Target SVG rendered over a subtle light checkerboard (`#dedede` / `#cfcfcf`) to verify `#f9f9f9` cutout edges and light clothing contrast.
3. **Spritesheet Mode (`--sheet <cols>x<rows>`):** When inspecting a multi-frame SVG spritesheet, overlay cell boundaries (`cols × rows`), per-cell baselines, and frame labels (`r0c0`, `r0c1`, …) in Panel 1, and compare frame `(0, 0)` against the reference anchor in Panel 2.
4. **Automated Linter Report (stdout):**
   - Validates XML well-formedness and root `<svg>` `viewBox`.
   - Measures true rasterized alpha bounding box in SVG units (`x_min..x_max`, `y_min..y_max`, width, height) and checks floor grounding (`y_max` within `[92.0, 99.0]`) and edge clipping (`x_min >= 1.0`, `x_max <= 99.0`, `y_min >= 1.0`).
   - Checks for presence of `id="cutout_border"` (or `#f9f9f9` backing), semantic `<g id="...">` groups, external `<image>`/`href` links, `<filter>` usage, and partial outer opacity warnings.
   - Prints a concise `PASS` / `WARN` / `FAIL` summary (`--strict` exits non-zero on `WARN`/`FAIL`).

### FR-2: Automatic Paper-Cutout Border Generator (`tools/svg/svg_border.py`)
CLI entry point: `npm run svg:border -- <input.svg> [options]`

1. **Idempotent Execution:** Automatically removes any existing element with `id="cutout_border"` before generating a fresh border, so repeated runs after character edits never double-pad the outline.
2. **Smooth Die-Cut Contour Generation:**
   - Renders the borderless character SVG at high resolution (`5×` scale, e.g., `500×500` for a `100×100` viewBox) via Inkscape.
   - Extracts the hard `alpha >= 128` silhouette mask.
   - Applies circular morphological dilation (`--padding`, default `3.2` SVG units) plus gentle morphological closing (`--close`, default `1.2` SVG units) via ImageMagick (`magick`) to bridge narrow concavities cleanly and produce a tactile paper-sticker edge.
   - Vectorizes the dilated 1-bit mask using `potrace --svg` with smooth curve optimization (`--alphamax`, `--opttolerance`) into a compact, minimal-node cubic Bézier `<path>`.
   - Maps coordinates cleanly into the target SVG's `viewBox` (no awkward wrapper transforms left behind) and injects `<path id="cutout_border" fill="#f9f9f9" stroke="none" d="..."/>` as the first child of the primary `<g>` layer (or `<svg>` root).
3. **Configurable Options:**
   - `--out <path>` (writes to a new file instead of in-place overwrite).
   - `--padding <float>` (default `3.2` SVG units).
   - `--color <hex>` (default `#f9f9f9`).
   - `--floor-clip <y>` / `--no-floor-clip` (default `97.0`: trims the bottom paper standee edge flat at `y = 97.0` matching Unua so grounded characters never bulge past `y = 100`; disable for floating cutouts like clouds).
4. **Clip Detection:** Warns if the generated border touches the `0..100` viewBox edges.

### FR-3: Multi-Frame Spritesheet Packer (`tools/svg/svg_pack.py`)
CLI entry point: `npm run svg:pack -- --cols <C> --rows <R> --out <sheet.svg> <frame1.svg> [frame2.svg ...]` (or `--config <pack.json>`)

1. **Deterministic Grid Packing:** Places each `100×100` input SVG into its `(col, row)` cell in row-major order inside a combined `viewBox="0 0 (cols*100) (rows*100)"` SVG.
2. **Safe ID Scoping:** Prefixes all `id="..."`, `url(#...)`, `href="#..."`, and `xlink:href="#..."` attributes per frame (`f{idx}_<id>`) so multiple frames sharing `<defs>` or semantic group names never collide in the browser DOM.
3. **Manifest Snippet Output:** Prints a ready-to-paste TypeScript `SpriteAnimationSpec` block (`columns`, `rows`, `renderWidth`, `renderHeight`, suggested `animations`) aligned with `packages/stapler-engine/src/types/contracts.ts`.

### FR-4: Persistent Agent Skill (`.agents/skills/stapler-svg/SKILL.md`)
- Provides progressive-disclosure instructions automatically discovered in this workspace whenever creating or editing SVG sprites/cutouts.
- Documents the exact Unua style anchor measurements, palette guidelines, semantic group conventions, CLI commands, and the mandatory **Render → Inspect → Refine** visual verification loop (minimum 2 inspection passes before completion).

---

## 4. Non-Functional Requirements & Guardrails

1. **Strict Engine Decoupling:** All tooling lives in `tools/svg/`; `packages/stapler-engine/` remains 100% untouched with zero tool or game dependencies.
2. **Zero Extra `npm` Dependencies:** Uses existing local system binaries (`python3`, `Pillow`, `inkscape`, `magick`, `potrace`). Scripts must emit clear, actionable error messages if a binary is missing.
3. **Clean Repository Hygiene:** Default preview outputs write into `.cache/svg-previews/`, which is excluded in `.gitignore`.
4. **Fast Iteration Loop:** Generating a border + 4-panel preview must complete in a few seconds so multi-pass agent self-refinement stays cheap and interactive.
5. **Inkscape Interoperability:** Generated and border-injected SVGs must open cleanly in Inkscape for optional manual finishing by the user.

---

## 5. Planned File Layout

```text
.
├── .gitignore                            # Add .cache/ for local preview outputs
├── package.json                          # Add svg:preview, svg:border, svg:pack scripts
├── docs/
│   └── tools/
│       └── svg-asset-pipeline.md         # This requirements & design specification
├── .agents/
│   └── skills/
│       └── stapler-svg/
│           └── SKILL.md                  # Reusable agent workflow & style anchor skill
└── tools/
    └── svg/
        ├── svg_common.py                 # Shared XML helpers, Inkscape render wrapper, viewBox parser
        ├── svg_preview.py                # 4-panel diagnostic PNG generator + SVG linter
        ├── svg_border.py                 # Idempotent automatic #f9f9f9 die-cut border generator
        └── svg_pack.py                   # Multi-frame SVG spritesheet packer + manifest snippet
```

---

## 6. Verification Plan

Before marking the toolkit complete, verify every requirement end-to-end:
1. Run `npm run svg:preview -- games/paper-expressions/public/assets/sprites/unua.svg` and visually inspect the generated 4-panel PNG to verify grid accuracy, floor baseline alignment, side-by-side layout, and `alphaTest` shadow mask.
2. Create a temporary borderless test character SVG in scratch, run `svg_border.py` twice to verify smooth contour quality and idempotency, then inspect it via `svg_preview.py`.
3. Pack a 2-frame test spritesheet via `svg_pack.py` and verify it via `svg_preview.py --sheet 2x1`.
4. Confirm existing engine checks (`npm run typecheck`, `npm test`) continue passing cleanly.
