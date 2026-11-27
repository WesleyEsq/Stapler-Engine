# 03 - Simulation Loop, Controls, Narrative, Audio, and Saves

This file explains how a frame runs during gameplay today and how the planned
subsystems (navigation, dialogue, audio, and saves) connect around it.


## 1. Frame Lifecycle and Clamped Delta Time

In games/paper-expressions/src/main.ts, the browser drives frames through
requestAnimationFrame(tick):

  1. Compute raw delta time: rawDt = (now - lastTime) / 1000.
  2. Clamp simulation step: dt = Math.min(rawDt, 0.05).
     Why clamp at 0.05s? If the user switches browser tabs for 10 seconds and
     comes back, rawDt would be 10.0 seconds. Without clamping, the character
     would teleport across the room and skip collision checks.
  3. Update movement controller (mover.update(dt)).
  4. Update character animations (unua.update(dt)).
  5. Update camera tracking (fixedCamera.update(dt, ...)).
  6. Render frame (viewport.renderer.render(scene, fixedCamera.camera)).


## 2. Movement and Controls (BasicMover.ts -> MovementController)

Implemented now (BasicMover.ts):
- Dual input: supports both keyboard (WASD / Arrow keys) and point-and-click.
- Pressing any movement key immediately cancels any active click-to-move target
  and hides the orange floor click marker ring.
- Clicking the floor shoots a Three.js Raycaster through the camera against
  room.floorMesh ("stapler_floor"). If it hits, BasicMover stores targetPos,
  places and pulses the ring marker, and walks straight toward it at moveSpeed
  (4.4 tiles/sec in main.ts).
- Moving left/right calls sprite.setFacingRight(dx > 0), triggering the 140 ms
  paper-flip rotation.
- Position is clamped inside room bounds so the sprite cannot walk out of the
  room.

Planned upgrade in Milestone 2 (NavGrid + Pathfinder + MovementController + NpcController):
- NavGrid & Hybrid Colliders: A compact Uint8Array(width * height) storing
  WALKABLE / BLOCKED bits (populated from Tiled's collision layer plus empty
  void floor tiles), paired with lightweight 2D AABB boxes for thin interior
  walls/props and small circular blockers (~0.3 tiles) for NPCs.
- Point-and-click: 8-way A* pathfinding around blocked tiles (no diagonal
  corner-cutting), followed by radius-aware line-of-sight string-pulling so
  characters walk smoothly without zig-zagging or scraping corners.
- Keyboard collision: Circle/AABB player collider (radius 0.28 tiles) resolved
  separately on X and Z axes against NavGrid, AABB obstacles, and NPCs so
  pressing against walls or desks slides smoothly instead of getting stuck.
- Triggers & Interactions:
  * Walk-over zone triggers (triggerMode: "enter") fire when the player enters
    a marked Tiled rectangle (e.g. street exits or staircases).
  * Interactable triggers/objects/NPCs (triggerMode: "interact") activate via
    click-to-walk or Spacebar within interactionRadius (default 1.25 tiles),
    with hover cursor feedback and an in-range proximity prompt.
- NPC Movement (NpcController): Supports both animated idle NPCs and designated
  Tiled waypoint patrol paths (loop / pingpong / once with configurable speed
  and waypoint pauses). Patrolling NPCs pause and face the player during
  interaction/dialogue and yield briefly if the player stands in their path.


## 3. Engine Mode State Machine (EngineApp & ModeFsm)

EngineApp manages five modes so gameplay inputs never leak into menus or loading screens:

  BOOT      Initial startup: load persistent assets and initial scene.
  LOADING   Scene transition: show LoadingView, dispose old scene, load new one
            (transitions into EXPLORE for 3D rooms, or directly into DIALOGUE
            for VN-only scenes / room entry cutscenes).
  EXPLORE   Normal walking: click-to-move, WASD, Spacebar interact, Esc pauses.
  DIALOGUE  Visual novel overlay active: movement locked, click/Space advances,
            H or right-click hides/restores UI to view CGs, Esc pauses.
  PAUSED    Pause menu open: world & dialogue timers paused; Resume returns to
            whichever mode (EXPLORE or DIALOGUE) opened the menu.


## 4. Dialogue, CGs, VN-Only Scenes, and Localization

Dialogue is rendered in an HTML/CSS overlay on top of the WebGL canvas rather
than inside 3D textures. This keeps text and detailed SVG portraits razor-sharp
at any resolution and makes responsive layouts easy.

Key features:
1. .dlg script files hold only stage directions (`@cg <id> [fade|cut]`,
   `@cg clear`, `@portrait <left|center|right> <char> <pose> [left|right]`,
   `@bgm <trackId|stop>`, `@box <style>`, `@sfx`, `@voice`, `@if/@else/@set`,
   `@wait`, and `@transition <envId> [spawnId] [facing]`) plus string keys.
   Nameless narration uses `say _ <lineKey>` or `say none <lineKey>`.
2. Full-screen PNG CGs/backdrops render behind the SVG portrait stage in a
   crossfading layer (`GameManifest.cgs`), supporting both pure CG moments and
   illustrated VN backdrops paired with detailed SVG character portraits.
3. Environments with `kind: 'vn'` skip loading a 3D `.tmj` map, unload prior
   scene VRAM, preload referenced CGs and portraits, and boot directly into
   `DIALOGUE`, allowing games to interleave playable 2.5D rooms and VN chapters.
4. Actual text lives in separate JSON files per language (locales/en.json,
   locales/es.json); switching language in the Pause Menu updates UI and the
   active dialogue line immediately without duplicating scripts.


## 5. Audio Architecture Design (Planned in Milestone 3)

AudioManager will wrap the Web Audio API with three gain channels feeding a
master gain node:
  - BGM channel: Seamless background music loops with crossfades between rooms.
  - SFX channel: Triggered sound effects with a configurable maxConcurrentSfx
    limit (default 8) so rapid triggers never clip audio output.
  - Voice channel: Single-slot channel for future dialogue voice lines (stopping
    the previous clip automatically when advancing lines).

Autoplay unlock: Browsers block audio until the user clicks or presses a key.
AudioManager will attach a one-shot listener to call audioCtx.resume() on the
first interaction and start any queued initial music.


## 6. Persistence and Save Slots Design (Planned in Milestone 3)

Save data is stored in IndexedDB ("stapler_db_<gameId>"), NOT browser HTTP
cache (which browsers can delete whenever disk space runs low).

Two stores are planned:
  - saves: Configurable number of manual slots (default 10 via maxSaveSlots in
    GameManifest) plus an optional autosave slot. Each slot stores SaveSlotData
    (schemaVersion, timestamp, environmentId, player x/z/facing, story flags,
    and playtimeSeconds) defined in contracts.ts.
  - settings: Stores active language plus separate volume/mute controls for BGM,
    SFX, and voice.
