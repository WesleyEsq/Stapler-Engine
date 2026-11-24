# SVG Asset Pipeline — Human-First, Mannequin & Puppet Workflow

Date: 2026-11-23  
Status: Specification v2.0 (Restructured)  
Related: [02-assets-and-memory.md](../02-assets-and-memory.md), [1-Stapler_Engine.md](../software_specifications/1-Stapler_Engine.md), [2-Architecture.md](../software_specifications/2-Architecture.md)

---

## 1. Why v1 Was Replaced

v1 assumed an LLM could author full character SVGs from scratch in raw XML as long as it inspected a 4-panel PNG preview. In practice:
1. **Freehand SVG character design fails in LLMs:** Even with self-feedback, generating organic Bezier hair, clothing silhouettes, and balanced proportions from zero produces stiff or drifting shapes.
2. **Hand-authored Inkscape SVGs deceive raw XML readers:** Real Inkscape files (`Chloe.svg`, `Unua.svg`) contain flat `<path id="path14">` lists, `transform="matrix(...)"` skews, and `inkscape:path-effect`s where raw XML attributes do not match visual `(x, y)` coordinates.
3. **Bezier-edited animation frames break consistency:** Rewriting `d="m ..."` per walk frame distorts limbs and silhouettes.
4. **Verbose rules dilute AI focus:** Long anatomical coordinate tables in `SKILL.md` hurt compliance rather than helping.

---

## 2. New Division of Responsibilities

| Asset Type | Who Designs Base Art | What the AI Pipeline Does |
| :--- | :--- | :--- |
| **Main Cast** (`Chloe`, `Unua`, `Ada`, `Turrialba`) | **Developer by hand in Inkscape** | Inspects true visual bounds (`svg:inspect`), rigs into semantic groups without shifting pixels (`svg:rig`), applies light polish + snug `#f9f9f9` border (`svg:border`), and generates simple puppet animations/expressions (`svg:pose` + `svg:pack`). |
| **Generic / Background NPCs & Simple 2D Props** | **AI starting from `base_npc.svg`** | Clones `tools/svg/templates/base_npc.svg` (`svg:npc`), customizes palette and simple geometric hair/winter-clothing layers on top of the pre-rigged figure, borders, and previews. Never draws a body from scratch. |
| **Art Direction & Course Correction** | **Developer Checkpoints** | AI pauses and shows preview PNGs to the developer after **(1) base rig/polish or NPC decoration** and **(2) animation/expression sheet generation** before proceeding. |

---

## 3. Pipeline Architecture & CLI Toolkit (`tools/svg/`)

```text
Hand-drawn Inkscape SVG (e.g. Chloe.svg)        tools/svg/templates/base_npc.svg
                 │                                              │
                 ▼                                              ▼
      1. svg:inspect (true 0..100                   1. svg:npc (clone pre-rigged
         coords + annotated ID map)                    mannequin & decorate gear)
                 │                                              │
                 ▼                                              │
      2. svg:rig (group existing IDs                            │
         into head/face/torso/arms/legs)                        │
                 └──────────────────────┬───────────────────────┘
                                        ▼
                       3. svg:border + svg:preview
                                        │
                                        ▼
                    ★ DEVELOPER CHECKPOINT 1 (Approve base) ★
                                        │
                                        ▼
                 4. svg:pose (puppet joint rotate/translate
                    per frame + auto-border) ──▶ svg:pack
                                        │
                                        ▼
                    ★ DEVELOPER CHECKPOINT 2 (Approve anim) ★
```

### 3.1 `svg_inspect.py` (`npm run svg:inspect -- <input.svg>`)
- Runs `inkscape --query-all` combined with XML parsing so `matrix(...)` transforms and Inkscape path effects are resolved into **true visual `0..100` viewBox coordinates**.
- Prints a compact z-ordered element table (`id`, `tag`, `group/label`, `fill`, `x:[x0..x1]`, `y:[y0..y1]`, `center`, warnings such as zero-area stroke-less paths or ungrouped layers).
- Renders `.cache/svg-previews/<stem>_inspect.png` with numbered/ID callouts so neither the AI nor the developer ever guesses which `pathNN` is which body part.

### 3.2 `svg_rig.py` (`npm run svg:rig -- <input.svg> --map <rig.json> --out <rigged.svg>`)
- Reorganizes flat Inkscape elements by ID into standard semantic `<g id="...">` groups (`cutout_border`, `hair_back`, `arm_back`, `leg_left`, `leg_right`, `torso`, `head`, `face`, `hair_front`, `arm_front`, `props`) **without rewriting `<path d="...">` coordinates**.
- Flattens wrapper layer transforms safely if needed, upgrades any hand-drawn `#f9f9f9` backing path to `id="cutout_border"`, and removes dead/unreferenced elements listed in `drop`.

### 3.3 `svg_border.py` (`npm run svg:border -- <input.svg>`)
- Idempotently generates a smooth `#f9f9f9` sticker cutout (`id="cutout_border"`) via Inkscape rasterization + ImageMagick circular morphological dilation/closing + Potrace cubic Bezier tracing, trimmed flat at `--floor-clip 97.0`.
- Auto-detects and replaces legacy hand-drawn `#f9f9f9` full-character backdrop paths when `--replace-backdrop` is enabled (or when `id="cutout_border"` is already present) to prevent double-padding.

### 3.4 `svg_pose.py` (`npm run svg:pose -- <rigged.svg> ...`)
- Generates animation frames or expression variants **by applying clean SVG transforms (`translate`, `rotate` around auto-detected joint pivots, `scale`, visibility toggles) to rigged `<g>` groups** rather than mutating Bezier curves.
- Joint pivots default intelligently from each group's true bounding box (`top` = hip/shoulder for legs & arms, `bottom` = neck for head, `center` for body/props) or accept explicit `[px, py]`.
- Built-in presets for fast iteration (`idle`, `walk` 4-frame cycle) plus custom `--spec <poses.json>` for tailored animations and developer-guided tweaks.
- Automatically runs `generate_cutout_border` on every generated frame and can pack straight into a spritesheet (`--pack <sheet.svg>`) and render its diagnostic preview.

### 3.5 `svg_workbook.py` & `svg_compile_sheet.py` (`npm run svg:workbook`, `npm run svg:compile-sheet`)
- **For polished main-character walk cycles (6-frame default: Contact → Passing → Up-Reach ×2, or 4-frame via `--frames 4`):**
  - `npm run svg:workbook -- <rigged.svg> --out <assets-src/sprites/..._workbook.svg>` builds a single side-by-side Inkscape workbook (`600×100` for 6 frames or `400×100` for 4 frames) with editable frame layers (`frame_0`..`frame_N`), a locked auto-stripped `stapler_guides` layer (ground plane `y = 96`, proportion bands), stripped borders, kinematic 2-segment bent-knee walking legs + 3/4 rounded boots, shoulder-anchored arm swing, and subtle head bob + nod tilt (or `--blank-legs` for manual sculpting).
  - `npm run svg:compile-sheet -- <assets-src/sprites/<char>_sheet.json>` extracts the frames, strips `stapler_guides`, auto-generates snug `#f9f9f9` `cutout_border` paths (`--floor-clip 97.0`) per frame, packs `idle` + `walk_front` (`6×2`, `2046×682` @ `10 fps`) into `public/assets/sprites/`, prints the `manifest.ts` snippet, renders `svg:preview --sheet`, and exports a 3-up **animated `.gif` preview** (Right on snow | Mirrored Left on dark | `alphaTest=0.5` shadow).

### 3.6 `svg_npc.py` & `templates/base_npc.svg` (`npm run svg:npc -- <out.svg>`)
- `tools/svg/templates/base_npc.svg` is a clean, pre-rigged `100×100` lineless geometric mannequin aligned to the `Chloe.svg` / `unua.svg` baseline (`y = 96` boots, `head`, `face`, `torso`, `arm_back`, `arm_front`, `leg_left`, `leg_right`, `hair_back`, `hair_front`, `props`).
- `svg_npc.py` initializes a new NPC SVG from `base_npc.svg` with optional palette overrides (`--skin`, `--hair`, `--coat`, `--bottoms`, `--boots`) ready for light geometric decoration (hair, hat, scarf, winter coat silhouette).

### 3.7 `svg_preview.py` & `svg_pack.py`
- `svg_preview.py` renders the 4-panel diagnostic sheet (`Grid & Guides`, `Scale & Style vs Anchor`, `alphaTest=0.5 Shadow Silhouette`, and `Snow / Light-Surface Contrast Check` tuned for *Paper expressions*'s pale snowy surfaces) plus engine-contract lint checks. Default style anchor prioritizes `chloe.svg` / `Chloe.svg` (falling back to `unua.svg`, or selectable via `--ref`).
- `svg_pack.py` packs individual `100×100` frames into a scoped multi-frame SVG spritesheet and outputs the `SpriteAnimationSpec` snippet for `manifest.ts`.

---

## 4. Concise Skill Design (`.agents/skills/stapler-svg/SKILL.md`)

To maximize LLM reliability, `SKILL.md` is kept intentionally short (< 60 lines) and focused on **operational workflow rather than coordinate memorization**:
1. **Hard Scope Boundary:** Never draw main characters from scratch; use `svg:npc` (`base_npc.svg`) for generic NPCs.
2. **Tool-First Editing:** Always `svg:inspect` before touching Inkscape XML, `svg:rig` to group parts, and `svg:pose` to animate via group pivots.
3. **Human Checkpoints:** Stop and show the preview PNG to the developer after base setup/polish and after animation generation.
