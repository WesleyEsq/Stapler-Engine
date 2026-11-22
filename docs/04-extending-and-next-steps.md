# 04 - Running, Extending, and Next Steps

This file is a practical quick-reference for working in the repository day to
day and building out the rest of the engine.


## 1. Setup and Daily Commands

First-time setup (checks Node 18+, installs npm workspaces, typechecks, builds):
  ./setup.sh

Start the Milestone 1 dev server (opens on localhost:5173):
  npm run dev

Run strict TypeScript checks across both packages:
  npm run typecheck

Run fast Node-only unit tests (Vitest):
  npm test
  npm run test:watch

Run a full production build check:
  npm run build


## 2. How to Tweak the Milestone 1 Test Room

Everything in the current playable spike lives in:
  games/paper-expressions/src/main.ts

Quick things you can experiment with right now:
- Swap or add an SVG sprite:
  Drop an SVG into games/paper-expressions/public/assets/sprites/ and load it
  with svgLoader.load("/assets/sprites/your_file.svg", { ... }).
- Change room size or wall heights:
  Edit SimpleRoomBuilder.build({ width, height, walls: { ... } }) in main.ts.
  Remember: setting walls.south to 0 keeps the front open for the camera.
- Test lighting moods:
  Modify the lights array passed to lighting.configure([...]) in main.ts.
  Up to 8 lights total (default) and up to 2 lights with castShadow: true.
- Test camera feel:
  Adjust FixedCamera({ fov, offset, lookAtOffset, followPlayer, bounds }).
- Test the runtime HUD buttons:
  "Lighting: Dynamic/Flat", "Camera: Follow/Fixed", and "Cam Light: On/Off".


## 3. Rules to Keep the Codebase Clean as It Grows

1. Keep game logic out of packages/stapler-engine/.
   If a file mentions "chloe", "unua", "campus", or a specific story flag, it
   belongs in games/paper-expressions/, never in packages/stapler-engine/.
2. Export public engine types and classes from packages/stapler-engine/src/index.ts
   so the game always imports from "@stapler/engine" rather than deep file paths.
3. Keep contracts in packages/stapler-engine/src/types/contracts.ts as the
   single source of truth shared between engine subsystems and game manifests.
4. Register every scene-created Three.js mesh/group with assets.registerObject3D
   under the right scope ("scene" vs. "persistent").
5. Keep parsing, math, collision, pathfinding, and state-machine logic decoupled
   from WebGL/DOM/AudioContext and driven by explicit dt arguments, with
   co-located critical-path *.test.ts files running purely in Node via Vitest
   (no browser/DOM mocks or wall-clock timers).


## 4. Roadmap from Milestone 1 to Paper expressions

Milestone 1 (Completed) - Rendering Spike & Unit Test Harness:
  - Vitest (environment: "node") configured in vitest.config.ts, package.json,
    and setup.sh, with foundation unit tests for AssetManager, LightingRig,
    FixedCamera, and PaperSprite.

Milestone 2 (Completed) - Worlds, Props, Animation, and Real Navigation:
  - TileMapBuilder.ts (.tmj loader with void non-rectangular floors and
    interior_walls), PaperSprite.ts multi-frame UV animations, PropLoader.ts
    (.glb), NavGrid.ts + 2D AABB/NPC colliders, Pathfinder.ts (8-way A* +
    radius-aware string-pulling), MovementController.ts, InteractionSystem.ts,
    NpcController.ts, DebugOverlay.ts, Milestone 2 demo map, and unit tests.

Milestone 3 (Completed) - Dialogue, Audio, Saves, and Scene Transitions:
  - EngineApp.ts, ModeFsm.ts, EventBus.ts, SceneManager.ts, GameState.ts.
  - ScriptParser.ts (.dlg including @transition, @if/@else, @set, @wait),
    DialogueRunner.ts, and I18nStore.ts (live en/es switching).
  - AudioManager.ts (.opus/.mp3 + SfxConcurrencyLimiter) and SaveManager.ts
    (IndexedDB configurable save slots, default 10 + autosave, plus settings).
  - UIOverlay DOM views (DialogueView, PauseMenuView, LoadingView) + unit tests.

Milestone 4 - Paper expressions Content:
  - Author all 6 environments (apt_interior, apt_hallway_high, apt_hallway_low,
    front_road, campus, classroom) in Tiled.
  - Author Inkscape SVGs for Chloe, Ada, Turrialba, and Unua variants.
  - Write .dlg scripts, English/other locale JSON files, add audio tracks, and
    add a content-integrity test verifying dialogue keys, transitions, and
    patrol paths across real game assets.
