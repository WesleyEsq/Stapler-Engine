import * as THREE from 'three';
import {
  AssetManager,
  BasicMover,
  FixedCamera,
  LightingRig,
  PaperSprite,
  SimpleRoomBuilder,
  SvgTextureLoader,
  ViewportManager,
} from '@stapler/engine';
import './style.css';

async function bootstrap(): Promise<void> {
  const viewportEl = document.getElementById('viewport');
  const statsEl = document.getElementById('hud-stats');
  const btnLighting = document.getElementById('btn-lighting') as HTMLButtonElement | null;
  const btnCamera = document.getElementById('btn-camera') as HTMLButtonElement | null;
  const btnCamLight = document.getElementById('btn-camlight') as HTMLButtonElement | null;

  if (!viewportEl) {
    throw new Error('Missing #viewport element');
  }

  const assets = new AssetManager();
  const viewport = new ViewportManager({ container: viewportEl, maxDpr: 2 });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#232631');

  // 1. Build greybox room (14 x 10 tiles, open south wall for camera)
  const roomWidth = 14;
  const roomHeight = 10;
  const room = SimpleRoomBuilder.build({
    width: roomWidth,
    height: roomHeight,
    walls: { north: 4, south: 0, east: 4, west: 4 },
    floorPrimaryColor: '#ebe3d3',
    floorSecondaryColor: '#e2d9c6',
    wallColor: '#d7e0e5',
    wallAccentColor: '#bac8d0',
  });
  scene.add(room.group);
  assets.registerObject3D(room.group, 'scene');

  // Add two simple 3D greybox props (desk + glowing lab lamp) to verify 2D-vs-3D lighting & shadows
  const propsGroup = buildGreyboxProps();
  scene.add(propsGroup);
  assets.registerObject3D(propsGroup, 'scene');

  // 2. Configure LightingRig (1 shadow-casting directional key + hemisphere + warm desk lamp)
  const lighting = new LightingRig({ maxLights: 8, maxShadowLights: 2 });
  lighting.configure([
    {
      type: 'hemisphere',
      color: '#f5f8ff',
      groundColor: '#6b6258',
      intensity: 0.75,
    },
    {
      type: 'directional',
      color: '#fff4e0',
      intensity: 1.9,
      position: [13, 12, 11],
      target: [roomWidth * 0.5, 0, roomHeight * 0.5],
      castShadow: true,
    },
    {
      type: 'point',
      color: '#ff9d5c',
      intensity: 9,
      position: [11.2, 2.2, 2.2],
      distance: 10,
      decay: 1.8,
      castShadow: false,
    },
  ]);
  scene.add(lighting.group);

  // 3. Load Professor Unua's SVG into a rasterized 2D paper-cutout sprite
  const svgLoader = new SvgTextureLoader(assets);
  const unuaTex = await svgLoader.load('/assets/sprites/unua.svg', {
    width: 512,
    height: 512,
    scope: 'persistent',
  });

  const unua = new PaperSprite({
    texture: unuaTex,
    worldHeight: 2.1,
    aspectRatio: 1.0,
    alphaTest: 0.5,
    groundOffset: 0.06,
  });
  unua.setPosition(roomWidth * 0.5, roomHeight * 0.55);
  scene.add(unua.root);
  assets.registerObject3D(unua.root, 'persistent');

  // 4. Fixed-angle 2.5D camera with optional player follow & camera light
  const fixedCamera = new FixedCamera({
    fov: 38,
    offset: [0, 7.2, 9.8],
    lookAtOffset: [0, 0.85, 0],
    followPlayer: true,
    followSmoothing: 6.5,
    bounds: { minX: 4.5, maxX: roomWidth - 4.5, minZ: 3.5, maxZ: roomHeight - 2.0 },
  });
  fixedCamera.attachToScene(scene);
  fixedCamera.snapTo(roomWidth * 0.5, roomHeight * 0.55);
  viewport.attachCamera(fixedCamera.camera);

  // 5. Point-and-click + WASD movement
  const mover = new BasicMover({
    domElement: viewport.renderer.domElement,
    camera: fixedCamera.camera,
    floorMesh: room.floorMesh,
    sprite: unua,
    bounds: { minX: 0.7, maxX: roomWidth - 0.7, minZ: 0.8, maxZ: roomHeight - 0.7 },
    moveSpeed: 4.4,
  });
  scene.add(mover.clickMarker);
  assets.registerObject3D(mover.clickMarker, 'scene');

  // 6. Wire HUD debug toggles
  btnLighting?.addEventListener('click', () => {
    const next = !lighting.isDynamicLightingEnabled();
    lighting.setDynamicLighting(next);
    unua.setFlatLighting(!next);
    btnLighting.textContent = `Lighting: ${next ? 'Dynamic' : 'Flat'}`;
  });

  btnCamera?.addEventListener('click', () => {
    const next = !fixedCamera.isFollowingPlayer();
    fixedCamera.setFollowPlayer(next);
    btnCamera.textContent = `Camera: ${next ? 'Follow' : 'Fixed'}`;
  });

  btnCamLight?.addEventListener('click', () => {
    const next = !fixedCamera.isCameraLightEnabled();
    fixedCamera.setCameraLightEnabled(next);
    btnCamLight.textContent = `Cam Light: ${next ? 'On' : 'Off'}`;
  });

  // 7. Clamped simulation & render loop
  let lastTime = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fpsDisplay = 60;

  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(rawDt, 0.05);

    mover.update(dt);
    unua.update(dt);

    const pos = unua.getPosition();
    fixedCamera.update(dt, pos.x, pos.z, roomWidth * 0.5, roomHeight * 0.5);
    viewport.renderer.render(scene, fixedCamera.camera);

    fpsAccum += rawDt;
    fpsFrames += 1;
    if (fpsAccum >= 0.4) {
      fpsDisplay = Math.round(fpsFrames / fpsAccum);
      fpsAccum = 0;
      fpsFrames = 0;
    }
    if (statsEl) {
      statsEl.textContent = `Pos: (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}) | ${fpsDisplay} FPS`;
    }
  };

  requestAnimationFrame(tick);
}

function buildGreyboxProps(): THREE.Group {
  const group = new THREE.Group();

  // Lab desk near top-right corner
  const deskMat = new THREE.MeshStandardMaterial({ color: '#8b6f56', roughness: 0.8 });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.3), deskMat);
  desk.position.set(11.2, 0.45, 2.0);
  desk.castShadow = true;
  desk.receiveShadow = true;
  group.add(desk);

  // Small CRT / lab monitor on desk
  const monitorMat = new THREE.MeshStandardMaterial({ color: '#424957', roughness: 0.65 });
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.65, 0.6), monitorMat);
  monitor.position.set(10.7, 1.225, 1.9);
  monitor.castShadow = true;
  monitor.receiveShadow = true;
  group.add(monitor);

  // Warm glowing desk lamp bulb
  const bulbMat = new THREE.MeshStandardMaterial({
    color: '#ffcf87',
    emissive: '#ff9d5c',
    emissiveIntensity: 1.5,
  });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), bulbMat);
  bulb.position.set(11.9, 1.15, 2.0);
  group.add(bulb);

  // Bookshelf / cabinet against left wall
  const shelfMat = new THREE.MeshStandardMaterial({ color: '#6b7785', roughness: 0.85 });
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.4, 2.4), shelfMat);
  shelf.position.set(0.65, 1.2, 3.2);
  shelf.castShadow = true;
  shelf.receiveShadow = true;
  group.add(shelf);

  return group;
}

bootstrap().catch((err) => {
  console.error('[Paper expressions] Bootstrap failed:', err);
});
