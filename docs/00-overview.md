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

  Unit Testing (Vitest in Node - npm test):
    - Reuses Vite's TypeScript resolver with zero extra build step.
    - Runs co-located *.test.ts files purely in Node (no DOM/WebGL browser
      flakiness) to verify critical engine logic and game asset integrity.


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

Implemented right now (Milestones 1, 2 & 3 - Complete Engine Core):
- Strict TypeScript monorepo with Vite dev/build pipeline and Vitest Node-only
  unit test suite.
- Core runtime & transitions: EngineApp, ModeFsm, EventBus, GameState,
  SceneManager (deterministic scene unload + VRAM disposal), AssetManager.
- Rendering: ViewportManager (--ui-scale), SvgTextureLoader, PaperSprite
  (alphaTest silhouette shadows, flip tween, multi-frame UV animations),
  LightingRig (2-shadow cap + flat mode), FixedCamera, TileMapBuilder (.tmj
  void floors + border & interior_walls), PropLoader (.glb), DebugOverlay.
- Navigation & NPCs: NavGrid + 2D AABB/NPC circle colliders, 8-way A* Pathfinder
  with radius-aware string-pulling, hybrid WASD/click MovementController,
  walk-over & interactable triggers (InteractionSystem), idle/patrol NpcController.
- Narrative, Audio, Persistence & UI: ScriptParser (.dlg with @if/@else, @set,
  @transition, @wait), DialogueRunner, I18nStore (live en/es switching),
  AudioManager (.opus/.mp3 + SfxConcurrencyLimiter), SaveManager (IndexedDB 10
  slots + autosave + settings), and responsive HTML/CSS UIOverlay (DialogueView,
  PauseMenuView, LoadingView).

Planned next (Milestone 4, documented in 2-Architecture.md):
- Milestone 4: All 6 environments, character SVGs, .glb props, .dlg scripts,
  locale JSONs, and audio tracks for Paper expressions.


## 5. Reading Order for the Rest of docs/

  01-rendering-and-world.md    How rooms, SVGs, lights, shadows, and camera work.
  02-assets-and-memory.md      How VRAM disposal and asset pipelines work.
  03-gameplay-loop-and-controls.md  How frames, movement, dialogue, audio, and saves fit.
  04-extending-and-next-steps.md    Day-to-day workflow and how to add content.
