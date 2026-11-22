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

export interface SpriteAnimationSpec {
  id: string;
  svgUrl: string;
  renderWidth: number;
  renderHeight: number;
  worldHeight: number;
  /** Optional sprite-sheet grid; defaults to 1x1 single frame. */
  columns?: number;
  rows?: number;
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
  flags: Record<string, boolean | number | string>;
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
  environments: Record<string, EnvironmentConfig>;
  sprites: Record<string, SpriteAnimationSpec>;
  audio: Record<string, { opus: string; mp3: string; kind: 'bgm' | 'sfx' | 'voice' }>;
}
