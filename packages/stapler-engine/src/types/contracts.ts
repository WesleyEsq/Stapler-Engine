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

export type CgFitMode = 'cover' | 'contain';

export type CgTransitionKind = 'fade' | 'cut';

export interface CgAssetSpec {
  url: string;
  fit?: CgFitMode;
  background?: string;
}

export type EnvironmentKind = 'explore' | 'vn';

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
  /** `'explore'` (default) loads a 3D Tiled room; `'vn'` runs a full-screen dialogue/CG scene with no 3D map. */
  kind?: EnvironmentKind;
  mapUrl?: string;
  bgmId?: string;
  /** Required for `kind: 'vn'`; optional auto-playing cutscene script on entering an `'explore'` room. */
  entryScriptId?: string;
  /** Optional story flag name ensuring an `'explore'` room's `entryScriptId` only plays once. */
  entryScriptOnceFlag?: string;
  /** Fallback destination if a `'vn'` scene's script ends without an explicit `@transition`. */
  nextEnvironmentId?: string;
  nextSpawnId?: string;
  dynamicLighting?: boolean;
  lights?: LightConfig[];
  camera?: CameraConfig;
}

export interface UiThemeConfig {
  /** Optional custom CSS class added to `.stapler-ui-root` for game-level stylesheets. */
  customCssClass?: string;
  fontFamily?: string;
  speakerFontFamily?: string;
  /** Multiplier applied on top of responsive zoom-friendly dialogue text sizing (default 1.0). */
  dialogueTextScale?: number;
  dialogueMaxWidth?: string;
  dialogueMinHeight?: string;
  boxBackground?: string;
  boxTextColor?: string;
  boxBorderColor?: string;
  boxBorderWidth?: string;
  boxRadius?: string;
  boxShadow?: string;
  speakerBackground?: string;
  speakerTextColor?: string;
  speakerBorderColor?: string;
  hintColor?: string;
  accentColor?: string;
  /** Portrait stage height CSS value (default `clamp(250px, 48vh, 480px)`). */
  portraitHeight?: string;
  /** How far portrait bottoms tuck behind the top edge of the dialogue box (default `48px`). */
  portraitOverlap?: string;
  /** Brightness filter applied to non-speaking portraits (0..1, default `0.45`). */
  portraitInactiveBrightness?: number;
  /** Direction base portrait art faces by default so right-side portraits auto-mirror inward. */
  portraitDefaultFacing?: 'left' | 'right';
  /** Default image fit mode for full-screen CGs (`'contain'` preserves full framing, `'cover'` fills edge-to-edge). */
  cgDefaultFit?: CgFitMode;
  /** Letterbox/backdrop fill behind `'contain'` CGs (default `'#0f1118'`). */
  cgBackdropColor?: string;
  /** Crossfade duration in milliseconds for `@cg ... fade` transitions (default `360`). */
  cgTransitionMs?: number;
}

export interface GameManifest {
  gameId: string;
  defaultLocale: string;
  supportedLocales: string[];
  initialEnvironmentId: string;
  initialSpawnId?: string;
  playerSpriteId: string;
  maxConcurrentSfx: number;
  maxSaveSlots?: number;
  enableAutosave?: boolean;
  defaultInteractionRadius?: number;
  defaultMoveSpeed?: number;
  engineConfig?: Partial<EngineConfig>;
  /** Optional game-level visual theme & box customization for the HTML/CSS UI overlay. */
  uiTheme?: UiThemeConfig;
  environments: Record<string, EnvironmentConfig>;
  sprites: Record<string, SpriteAnimationSpec>;
  /** Optional map of characterId -> poseName -> portrait image/SVG URL. */
  portraits?: Record<string, Record<string, string>>;
  /** Optional map of cgId -> image URL or CgAssetSpec for full-screen VN CGs/backdrops. */
  cgs?: Record<string, string | CgAssetSpec>;
  /** Optional map of scriptId -> URL to .dlg script file. */
  scripts?: Record<string, string>;
  /** Optional map of localeCode -> URL to locale .json file. */
  locales?: Record<string, string>;
  audio: Record<string, { opus: string; mp3: string; kind: 'bgm' | 'sfx' | 'voice' }>;
}
