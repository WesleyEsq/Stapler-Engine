export * from './types/contracts';
export { AssetManager } from './core/AssetManager';
export { EventBus } from './core/EventBus';
export type { EngineEvents } from './core/EventBus';
export { GameState } from './core/GameState';
export { ModeFsm, clampSimulationDt, MAX_SIMULATION_DT } from './core/ModeFsm';
export { SceneManager } from './core/SceneManager';
export type {
  SceneSpawnRequest,
  ActiveSceneRuntime,
  SceneBuiltContext,
  SceneBuiltHook,
  SceneManagerOptions,
} from './core/SceneManager';
export { EngineApp } from './core/EngineApp';
export type { EngineFrameStats, EngineAppOptions } from './core/EngineApp';

export { ViewportManager } from './render/ViewportManager';
export type { ViewportOptions } from './render/ViewportManager';
export { SvgTextureLoader } from './render/SvgTextureLoader';
export type { SvgRasterizeOptions } from './render/SvgTextureLoader';
export { PaperSprite } from './render/PaperSprite';
export type { PaperSpriteOptions } from './render/PaperSprite';
export { LightingRig } from './render/LightingRig';
export { FixedCamera } from './render/FixedCamera';
export { SimpleRoomBuilder } from './render/SimpleRoomBuilder';
export type { SimpleRoomOptions, BuiltRoom } from './render/SimpleRoomBuilder';
export { TileMapBuilder, parseTiledMap, wallSegmentToAabbs } from './render/TileMapBuilder';
export type { FloorTilesetAtlas, TileMapBuildOptions, BuiltTileMap } from './render/TileMapBuilder';
export { PropLoader } from './render/PropLoader';
export type { PropSpawnOptions, SpawnedProp } from './render/PropLoader';
export { DebugOverlay } from './render/DebugOverlay';
export type { DebugOverlayOptions } from './render/DebugOverlay';

export { BasicMover } from './navigation/BasicMover';
export type { BasicMoverOptions } from './navigation/BasicMover';
export { NavGrid, NAV_WALKABLE, NAV_BLOCKED, circleIntersectsAabb } from './navigation/NavGrid';
export { Pathfinder } from './navigation/Pathfinder';
export type { PathfinderOptions } from './navigation/Pathfinder';
export { InteractionSystem, getTargetPos } from './navigation/InteractionSystem';
export type {
  InteractableTarget,
  WalkOverZone,
  TriggerFiredEvent,
} from './navigation/InteractionSystem';
export { NpcController } from './navigation/NpcController';
export type { NpcAgentOptions, NpcUpdateContext } from './navigation/NpcController';
export { MovementController } from './navigation/MovementController';
export type { MovementControllerOptions } from './navigation/MovementController';

export { parseDialogueScript, extractScriptAssets, ScriptParseError } from './dialogue/ScriptParser';
export type { DialogueStatement, ExtractedScriptAssets } from './dialogue/ScriptParser';
export { DialogueRunner } from './dialogue/DialogueRunner';
export type {
  ActivePortrait,
  ActiveCg,
  ActiveDialogueLine,
  DialogueTransitionRequest,
  DialogueStateSnapshot,
  DialogueRunnerCallbacks,
} from './dialogue/DialogueRunner';
export { I18nStore } from './dialogue/I18nStore';
export {
  TypewriterController,
  parseInlineDialogueText,
  stripInlineDialogueTags,
} from './dialogue/TypewriterText';
export type { InlineTextToken, TypewriterAdvanceResult } from './dialogue/TypewriterText';

export { AudioManager, SfxConcurrencyLimiter } from './audio/AudioManager';
export type { AudioTrackManifestEntry, QueuedSfxRequest } from './audio/AudioManager';

export {
  SaveManager,
  MemoryStorageAdapter,
  IndexedDbStorageAdapter,
  createDefaultSettings,
} from './persistence/SaveManager';
export type {
  SaveStoreName,
  SaveStorageAdapter,
  SaveManagerOptions,
} from './persistence/SaveManager';

export { UIOverlay } from './ui/UIOverlay';
export type { UIOverlayOptions } from './ui/UIOverlay';
export { DialogueView } from './ui/DialogueView';
export type { DialogueViewOptions } from './ui/DialogueView';
export { PauseMenuView } from './ui/PauseMenuView';
export type { PauseMenuCallbacks, PauseMenuViewOptions } from './ui/PauseMenuView';
export { LoadingView } from './ui/LoadingView';
