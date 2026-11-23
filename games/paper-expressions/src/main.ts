import * as THREE from 'three';
import { EngineApp, type SceneBuiltContext } from '@stapler/engine';
import { PAPER_EXPRESSIONS_MANIFEST } from './manifest';
import './style.css';

async function bootstrap(): Promise<void> {
  const viewportEl = document.getElementById('viewport');
  const statsEl = document.getElementById('hud-stats');
  const btnLighting = document.getElementById('btn-lighting') as HTMLButtonElement | null;
  const btnCamera = document.getElementById('btn-camera') as HTMLButtonElement | null;
  const btnCamLight = document.getElementById('btn-camlight') as HTMLButtonElement | null;
  const btnDebug = document.getElementById('btn-debug') as HTMLButtonElement | null;
  const btnPause = document.getElementById('btn-pause') as HTMLButtonElement | null;

  if (!viewportEl) {
    throw new Error('Missing #viewport element');
  }

  const app = new EngineApp({
    container: viewportEl,
    manifest: PAPER_EXPRESSIONS_MANIFEST,
    onSceneBuilt: attachPlaceholderProps,
    onStatsTick: ({ x, z, facing, fps, mode, environmentId }) => {
      if (statsEl) {
        statsEl.textContent = `${environmentId} [${mode}] | (${x.toFixed(2)}, ${z.toFixed(2)}) facing:${facing} | ${fps} FPS`;
      }
    },
  });

  await app.start();

  btnLighting?.addEventListener('click', () => {
    const dynamic = app.toggleDynamicLighting();
    btnLighting.textContent = `Lighting: ${dynamic ? 'Dynamic' : 'Flat'}`;
  });

  btnCamera?.addEventListener('click', () => {
    const follow = app.toggleCameraFollow();
    btnCamera.textContent = `Camera: ${follow ? 'Follow' : 'Fixed'}`;
  });

  btnCamLight?.addEventListener('click', () => {
    const on = app.toggleCameraLight();
    btnCamLight.textContent = `Cam Light: ${on ? 'On' : 'Off'}`;
  });

  btnDebug?.addEventListener('click', () => {
    const on = app.toggleDebugOverlay();
    btnDebug.textContent = `Debug: ${on ? 'On' : 'Off'}`;
  });

  btnPause?.addEventListener('click', () => {
    if (app.getMode() === 'EXPLORE') {
      void app.openPauseMenu();
    } else if (app.getMode() === 'PAUSED') {
      app.resumeFromPause();
    }
  });
}

function attachPlaceholderProps(ctx: SceneBuiltContext): void {
  const { environmentId, builtMap, sceneRoot } = ctx;

  if (environmentId === 'main_studio') {
    // Study desk inside the interior-walled alcove
    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.9, 1.4),
      new THREE.MeshStandardMaterial({ color: '#8b6f56', roughness: 0.8 }),
    );
    desk.position.set(14.1, 0.45, 2.6);
    desk.castShadow = true;
    desk.receiveShadow = true;
    sceneRoot.add(desk);
    builtMap.navGrid.addStaticBox({ id: 'study_desk', minX: 12.8, maxX: 15.4, minZ: 1.9, maxZ: 3.3 });

    const monitor = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.65, 0.6),
      new THREE.MeshStandardMaterial({ color: '#424957', roughness: 0.65 }),
    );
    monitor.position.set(13.6, 1.225, 2.5);
    monitor.castShadow = true;
    monitor.receiveShadow = true;
    sceneRoot.add(monitor);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 16),
      new THREE.MeshStandardMaterial({
        color: '#ffcf87',
        emissive: '#ff9d5c',
        emissiveIntensity: 1.5,
      }),
    );
    bulb.position.set(14.8, 1.15, 2.5);
    sceneRoot.add(bulb);

    // Bookshelf matching blocked collision tiles col 0, rows 3..5
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 2.5, 2.8),
      new THREE.MeshStandardMaterial({ color: '#6b7785', roughness: 0.85 }),
    );
    shelf.position.set(0.5, 1.25, 4.5);
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    sceneRoot.add(shelf);

    // Study door visual frame
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 2.5, 0.16),
      new THREE.MeshStandardMaterial({ color: '#6f523b', roughness: 0.78 }),
    );
    door.position.set(13.7, 1.25, 0.12);
    door.castShadow = true;
    door.receiveShadow = true;
    sceneRoot.add(door);

    // Walk-over hallway mat visual indicator
    const matMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.5, 1.5),
      new THREE.MeshStandardMaterial({ color: '#c47b5a', roughness: 0.95 }),
    );
    matMesh.rotation.x = -Math.PI / 2;
    matMesh.position.set(5.75, 0.01, 1.25);
    matMesh.receiveShadow = true;
    sceneRoot.add(matMesh);
    return;
  }

  if (environmentId === 'study_closet') {
    // Glowing diagnostics terminal matching blocked tiles (3..4, 0)
    const consoleBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 1.1, 0.85),
      new THREE.MeshStandardMaterial({ color: '#394256', roughness: 0.7 }),
    );
    consoleBase.position.set(4.0, 0.55, 0.52);
    consoleBase.castShadow = true;
    consoleBase.receiveShadow = true;
    sceneRoot.add(consoleBase);

    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.7, 0.12),
      new THREE.MeshStandardMaterial({
        color: '#88d4ff',
        emissive: '#47a9ff',
        emissiveIntensity: 1.2,
      }),
    );
    screen.position.set(4.0, 1.45, 0.35);
    sceneRoot.add(screen);

    // Return doorway mat at south exit
    const exitMat = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 0.9),
      new THREE.MeshStandardMaterial({ color: '#6b8eb2', roughness: 0.92 }),
    );
    exitMat.rotation.x = -Math.PI / 2;
    exitMat.position.set(4.0, 0.012, 6.45);
    exitMat.receiveShadow = true;
    sceneRoot.add(exitMat);
  }
}

bootstrap().catch((err) => {
  console.error('[Paper expressions] Bootstrap failed:', err);
});
