import * as THREE from 'three';
import type {
  EngineConfig,
  EnvironmentConfig,
  FacingDirection,
  GameManifest,
  SpriteAnimationSpec,
  Vec2,
} from '../types/contracts';
import type { AssetManager } from './AssetManager';
import { DebugOverlay } from '../render/DebugOverlay';
import { FixedCamera } from '../render/FixedCamera';
import { LightingRig } from '../render/LightingRig';
import { PaperSprite, computeSpriteCellAspect } from '../render/PaperSprite';
import type { PropLoader } from '../render/PropLoader';
import type { SvgTextureLoader } from '../render/SvgTextureLoader';
import { TileMapBuilder, type BuiltTileMap } from '../render/TileMapBuilder';
import {
  InteractionSystem,
  type InteractableTarget,
  type TriggerFiredEvent,
} from '../navigation/InteractionSystem';
import { MovementController } from '../navigation/MovementController';
import { NpcController } from '../navigation/NpcController';

export interface SceneSpawnRequest {
  spawnId?: string;
  position?: Vec2;
  facing?: FacingDirection;
}

export interface ActiveSceneRuntime {
  environmentId: string;
  envConfig: EnvironmentConfig;
  builtMap: BuiltTileMap;
  sceneRoot: THREE.Group;
  lighting: LightingRig;
  fixedCamera: FixedCamera;
  interactions: InteractionSystem;
  npcController: NpcController;
  mover: MovementController;
  debugOverlay: DebugOverlay;
  npcSprites: PaperSprite[];
  decorSprites: PaperSprite[];
}

export interface SceneBuiltContext {
  environmentId: string;
  builtMap: BuiltTileMap;
  sceneRoot: THREE.Group;
  interactions: InteractionSystem;
  assets: AssetManager;
}

export type SceneBuiltHook = (ctx: SceneBuiltContext) => void | Promise<void>;

export interface SceneManagerOptions {
  threeScene: THREE.Scene;
  domElement: HTMLElement;
  manifest: GameManifest;
  assets: AssetManager;
  svgLoader: SvgTextureLoader;
  propLoader: PropLoader;
  playerSprite: PaperSprite;
  engineConfig?: Partial<EngineConfig>;
  onTriggerFired: (event: TriggerFiredEvent, sourceNpcId?: string) => void;
  onNearestInteractableChanged?: (target: InteractableTarget | null) => void;
  onSceneBuilt?: SceneBuiltHook;
}

/**
 * Manages asynchronous environment transitions, building Tiled maps, lights,
 * props, NPCs, triggers, and navigation while deterministically disposing all
 * `scene`-scoped GPU resources on unload.
 */
export class SceneManager {
  private readonly threeScene: THREE.Scene;
  private readonly domElement: HTMLElement;
  private readonly manifest: GameManifest;
  private readonly assets: AssetManager;
  private readonly svgLoader: SvgTextureLoader;
  private readonly propLoader: PropLoader;
  private readonly playerSprite: PaperSprite;
  private readonly engineConfig?: Partial<EngineConfig>;
  private readonly onTriggerFired: (event: TriggerFiredEvent, sourceNpcId?: string) => void;
  private readonly onNearestInteractableChanged?: (target: InteractableTarget | null) => void;
  private readonly onSceneBuilt?: SceneBuiltHook;

  private active: ActiveSceneRuntime | null = null;
  private debugVisible = false;
  private cameraLightEnabled = false;

  constructor(options: SceneManagerOptions) {
    this.threeScene = options.threeScene;
    this.domElement = options.domElement;
    this.manifest = options.manifest;
    this.assets = options.assets;
    this.svgLoader = options.svgLoader;
    this.propLoader = options.propLoader;
    this.playerSprite = options.playerSprite;
    this.engineConfig = options.engineConfig;
    this.onTriggerFired = options.onTriggerFired;
    this.onNearestInteractableChanged = options.onNearestInteractableChanged;
    this.onSceneBuilt = options.onSceneBuilt;
  }

  getActive(): ActiveSceneRuntime | null {
    return this.active;
  }

  setDebugVisible(visible: boolean): void {
    this.debugVisible = visible;
    this.active?.debugOverlay.setVisible(visible);
  }

  isDebugVisible(): boolean {
    return this.debugVisible;
  }

  setCameraLightEnabled(enabled: boolean): void {
    this.cameraLightEnabled = enabled;
    this.active?.fixedCamera.setCameraLightEnabled(enabled);
  }

  isCameraLightEnabled(): boolean {
    return this.cameraLightEnabled;
  }

  /**
   * Removes all objects belonging to the current environment from Three.js
   * and deterministically disposes every `scene`-scoped GPU resource.
   */
  unloadCurrent(): number {
    if (!this.active) return 0;

    const prev = this.active;
    this.active = null;

    prev.mover.dispose();
    prev.interactions.clear();
    prev.npcController.clear();
    prev.lighting.clear();

    this.threeScene.remove(prev.sceneRoot);
    this.threeScene.remove(prev.lighting.group);
    this.threeScene.remove(prev.fixedCamera.cameraLight);
    this.threeScene.remove(prev.fixedCamera.cameraLightTarget);
    this.threeScene.remove(prev.mover.clickMarker);
    this.threeScene.remove(prev.debugOverlay.group);

    this.propLoader.clearScope('scene');
    return this.assets.disposeScope('scene');
  }

  async loadEnvironment(
    environmentId: string,
    spawnReq: SceneSpawnRequest = {},
  ): Promise<ActiveSceneRuntime> {
    const envConfig = this.manifest.environments[environmentId];
    if (!envConfig) {
      throw new Error(`Unknown environment "${environmentId}" in GameManifest.`);
    }

    this.unloadCurrent();

    if (!envConfig.mapUrl) {
      throw new Error(`Environment "${environmentId}" is missing required mapUrl.`);
    }
    if (!envConfig.camera) {
      throw new Error(`Environment "${environmentId}" is missing required camera config.`);
    }

    const builtMap = await TileMapBuilder.loadAndBuild(envConfig.mapUrl, {
      engineConfig: this.engineConfig,
    });
    const { parsed, navGrid } = builtMap;

    const sceneRoot = new THREE.Group();
    sceneRoot.name = `stapler_env_${environmentId}`;
    sceneRoot.add(builtMap.group);

    // 1. Configure LightingRig (manifest lights + Tiled lights)
    const dynamicLighting = envConfig.dynamicLighting ?? true;
    const lighting = new LightingRig(this.engineConfig);
    lighting.configure([...(envConfig.lights ?? []), ...parsed.lights]);
    lighting.setDynamicLighting(dynamicLighting);
    this.threeScene.add(lighting.group);
    this.playerSprite.setFlatLighting(!dynamicLighting);

    // 2. Spawn .glb props defined in Tiled
    for (const propDef of parsed.props) {
      try {
        const spawned = await this.propLoader.spawn(propDef.modelUrl, {
          id: propDef.id,
          position: [propDef.x, 0, propDef.z],
          rotationY: propDef.rotationY,
          scale: propDef.scale,
          castShadow: propDef.castShadow,
          receiveShadow: propDef.receiveShadow,
          scope: 'scene',
        });
        sceneRoot.add(spawned.root);
        if (!propDef.collider) {
          navGrid.addStaticBox(spawned.footprint);
        }
      } catch (err) {
        console.warn(`[SceneManager] Failed to load prop "${propDef.modelUrl}":`, err);
      }
    }

    // 3. Spawn static 2D sprite decorations
    const decorSprites: PaperSprite[] = [];
    for (const sprDef of parsed.sprites) {
      const spec = this.manifest.sprites[sprDef.spriteId];
      if (!spec) continue;
      const sprite = await this.createPaperSpriteFromSpec(spec, 'scene', sprDef.worldHeight);
      sprite.setPosition(sprDef.x, sprDef.z);
      sprite.setFlatLighting(!dynamicLighting);
      sceneRoot.add(sprite.root);
      decorSprites.push(sprite);
    }

    // 4. Interactions & Triggers (enter zones + interactable triggers with invisible hitboxes)
    const interactions = new InteractionSystem({
      onTriggerFired: (evt) => this.onTriggerFired(evt),
    });

    for (const trig of parsed.triggers) {
      if (trig.triggerMode === 'enter') {
        interactions.registerZone({
          id: trig.id,
          label: trig.label,
          bounds: trig.bounds,
          oneShot: trig.oneShot,
          targetEnv: trig.targetEnv,
          targetSpawnId: trig.targetSpawnId,
          facing: trig.facing,
          scriptId: trig.scriptId,
        });
      } else {
        const w = Math.max(0.8, trig.bounds.maxX - trig.bounds.minX);
        const d = Math.max(0.8, trig.bounds.maxZ - trig.bounds.minZ);
        const hitboxMesh = new THREE.Mesh(
          new THREE.BoxGeometry(w, 2.2, d),
          new THREE.MeshBasicMaterial({ visible: false }),
        );
        hitboxMesh.position.set(trig.x, 1.1, trig.z);
        hitboxMesh.name = `hitbox_${trig.id}`;
        sceneRoot.add(hitboxMesh);

        interactions.registerInteractable({
          id: trig.id,
          label: trig.label,
          kind: 'trigger',
          x: trig.x,
          z: trig.z,
          interactionRadius: trig.interactionRadius || this.manifest.defaultInteractionRadius || 1.25,
          hitbox: hitboxMesh,
          targetEnv: trig.targetEnv,
          targetSpawnId: trig.targetSpawnId,
          facing: trig.facing,
          scriptId: trig.scriptId,
        });
      }
    }

    // 5. Spawn NPCs & Patrol paths
    const npcController = new NpcController({ navGrid });
    const npcSprites: PaperSprite[] = [];

    for (const npcDef of parsed.npcs) {
      const spec = this.manifest.sprites[npcDef.spriteId];
      if (!spec) continue;
      const npcSprite = await this.createPaperSpriteFromSpec(spec, 'scene');
      npcSprite.setPosition(npcDef.x, npcDef.z);
      npcSprite.setFlatLighting(!dynamicLighting);
      sceneRoot.add(npcSprite.root);
      npcSprites.push(npcSprite);

      const patrolWaypoints = npcDef.patrolPath ? parsed.patrolPaths[npcDef.patrolPath] : undefined;
      npcController.addNpc({
        id: npcDef.id,
        sprite: npcSprite,
        patrolPath: patrolWaypoints,
        patrolMode: npcDef.patrolMode,
        moveSpeed: npcDef.moveSpeed,
        waitAtWaypointSec: npcDef.waitAtWaypointSec,
        solidRadius: npcDef.solidRadius,
      });

      interactions.registerInteractable({
        id: npcDef.id,
        label: npcDef.label,
        kind: 'npc',
        x: npcDef.x,
        z: npcDef.z,
        getPosition: () => npcSprite.getPosition(),
        interactionRadius: npcDef.interactionRadius || this.manifest.defaultInteractionRadius || 1.25,
        hitbox: npcSprite.root,
        scriptId: npcDef.scriptId,
        onInteract: () => {
          npcController.beginInteraction(npcDef.id, this.playerSprite.getPosition());
        },
      });
    }

    // Optional game-level hook (e.g. greybox placeholder props during prototyping)
    if (this.onSceneBuilt) {
      await this.onSceneBuilt({
        environmentId,
        builtMap,
        sceneRoot,
        interactions,
        assets: this.assets,
      });
    }

    this.threeScene.add(sceneRoot);
    this.assets.registerObject3D(sceneRoot, 'scene');

    // 6. Position persistent player sprite & seed walk-over zones
    const spawnPoint = this.resolveSpawn(parsed.spawns, parsed.width, parsed.height, spawnReq);
    this.playerSprite.setPosition(spawnPoint.x, spawnPoint.z);
    this.playerSprite.setFacing(spawnPoint.facing);
    this.playerSprite.setMoving(false);
    if (spawnPoint.facing === 'back' && this.playerSprite.hasAnimation('idle_back')) {
      this.playerSprite.playAnimation('idle_back');
    } else {
      this.playerSprite.playAnimation('idle');
    }
    interactions.seedInitialPosition(spawnPoint.x, spawnPoint.z);

    // 7. Camera, DebugOverlay & MovementController
    const fixedCamera = new FixedCamera(envConfig.camera);
    fixedCamera.attachToScene(this.threeScene);
    fixedCamera.setCameraLightEnabled(this.cameraLightEnabled);
    fixedCamera.snapTo(spawnPoint.x, spawnPoint.z);

    const debugOverlay = new DebugOverlay({
      navGrid,
      interactions,
      patrolPaths: parsed.patrolPaths,
      visible: this.debugVisible,
    });
    this.threeScene.add(debugOverlay.group);
    this.assets.registerObject3D(debugOverlay.group, 'scene');

    const mover = new MovementController({
      domElement: this.domElement,
      camera: fixedCamera.camera,
      floorMesh: builtMap.floorMesh,
      sprite: this.playerSprite,
      navGrid,
      interactions,
      moveSpeed: this.manifest.defaultMoveSpeed ?? 4.4,
      agentRadius: 0.28,
      onPathChanged: (waypoints) => debugOverlay.setActivePath(waypoints),
      onNearestChanged: (target) => this.onNearestInteractableChanged?.(target),
    });
    this.threeScene.add(mover.clickMarker);
    this.assets.registerObject3D(mover.clickMarker, 'scene');

    this.active = {
      environmentId,
      envConfig,
      builtMap,
      sceneRoot,
      lighting,
      fixedCamera,
      interactions,
      npcController,
      mover,
      debugOverlay,
      npcSprites,
      decorSprites,
    };

    return this.active;
  }

  private async createPaperSpriteFromSpec(
    spec: SpriteAnimationSpec,
    scope: 'scene' | 'persistent',
    overrideWorldHeight?: number,
  ): Promise<PaperSprite> {
    const tex = await this.svgLoader.load(spec.svgUrl, {
      width: spec.renderWidth,
      height: spec.renderHeight,
      scope,
    });
    const aspect = computeSpriteCellAspect(
      spec.renderWidth,
      spec.renderHeight,
      spec.columns,
      spec.rows,
    );
    return new PaperSprite({
      texture: tex,
      worldHeight: overrideWorldHeight ?? spec.worldHeight,
      aspectRatio: aspect,
      alphaTest: 0.5,
      groundOffset: 0.06,
      columns: spec.columns,
      rows: spec.rows,
      animations: spec.animations,
    });
  }

  private resolveSpawn(
    spawns: BuiltTileMap['parsed']['spawns'],
    width: number,
    height: number,
    req: SceneSpawnRequest,
  ): { x: number; z: number; facing: FacingDirection } {
    if (req.position) {
      return {
        x: req.position.x,
        z: req.position.z,
        facing: req.facing ?? 'front',
      };
    }
    if (req.spawnId && spawns[req.spawnId]) {
      const s = spawns[req.spawnId]!;
      return { x: s.x, z: s.z, facing: req.facing ?? s.facing };
    }
    const first = Object.values(spawns)[0];
    if (first) {
      return { x: first.x, z: first.z, facing: req.facing ?? first.facing };
    }
    return { x: width * 0.5, z: height * 0.5, facing: req.facing ?? 'front' };
  }
}
