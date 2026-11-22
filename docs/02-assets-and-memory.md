# 02 - Assets, Pipelines, and GPU Memory Management

Web games have two constraints desktop engines rarely worry about: download size
and manual WebGL memory cleanup. This document explains how Stapler handles both
and lists the authoring conventions for game assets.


## 1. Why AssetManager Exists (AssetManager.ts)

In JavaScript, regular objects are freed automatically by the garbage collector
when nothing references them. Three.js WebGL resources are NOT: geometries,
materials, and textures allocate buffers inside the GPU driver (VRAM), and they
stay allocated until you explicitly call .dispose() on them.

If a player walks through 6 environments without disposal, old room textures and
meshes pile up in VRAM until the browser tab lags or crashes.

How AssetManager solves this using two scopes:

  "persistent" scope:
    Assets that stay loaded across rooms, such as the protagonist sprite texture.
    Only freed when the game shuts down (disposeAll()).

  "scene" scope:
    Assets that belong only to the current environment: floor/wall meshes, room
    props, click markers, and scene-only NPCs.
    Freed automatically when leaving the room via disposeScope("scene").

Key AssetManager methods:
  register(resource, scope)         Tracks any object with a .dispose() method.
  registerObject3D(root, scope)     Recursively walks a Three.js Group/Mesh and
                                    registers every geometry, material, texture
                                    map, and customDepthMaterial.
  cacheTexture(key, texture, scope) Stores a named texture so duplicate requests
                                    reuse the same GPU texture instead of
                                    rasterizing the same SVG twice.
  disposeScope(scope)               Calls .dispose() on all resources in that
                                    scope and clears matching cache keys.

Important rule when loading scenes:
Always call assets.registerObject3D(group, "scene") right after building a room
or loading props so nothing leaks when the player changes rooms.


## 2. Character & 2D Art Authoring Rules (SVG)

Production characters use the lineless, flat-shaded geometric paper-cutout style
anchored by Unua.svg in the repository root.

Recommended Inkscape / SVG guidelines so sprites drop straight into the engine:
1. Keep a consistent viewBox (for example 100 x 100) across characters.
2. Anchor the bottom of the character's shoes near the bottom baseline (around
   y = 95 in a 0..100 viewBox). SvgTextureLoader bottom-aligns the rasterized
   image, and PaperSprite uses groundOffset (0.06 in main.ts) so feet sit flush
   on the y = 0 floor.
3. Keep the white die-cut paper border snug and uniform around the character's
   silhouette so alphaTest shadows look like the character, not a wide blob.
4. Separate body parts into named SVG groups (face, torso, arm_left, leg_left,
   cutout_border) so building emotion variants and walk frames is fast.
5. For light clothing like white lab coats, tint the coat slightly cool/gray
   or keep the paper border distinct so the coat edges stay readable.

Note on spritesheets (planned extension):
contracts.ts already includes optional "columns" and "rows" fields on
SpriteAnimationSpec so PaperSprite can later step through multi-frame UV grids.


## 3. Supported Runtime Asset Formats

To keep web loading fast and browser-compatible, Stapler standardizes on one
primary format per asset type:

  2D Sprites & Cutouts:
    Format: .svg (rasterized at load/build time to CanvasTexture).

  3D Environment Props (Milestone 2):
    Format: .glb (binary glTF). Avoid .obj in production because .obj requires
    separate .mtl files, lacks compression, and has inconsistent exporter scales.

  Audio (Milestone 3):
    Formats: .opus (primary) with .mp3 fallback for Safari compatibility.
    Do not ship .wav or .flac in runtime builds (a single music loop in .wav can
    easily exceed 20 MB vs. ~1.5 MB in .opus).

  Environments / Levels (Milestone 2):
    Format: .tmj (Tiled Map Editor JSON export).

  Dialogue & Translations (Milestone 3):
    Dialogue flow & stage directions: .dlg script files.
    Translated text strings: locales/<lang>.json (e.g. en.json, es.json).


## 4. Tiled Map Authoring Contract (Milestone 2 Design)

When TileMapBuilder is implemented, each environment .tmj file will follow four
standardized layers:

  1. floor (Tile Layer)
     Paints floor tile GIDs mapped to a tileset texture atlas. Empty tiles
     (GID = 0) emit no floor quad and are automatically marked BLOCKED in
     NavGrid so non-rectangular rooms (L-shapes, alcoves) work cleanly.

  2. collision (Tile Layer)
     Any non-zero tile marks that cell BLOCKED in NavGrid.

  3. walls (Map Custom Properties + Optional interior_walls Object Layer)
     Custom map properties: wallNorth, wallSouth, wallEast, wallWest (height in
     tiles >= 0; 0 = omitted/transparent) and wallTextureId.
     Optional "interior_walls" object layer containing rectangle or polyline
     segments (properties: height, textureId, doubleSided, castShadow) merged
     into the wall mesh and automatically registered as solid 2D AABB colliders.
     Keep south-facing interior partitions low or omitted so the fixed camera
     does not lose sight of the player behind them.

  4. objects (Object Layer)
     Markers and shapes with type set to one of:
       spawn, npc, prop_glb, sprite_2d, trigger, light, patrol
     Common custom properties:
       - trigger: triggerMode ("enter" walk-over zone | "interact" click/Space),
                  targetEnv, targetSpawnId, facing, scriptId, oneShot,
                  interactionRadius.
       - npc:     spriteId, scriptId, interactionRadius, patrolPath (name of a
                  "patrol" polyline/polygon object), patrolMode ("loop" |
                  "pingpong" | "once"), moveSpeed, waitAtWaypointSec.
       - prop_glb: modelUrl, collider ("auto" | "none" | custom AABB),
                   castShadow, receiveShadow.
