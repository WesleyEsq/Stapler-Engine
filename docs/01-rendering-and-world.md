# 01 - Rendering, World Space, Lighting, and Camera

This file explains how the 3D scene is constructed and drawn each frame.


## 1. Coordinate System and Units

Stapler uses a consistent world scale so math stays simple:

  1.0 Three.js world unit = 1 tile

Axes:
  +X  Right across the room
  +Y  Straight up from the floor (y = 0 is ground level)
  +Z  Toward the viewer / camera

A room of width W and height H spans from (0, 0, 0) at the back-left corner to
(W, 0, H) at the front-right corner. In main.ts, the test room is 14 x 10 tiles,
so its center sits at (7, 0, 5).


## 2. Viewport and Responsive Scaling (ViewportManager.ts)

ViewportManager owns the Three.js WebGLRenderer and attaches a ResizeObserver to
the container element (#viewport).

Whenever the window or pane resizes:
1. It measures the container width and height.
2. It caps pixel ratio at maxDpr (default 2) so 4K/Retina screens stay fast.
3. It updates the camera aspect ratio and projection matrix.
4. It writes a CSS variable "--ui-scale" on the container:

     uiScale = min(width / 1280, height / 720)

This lets the HTML/CSS dialogue boxes and menus scale smoothly alongside the
3D canvas without rendering UI inside WebGL.

Renderer defaults set in ViewportManager:
- Output color space: SRGBColorSpace
- Tone mapping: ACESFilmicToneMapping (exposure 1.05)
- Shadow map type: PCFSoftShadowMap


## 3. Room Geometry (SimpleRoomBuilder.ts)

SimpleRoomBuilder creates a single-draw-call floor plus border walls:

- Tile budget guardrails (from DEFAULT_ENGINE_CONFIG in contracts.ts):
    maxTiles = 4096
    maxDimension = 64
  This rejects giant accidental maps while allowing both square rooms (12x12)
  and long corridors or streets (48x10).

- Floor:
  Built as one PlaneGeometry rotated flat on y = 0, textured with a repeating
  checker/paper-seam CanvasTexture. Its mesh name is "stapler_floor" so the
  pointer raycaster knows what to click.

- Border walls:
  Each side (north, south, east, west) accepts any height >= 0. Setting a side
  to 0 (default for south) omits that wall completely so it never blocks the
  camera's view into the room.

Planned in Milestone 2:
SimpleRoomBuilder will be joined (or replaced for real levels) by TileMapBuilder,
which reads Tiled (.tmj) JSON maps, skips empty floor tiles (GID = 0) to support
non-rectangular room shapes, builds merged BufferGeometry from tile atlas GIDs,
and extrudes optional interior_walls segments (rectangles/polylines) with
automatic collision. Keep south-facing interior partitions low or omitted so the
fixed camera never loses sight of the player behind them.


## 4. Paper-Cutout Sprites (SvgTextureLoader.ts and PaperSprite.ts)

Why not render raw SVGs in the browser DOM or turn SVG paths into 3D triangles?
- DOM SVGs cannot receive Three.js 3D lights or cast shadows onto the floor.
- Triangulated SVG meshes have high polygon counts and break easily when
  swapping animation frames.

Instead, Stapler uses a two-step pipeline:

Step A - Rasterize SVG to GPU Texture (SvgTextureLoader.ts):
  1. Fetch the .svg file (for example "/assets/sprites/unua.svg").
  2. Decode it into an Image and draw it onto an offscreen 2D canvas at high
     resolution (512x512 in main.ts), bottom-anchored so feet touch the bottom
     edge of the texture.
  3. Wrap that canvas in a THREE.CanvasTexture with SRGBColorSpace and mipmaps.

Step B - Stand It Up in 3D with Silhouette Shadows (PaperSprite.ts):
  PaperSprite creates a vertical PlaneGeometry with MeshStandardMaterial:
  - alphaTest = 0.5 and transparent = false.
    Why transparent = false? Alpha-blended planes cause Z-sorting bugs when two
    characters cross paths, and Three.js casts a solid rectangular shadow for a
    plain quad. With alphaTest cutout transparency, pixels below 0.5 alpha are
    discarded completely: depth sorting works cleanly and characters never glitch.
  - customDepthMaterial = THREE.MeshDepthMaterial with the same map and
    alphaTest. This makes Three.js cast a shadow matching Unua's exact silhouette
    rather than a rectangle.
  - roughness = 0.85, metalness = 0.0, side = THREE.DoubleSide so the cutout
    reads like matte paper and stays visible from both sides during flips.

Built-in sprite motion in PaperSprite.update(dt):
  - Paper flip: When facing flips (left <-> right), mesh.rotation.y eases from
    0 to PI over 0.14 seconds using smoothstep easing.
  - Walk bob & tilt: While moving, the sprite gently bobs upward and tilts
    slightly left/right using sine waves, then settles smoothly back to rest.

Planned in Milestone 2:
  - Multi-frame UV sprite-sheet playback (idle, front/back walk cycles, emotion
    swaps) keeping customDepthMaterial UV offsets in sync so animated cutout
    shadows match every frame.


## 5. Lighting Rig (LightingRig.ts)

LightingRig enforces real WebGL performance limits while keeping scenes flexible:

- Soft light budget: maxLights = 8 (configurable in EngineConfig).
- Hard shadow guardrail: maxShadowLights = 2. Shadow maps are expensive in
  WebGL, so LightingRig tracks how many lights have castShadow = true and forces
  any extra shadow-casting lights beyond the cap to castShadow = false with a
  console warning.

Supported light types:
  - hemisphere   Soft sky-to-ground ambient bounce (no shadows).
  - directional  Sun/key light; uses a 2048x2048 shadow map when castShadow=true.
  - spot         Focused cone light; uses a 1024x1024 shadow map if enabled.
  - point        Local bulb/lamp; uses a 512x512 shadow map if enabled.

Shadow acne tuning:
Paper planes are infinitely thin, so directional and spot lights set
shadow.bias = -0.0005 and shadow.normalBias = 0.02 to avoid striped self-shadow
artifacts.

Dynamic vs. Flat lighting toggle:
Calling lighting.setDynamicLighting(false) hides all scene lights and turns on a
uniform white AmbientLight (intensity 2.2). Calling sprite.setFlatLighting(true)
makes the sprite self-lit with its own texture so the scene looks like crisp
unlit 2D storybook art when desired.


## 6. Fixed Camera (FixedCamera.ts)

Each environment defines a fixed angle via CameraConfig:
  - fov           Field of view in degrees (38 in the spike).
  - offset        [x, y, z] camera position relative to the focus point.
  - lookAtOffset  [x, y, z] target offset (for example y = 0.85 to aim at torso).
  - followPlayer  If true, smoothly tracks the player with exponential damping
                  (1 - exp(-smoothing * dt)); if false, looks at room center.
  - bounds        Optional { minX, maxX, minZ, maxZ } so the camera stops at
                  room edges instead of showing empty void outside the walls.

Camera-mounted light:
FixedCamera owns a SpotLight ("cameraLight") positioned at the camera and aimed
at the camera's look target. It can be toggled on/off at runtime via
setCameraLightEnabled(true/false).
