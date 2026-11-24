# Stapler Engine

Date: 2026-11-19

## Purpose:

Stapler is a web-game engine for a point-and-click 2.5D game. This is an experimental test project for learning about game engines.

## Main objective:

Develop a game and a decoupled framework with **TypeScript** and **Three.js** for similar 2.5D narrative games. Strict TypeScript interfaces enforce the boundary between the reusable engine core and game-specific content.

## Secondary Objectives, game framework

**1. Sound and effects:** Create a Web Audio API player with dedicated tracks for looping background music, sound effects (with a queue and configurable concurrency limit), and a future voice channel.
    * **Supported runtime formats:** `.opus` (primary, compact web format) with `.mp3` fallback for broad browser compatibility. Lossless formats like `.wav` and `.flac` are excluded from runtime builds to keep web loading times fast.
    * Supports seamless background music loops.
    * Triggers sound effects on demand with concurrency throttling.
    * Includes an audio-unlock lifecycle tied to the first user interaction to satisfy browser autoplay policies.
    * Supports a theoretical voice channel for dialog boxes (unused in the initial release, but supported by the audio architecture).

**2. Resolution responsiveness:** Support multiple screen proportions and aspect ratios for the viewport panel that displays the game, with responsive scaling for both the WebGL canvas and the HTML/CSS UI overlay.

**3. 2D SVG characters and assets with animations:** Allows for 2D paper-cutout sprites standing on the 3D plane, supporting dynamic lighting, surface sheen, and crisp silhouette shadows.
    * **Asset pipeline:** Sprites are authored in SVG and rasterized to high-DPI GPU textures (`THREE.CanvasTexture` / texture atlases) at build or load time rather than rendered as live DOM SVGs or triangulated meshes.
    * **Rendering & shadows:** Sprites use `PlaneGeometry` with `MeshStandardMaterial` and alpha-cutout transparency (`alphaTest`, `transparent: false`) plus a matching `customDepthMaterial` for animated sprite sheets. This ensures proper 2.5D depth sorting without Z-fighting, lets sprites receive scene lighting and subtle paper surface sheen/roughness, and casts crisp character-silhouette shadows instead of solid rectangles.
    * Supports frame-based animations (front/back walk cycles, idle, emotions) and optional quick horizontal "paper flip" transitions when changing direction.

**4. Light sources:** Supports multiple configurable light sources per environment (soft default cap of 8, configurable via engine settings), each with color and intensity.
    * **Shadow budget (real performance guardrail):** Maximum of 1–2 shadow-casting lights per environment (e.g., primary directional/key light) to maintain smooth web performance; remaining lights act as non-shadow fill/accent lights.
    * Dynamic lighting can be toggled off per environment, falling back to uniform flat/ambient lighting across the scene.

**5. Multiple 3D environments:** Separates locations into self-contained 3D "environments" built on a flat tile grid with textured geometry.
    * **Grid size & non-rectangular shapes:** Supports arbitrary rectangular maps within a configurable tile budget (default: up to **4,096 total tiles** / max dimension **64**, so both compact rooms like `12×12` and long corridors/streets like `48×10` work freely). Empty (`GID = 0`) floor tiles are omitted from geometry and treated as impassable void, enabling L-shaped rooms, alcoves, and non-rectangular layouts cheaply.
    * **Units:** 1 tile = 1 world unit of distance. Entity positions are handled with floats.
    * **Geometry & performance:** Static floor and wall tiles are built as merged/chunked geometry (or instanced meshes) sharing texture atlases to keep draw calls low.
    * **Exterior & interior walls:** Supports flat textured border walls of any configurable height (`>= 0`, where `0` = transparent/omitted, e.g., on the camera-facing side to prevent view occlusion), plus an `interior_walls` object layer in Tiled (rectangle/polyline wall segments with configurable height, texture, and automatic collision) so environments can include interior partitions or framed rooms whose doors transition to separate smaller environments.
    * **Level authoring:** Environments are authored visually in **Tiled** (exported as `.tmj` JSON for tile layouts, walkability, exterior/interior walls, spawns, lights, patrol paths, and interaction/transition triggers) and imported by the engine.

**6. 3D assets:** Environments can place 3D props on top of the plane using **`.glb` (binary glTF)** as the primary supported format (self-contained PBR materials, compression support, and native Three.js `GLTFLoader` compatibility).

**7. Textbox handler & UI overlay:** Supports visual novel dialog boxes and menus rendered as a responsive HTML/CSS overlay on top of the WebGL canvas.
    * Conversations are defined in lightweight structured script files with a small parser supporting speaker tags, portrait positioning (`left`, `right`, `center`), expression/pose swaps, sound effects on open/line, story state flags, and scene transitions (`@transition`).
    * **Localization separation:** Script logic references string keys rather than hardcoded text, resolving localized strings from separate per-language JSON files.

**8. Memory management, persistence, and loading times:**
    * **Loading transitions:** Displays a loading screen animation while fetching and preparing environment assets.
    * **GPU/RAM lifecycle:** Uses a centralized `AssetManager` that explicitly calls `.dispose()` on Three.js geometries, materials, and textures when leaving an environment to prevent WebGL VRAM leaks, while retaining shared persistent assets (e.g., protagonist sprites) in memory.
    * **Persistent save slots:** Game state (current environment, position, and story flags/values) is stored in **`IndexedDB`** (with versioned JSON schemas — not browser HTTP cache, which can be evicted).
    * Configurable number of save file slots via the game manifest (default: **10 slots** + optional autosave) with the following options:
        * Save
        * Load
        * Erase

**9. NPC behaviors, interactions, and scene triggers:**
    * **Interactions & visual cues:** The character can interact with objects and NPCs via click-to-interact or `Spacebar` proximity, triggering messages, visual novel dialogs, scene transitions, or state changes, accompanied by pointer hover feedback and an in-range interaction prompt.
    * **Scene transitions:** Environments can be exited via **walk-over zone triggers** (entering a marked area such as a road edge or staircase), **interactable triggers** (clicking/pressing `Spacebar` on a door or object), or **dialogue script commands** (`@transition`), each specifying a target environment and spawn marker.
    * **NPC movement & idle states:** NPCs support animated idle states as well as optional designated waypoint patrol paths authored in Tiled (`loop`, `pingpong`, or `once`, with configurable speed and waypoint pauses). Patrolling NPCs automatically pause and face the player when spoken to, pause during non-explore modes, and yield if blocked by the player.

**10. Fixed camera options:** The camera uses a fixed angle per environment, with optional smooth character-follow tracking and an optional camera-mounted light shining into the view.

**11. Character movement & collisions:** Supports point-and-click, WASD, and arrow keys on the walkable plane.
    * Captures mouse/pointer and keyboard inputs.
    * **Collisions:** Combines the tile-level walkability grid (`NavGrid`, including void floor tiles) with lightweight 2D AABB obstacle colliders (generated from interior walls and prop footprints) and circular NPC blockers so the player cannot clip through walls, furniture, or characters.
    * **Point-and-click:** Uses 8-way grid A* pathfinding with radius-aware line-of-sight string-pulling so float movement looks natural without stair-stepping or corner snagging; clicking an object or NPC walks to it and triggers interaction.
    * **Keyboard movement:** Uses smooth float movement with separate X/Z axis collision sliding; pressing `Spacebar` interacts with the nearest interactable target within its interaction radius (default `1.25` tiles, configurable per object/NPC).

The engine specializes in a very specific type of game: a hybrid between a visual novel and a 2.5D point-and-click storytelling game.

**12. User configuration options:** Offers a simple pause menu with a resume button and settings (persisted locally):
    * **Language:** Switches active locale across dialogs and UI.
    * **Audio:** Separate volume sliders and mute toggles for background music and sound effects (plus future voice volume).

**13. Automated unit testing (critical-path, flakeless):** Maintains a lightweight, deterministic **Vitest** unit test suite running purely in Node (`environment: 'node'`, no headless browser or WebGL context required) focused on high-risk engine logic rather than chasing an arbitrary coverage percentage:
    * Covers GPU resource disposal (`AssetManager`), lighting/shadow caps (`LightingRig`), camera clamping (`FixedCamera`), sprite animation/flip state (`PaperSprite`), `NavGrid`/AABB/NPC collisions, A* pathfinding and string-pulling, `.tmj` parsing, trigger/patrol logic, `.dlg` script parsing, localization fallback, mode FSM transitions, save-slot serialization, and a final game-content integrity test (verifying dialogue keys, scene transitions, and patrol references across assets).
    * Deliberately skips brittle DOM/CSS layout, `WebGLRenderer`, `<canvas>` pixel output, and Web Audio hardware playback in unit tests to guarantee sub-second, zero-flake execution.

---

## The test game

Paper expressions: Set in an equatorial country after global cooling brought cold weather and light snow to the tropics—and caused a severe decline in the human population. The story follows a day in the life of Chloe Relay, a sleepy android going from her apartment to her computer science university class, who falls downstairs and reveals to the player that she is a robot. She then goes about her chilly day trying to blend in without getting caught, attending class, and returning home, where she is greeted by the professor who invented her.

### Mechanics:

1. For game progression, the character moves scene to scene; this game tells a focused 15-minute story.
2. The environments (framed around a chilly, lightly snowy equatorial city and campus) are:
    + High-floor tower apartment hallway
    + Lower-floor tower apartment hallway (similar layout, different doors)
    + Front road (cold exterior street with light snow patches)
    + Campus (chilly outdoor university grounds with light snow)
    + Classroom
    + Apartment interior
3. Goal:
    + Go through every environment
    + Show NPC dialogs
    + Showcase a day cycle for a character
    + Full-fledged environments to battle-test the framework

There isn't a sprawling plot for this — it's a focused character introduction, a sort of prologue. Chloe is an android built to infiltrate everyday society as part of a state-backed scheme to repopulate the cold, underpopulated country with robots.

### Visual Art Direction & Asset Workflow (Production Style):

* **Style Anchor:** Lineless, flat-shaded geometric vector shapes inside a crisp `#f9f9f9` paper-cutout border (anchored by [Chloe.svg](../../Chloe.svg) and [Unua.svg](../../Unua.svg)), authored natively in Inkscape SVGs (`viewBox="0 0 100 100"`, boots/shoes anchored cleanly near `y = 96` for consistent 3D grounding) and contrasted against cool, lightly snowy exterior environments and warm interior lighting.
* **Authoring Split (Human-First + AI-Assisted):**
    + **Main Characters:** Designed by hand in Inkscape by the developer, then rigged into semantic groups, lightly polished, bordered, and given simple puppet walk/idle animations and facial expressions through the `tools/svg/` CLI pipeline with developer feedback checkpoints.
    + **Background NPCs:** Built by decorating a shared pre-rigged base mannequin (`tools/svg/templates/base_npc.svg`) with winter clothing, hair, and palettes rather than drawing figures from scratch.
* **Character Variety:** Characters share the same clean geometric paper-cutout language and flat shading, while remaining visually distinct through varied heights, winter silhouettes (coats, scarves, skirts, lab coats), hairstyles, signature eye/brow geometry, and distinct color palettes that stay legible against pale snow.

### Main character:

**Name:** Chloe Relay

**Main point:** A warm-toned android, extremely humanlike with subtle mechanical tells uncovered after her fall.

**Personality:** Sleepy, quiet, slightly distant personality, trying (and awkwardly struggling) to fit into cold everyday student life without standing out. Soft expression and barely smiling.

**Visual design & color scheme:** Warm copper-orange bob hair (`#c87137`) with a small dark-red rose hairclip on the left side; cozy crimson/burgundy winter coat (`#880000`–`#a40000`) with dark brown-black collar and cuffs (`#280b0b`); dark olive-brown winter skirt (`#483e37`), warm brown tights/leggings (`#6c5d53`), and dark rounded boots (`#333333`). Reference SVG: [Chloe.svg](../../Chloe.svg).

**Favorite food:** Cannot eat or drink (including hot drinks in the cold weather), which creates awkward problems for maintaining normalcy.

### Other characters

* **Professor Unua:** Named after *"first"* in Esperanto — an earlier-generation robot herself, appearing the same age as Chloe. Features red bob hair, visible robotic hardware (antenna/hair-piece), a white lab coat/scrub over a dark rock t-shirt and dark skirt, and a grumpy/focused mad-scientist vibe (state funded). Reference SVG: [Unua.svg](../Unua.svg).
* **Ada Nudos:** A friendly classmate who invites Chloe to lunch and has to do a group project with her. Wears a green beret, oversized round glasses, messy orange hair with a pencil tucked behind her ear, a mint-green collared shirt, dark flat skirt, white socks, brown shoes, and a tan crossbody satchel.
* **Turrialba:** The professor from the compilers class, an older guy with a beard who assigns tons of work.
