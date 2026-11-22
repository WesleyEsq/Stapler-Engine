# 00 - Stapler Engine Overview

Last updated: 2026-11-22

Stapler Engine is a 2.5D point-and-click and visual-novel web game engine built
with TypeScript and Three.js. It renders flat 2D SVG characters as lit paper
cutouts standing inside compact 3D tile environments.

This document explains how all the pieces fit together in plain language, and
clearly separates what is already implemented in code (Milestone 1) from what
is designed and scheduled next (Milestones 2 through 4).


## 1. The Big Idea: Engine vs. Game Split

The repository is an npm workspaces monorepo with two separate packages:

  packages/stapler-engine/      Reusable engine (@stapler/engine)
  games/paper-expressions/      Your test game (@stapler/paper-expressions)

Why split them?
- The engine package must never know anything about Chloe, Unua, Ada, or campus
  maps. That forces clean boundaries so you can build another 2.5D game later
  by swapping the game folder.
- The game package imports what it needs from "@stapler/engine", provides its
  own assets (SVGs, maps, dialogue, audio), and wires up the scene.


## 2. How Vite and TypeScript Fit In

Browsers cannot execute TypeScript (.ts) files directly or resolve bare imports
like "three" or "@stapler/engine". Vite handles this in two modes:

  Development (npm run dev):
    - Compiles TypeScript on the fly as you edit files.
    - Serves static files from games/paper-expressions/public/ at "/".
    - Reloads the page when you save changes.

  Production (npm run build):
    - Runs "tsc --noEmit" to catch type errors across both packages.
    - Bundles everything into static HTML, JS, and CSS files in dist/ that can
      be hosted on any static web host with no backend server.


## 3. Workspace Map

Root files:
  package.json        Defines the npm workspaces and top-level scripts.
  tsconfig.base.json  Shared strict TypeScript compiler settings.
  setup.sh            Checks Node 18+, installs packages, typechecks, builds.
  Unua.svg            Master art-style anchor for characters.

Engine source (packages/stapler-engine/src/):
  index.ts                      Public exports for games to import.
  types/contracts.ts            Shared TypeScript interfaces and defaults.
  core/AssetManager.ts          Tracks GPU resources for cleanup (.dispose).
  render/ViewportManager.ts     WebGLRenderer, resize observer, CSS --ui-scale.
  render/SvgTextureLoader.ts    Fetches SVGs and rasterizes them to textures.
  render/PaperSprite.ts         2D cutout plane, alphaTest shadows, flip, bob.
  render/LightingRig.ts         Environment lights + flat/dynamic mode toggle.
  render/FixedCamera.ts         Fixed-angle camera, follow smoothing, cam light.
  render/SimpleRoomBuilder.ts   Single-draw-call floor + border wall builder.
  navigation/BasicMover.ts      WASD/Arrows + floor click-to-move controller.

Game source (games/paper-expressions/):
  index.html                    Root HTML page and HUD test buttons.
  src/style.css                 Layout and translucent HUD styling.
  src/main.ts                   Milestone 1 spike: greybox room + Unua sprite.
  public/assets/sprites/        Static SVG assets served to the browser.

Specifications and planning:
  software_specifications/1-Stapler_Engine.md   Requirements and game design.
  software_specifications/2-Architecture.md     Full target system design.


## 4. Current Status: Implemented vs. Planned

Implemented right now (Milestone 1 - Rendering & Movement Spike):
- Strict TypeScript monorepo with Vite dev/build pipeline.
- Scoped GPU resource tracking (AssetManager).
- Responsive WebGL canvas + CSS --ui-scale calculation (ViewportManager).
- SVG rasterization to high-DPI CanvasTexture (SvgTextureLoader).
- 2D lit cutout sprites with silhouette shadows and flip tween (PaperSprite).
- Configurable lighting rig with 2-shadow-caster limit and flat mode.
- Fixed-angle camera with bounds, damped follow, and optional camera light.
- Procedural greybox room builder (SimpleRoomBuilder) and basic WASD/click
  movement (BasicMover).

Planned next (Milestones 2 through 4, documented in 2-Architecture.md):
- Milestone 2: Tiled (.tmj) map loader (including non-rectangular void floors
  and interior_walls), multi-frame UV sprite animations, .glb 3D prop loader,
  NavGrid + 2D AABB/NPC colliders with radius-aware A* pathfinding and collision
  sliding, walk-over/interactable triggers with hover/proximity cues, NPC idle
  and waypoint patrol paths, and a toggleable DebugOverlay.
- Milestone 3: EngineApp/SceneManager lifecycle, dialogue script parser (.dlg
  with @transition), localization JSON store, HTML visual novel overlay, Web
  Audio manager (.opus/.mp3), and IndexedDB configurable save slots (default 10
  + autosave).
- Milestone 4: All 6 environments, characters, scripts, and audio for
  Paper expressions.


## 5. Reading Order for the Rest of docs/

  01-rendering-and-world.md    How rooms, SVGs, lights, shadows, and camera work.
  02-assets-and-memory.md      How VRAM disposal and asset pipelines work.
  03-gameplay-loop-and-controls.md  How frames, movement, dialogue, audio, and saves fit.
  04-extending-and-next-steps.md    Day-to-day workflow and how to add content.
