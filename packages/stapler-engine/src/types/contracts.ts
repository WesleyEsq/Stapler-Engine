export type EngineMode = 'BOOT' | 'LOADING' | 'EXPLORE' | 'DIALOGUE' | 'PAUSED';

export type AssetScope = 'persistent' | 'scene';

export type FacingDirection = 'front' | 'back' | 'left' | 'right';

export interface EngineConfig {
  maxTiles: number;
  maxDimension: number;
  maxLights: number;
  maxShadowLights: number;
  maxDpr: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  maxTiles: 4096,
  maxDimension: 64,
  maxLights: 8,
  maxShadowLights: 2,
  maxDpr: 2,
};

export interface LightConfig {
  type: 'directional' | 'point' | 'spot' | 'hemisphere';
  color: string;
  groundColor?: string;
  intensity: number;
  position?: [number, number, number];
  target?: [number, number, number];
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  castShadow?: boolean;
  attachToCamera?: boolean;
}

export interface CameraConfig {
  fov: number;
  offset: [number, number, number];
  lookAtOffset: [number, number, number];
  followPlayer: boolean;
  followSmoothing?: number;
  bounds?: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

export interface WallConfig {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type TriggerMode = 'enter' | 'interact';

export type PatrolMode = 'loop' | 'pingpong' | 'once';

export interface Vec2 {
  x: number;
  z: number;
}

export interface Aabb2D {
  id?: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CircleCollider2D {
  id: string;
  x: number;
  z: number;
  radius: number;
}

export interface SpriteAnimationClip {
  row: number;
  frames: number;
  fps: number;
  loop: boolean;
}

export interface SpriteAnimationSpec {
  id: string;
  svgUrl: string;
  renderWidth: number;
  renderHeight: number;
  worldHeight: number;
  /** Optional sprite-sheet grid; defaults to 1x1 single frame. */
  columns?: number;
  rows?: number;
  animations?: Record<string, SpriteAnimationClip>;
}

export interface TiledWallSegment {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  thickness: number;
  height: number;
  textureId?: string;
  doubleSided: boolean;
  castShadow: boolean;
  blocksMovement: boolean;
}

export interface TiledSpawnDef {
  id: string;
  x: number;
  z: number;
  facing: FacingDirection;
}

export interface TiledTriggerDef {
  id: string;
  name: string;
  triggerMode: TriggerMode;
  bounds: Aabb2D;
  x: number;
  z: number;
  interactionRadius: number;
  targetEnv?: string;
  targetSpawnId?: string;
  facing?: FacingDirection;
  scriptId?: string;
  label?: string;
  oneShot: boolean;
}

export interface TiledNpcDef {
  id: string;
  name: string;
  x: number;
  z: number;
  spriteId: string;
  scriptId?: string;
  label?: string;
  interactionRadius: number;
  solidRadius: number;
  patrolPath?: string;
  patrolMode: PatrolMode;
  moveSpeed: number;
  waitAtWaypointSec: number;
}

export interface TiledPropDef {
  id: string;
  name: string;
  x: number;
  z: number;
  modelUrl: string;
  scale: number;
  rotationY: number;
  castShadow: boolean;
  receiveShadow: boolean;
  collider?: Aabb2D;
}

export interface TiledSpriteDef {
  id: string;
  name: string;
  x: number;
  z: number;
  spriteId: string;
  worldHeight?: number;
}

export interface ParsedTiledMap {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  /** Row-major floor GIDs (length = width * height); 0 = empty void tile. */
  floorGids: Uint32Array;
  /** Row-major collision flags (length = width * height); 1 = blocked. */
  collisionFlags: Uint8Array;
  walls: WallConfig;
  wallTextureId?: string;
  floorPrimaryColor?: string;
  floorSecondaryColor?: string;
  wallColor?: string;
  wallAccentColor?: string;
  interiorWalls: TiledWallSegment[];
  spawns: Record<string, TiledSpawnDef>;
  triggers: TiledTriggerDef[];
  npcs: TiledNpcDef[];
  props: TiledPropDef[];
  sprites: TiledSpriteDef[];
  lights: LightConfig[];
  patrolPaths: Record<string, Vec2[]>;
}

export type FlagValue = boolean | number | string;

export type PortraitSlot = 'left' | 'center' | 'right';

export interface UserSettings {
  language: string;
  bgmVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  bgmMuted: boolean;
  sfxMuted: boolean;
  voiceMuted: boolean;
}

export interface LocaleBundle {
  ui?: Record<string, string>;
  environments?: Record<string, string>;
  speakers: Record<string, string>;
  lines: Record<string, string>;
}

export interface SaveSlotData {
  schemaVersion: 1;
  slotId: number | 'autosave';
  savedAt: string;
  environmentId: string;
  environmentTitleKey: string;
  player: {
    x: number;
    z: number;
    facing: FacingDirection;
  };
  flags: Record<string, FlagValue>;
  playtimeSeconds: number;
}

export interface EnvironmentConfig {
  id: string;
  titleKey: string;
  mapUrl?: string;
  bgmId?: string;
  dynamicLighting: boolean;
  lights: LightConfig[];
  camera: CameraConfig;
}

export interface GameManifest {
  gameId: string;
  defaultLocale: string;
  supportedLocales: string[];
  initialEnvironmentId: string;
  initialSpawnId: string;
  playerSpriteId: string;
  maxConcurrentSfx: number;
  maxSaveSlots?: number;
  enableAutosave?: boolean;
  defaultInteractionRadius?: number;
  defaultMoveSpeed?: number;
  engineConfig?: Partial<EngineConfig>;
  environments: Record<string, EnvironmentConfig>;
  sprites: Record<string, SpriteAnimationSpec>;
  /** Optional map of characterId -> poseName -> portrait image/SVG URL. */
  portraits?: Record<string, Record<string, string>>;
  /** Optional map of scriptId -> URL to .dlg script file. */
  scripts?: Record<string, string>;
  /** Optional map of localeCode -> URL to locale .json file. */
  locales?: Record<string, string>;
  audio: Record<string, { opus: string; mp3: string; kind: 'bgm' | 'sfx' | 'voice' }>;
}
