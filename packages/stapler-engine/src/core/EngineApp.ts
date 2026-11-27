import * as THREE from 'three';
import type {
  EngineMode,
  FacingDirection,
  GameManifest,
  UserSettings,
  Vec2,
} from '../types/contracts';
import { AssetManager } from './AssetManager';
import { EventBus } from './EventBus';
import { GameState } from './GameState';
import { ModeFsm, clampSimulationDt } from './ModeFsm';
import { SceneManager, type SceneBuiltHook, type SceneSpawnRequest } from './SceneManager';
import { AudioManager } from '../audio/AudioManager';
import { DialogueRunner } from '../dialogue/DialogueRunner';
import { I18nStore } from '../dialogue/I18nStore';
import {
  extractScriptAssets,
  parseDialogueScript,
  type DialogueStatement,
} from '../dialogue/ScriptParser';
import {
  SaveManager,
  createDefaultSettings,
  type SaveStorageAdapter,
} from '../persistence/SaveManager';
import { PaperSprite, computeSpriteCellAspect } from '../render/PaperSprite';
import { PropLoader } from '../render/PropLoader';
import { SvgTextureLoader } from '../render/SvgTextureLoader';
import { ViewportManager } from '../render/ViewportManager';
import { UIOverlay } from '../ui/UIOverlay';
import type { InteractableTarget, TriggerFiredEvent } from '../navigation/InteractionSystem';

export interface EngineFrameStats {
  x: number;
  z: number;
  facing: FacingDirection;
  fps: number;
  mode: EngineMode;
  environmentId: string;
}

export interface EngineAppOptions {
  container: HTMLElement;
  manifest: GameManifest;
  storageAdapter?: SaveStorageAdapter;
  onSceneBuilt?: SceneBuiltHook;
  onStatsTick?: (stats: EngineFrameStats) => void;
  backgroundColor?: string;
}

/**
 * Top-level reusable Stapler Engine runtime. Bootstraps purely from a typed
 * `GameManifest`, orchestrating the `ModeFsm`, `SceneManager`, `DialogueRunner`,
 * `I18nStore`, `AudioManager`, `SaveManager`, and responsive HTML/CSS `UIOverlay`.
 */
export class EngineApp {
  readonly bus = new EventBus();
  readonly assets = new AssetManager();
  readonly state: GameState;
  readonly fsm: ModeFsm;
  readonly i18n: I18nStore;
  readonly audio: AudioManager;
  readonly saves: SaveManager;
  readonly viewport: ViewportManager;
  readonly threeScene = new THREE.Scene();

  private readonly container: HTMLElement;
  private readonly manifest: GameManifest;
  private readonly svgLoader: SvgTextureLoader;
  private readonly propLoader: PropLoader;
  private readonly onSceneBuilt?: SceneBuiltHook;
  private readonly onStatsTick?: (stats: EngineFrameStats) => void;

  private playerSprite: PaperSprite | null = null;
  private sceneManager: SceneManager | null = null;
  private dialogueRunner: DialogueRunner | null = null;
  private ui: UIOverlay | null = null;

  private readonly scriptCache = new Map<string, DialogueStatement[]>();
  private readonly preloadedImageUrls = new Set<string>();
  private settings: UserSettings;
  private activeDialogueNpcId: string | null = null;
  private activeDialogueScriptId: string | null = null;
  private activeVnFallback: { environmentId: string; spawnId?: string } | null = null;
  private pauseReturnMode: 'EXPLORE' | 'DIALOGUE' = 'EXPLORE';
  private lastNearestTarget: InteractableTarget | null = null;
  private pendingAsyncAction = false;

  private rafId: number | null = null;
  private lastTime = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fpsDisplay = 60;
  private disposed = false;

  constructor(options: EngineAppOptions) {
    this.container = options.container;
    this.manifest = options.manifest;
    this.onSceneBuilt = options.onSceneBuilt;
    this.onStatsTick = options.onStatsTick;

    this.state = new GameState(this.bus);
    this.fsm = new ModeFsm(this.bus, 'BOOT');
    this.i18n = new I18nStore(this.manifest.defaultLocale);
    this.settings = createDefaultSettings(this.manifest.defaultLocale);

    this.audio = new AudioManager({
      tracks: this.manifest.audio,
      maxConcurrentSfx: this.manifest.maxConcurrentSfx,
    });

    this.saves = new SaveManager({
      gameId: this.manifest.gameId,
      defaultLocale: this.manifest.defaultLocale,
      maxSaveSlots: this.manifest.maxSaveSlots ?? 10,
      enableAutosave: this.manifest.enableAutosave ?? true,
      adapter: options.storageAdapter,
    });

    this.viewport = new ViewportManager({
      container: options.container,
      maxDpr: this.manifest.engineConfig?.maxDpr ?? 2,
    });

    this.threeScene.background = new THREE.Color(options.backgroundColor ?? '#232631');
    this.svgLoader = new SvgTextureLoader(this.assets);
    this.propLoader = new PropLoader(this.assets);
  }

  getMode(): EngineMode {
    return this.fsm.getMode();
  }

  getSettings(): UserSettings {
    return { ...this.settings };
  }

  async start(): Promise<void> {
    // 1. Load saved settings & locale bundles
    this.settings = await this.saves.loadSettings();
    this.audio.applySettings(this.settings);

    if (this.manifest.locales) {
      await Promise.all(
        Object.entries(this.manifest.locales).map(async ([code, url]) => {
          try {
            await this.i18n.loadLocale(code, url);
          } catch (err) {
            console.warn(`[EngineApp] Failed to load locale "${code}":`, err);
          }
        }),
      );
    }
    if (!this.i18n.setLocale(this.settings.language)) {
      this.i18n.setLocale(this.manifest.defaultLocale);
      this.settings.language = this.i18n.getActiveLocale();
    }

    // 2. Build persistent protagonist sprite
    const playerSpec = this.manifest.sprites[this.manifest.playerSpriteId];
    if (!playerSpec) {
      throw new Error(`Missing playerSpriteId "${this.manifest.playerSpriteId}" in GameManifest.`);
    }
    const playerTex = await this.svgLoader.load(playerSpec.svgUrl, {
      width: playerSpec.renderWidth,
      height: playerSpec.renderHeight,
      scope: 'persistent',
    });
    this.playerSprite = new PaperSprite({
      texture: playerTex,
      worldHeight: playerSpec.worldHeight,
      aspectRatio: computeSpriteCellAspect(
        playerSpec.renderWidth,
        playerSpec.renderHeight,
        playerSpec.columns,
        playerSpec.rows,
      ),
      alphaTest: 0.5,
      groundOffset: 0.06,
      columns: playerSpec.columns,
      rows: playerSpec.rows,
      animations: playerSpec.animations,
    });
    this.threeScene.add(this.playerSprite.root);
    this.assets.registerObject3D(this.playerSprite.root, 'persistent');

    // 3. Wire UIOverlay & DialogueRunner
    this.ui = new UIOverlay({
      container: this.container,
      i18n: this.i18n,
      supportedLocales: this.manifest.supportedLocales,
      slotIds: this.saves.getSlotIds(),
      portraits: this.manifest.portraits,
      cgs: this.manifest.cgs,
      theme: this.manifest.uiTheme,
      onDialogueAdvance: () => this.dialogueRunner?.advance(),
      pauseCallbacks: {
        onResume: () => this.resumeFromPause(),
        onSaveSlot: (slotId) => this.saveToSlot(slotId),
        onLoadSlot: (slotId) => this.loadFromSlot(slotId),
        onEraseSlot: (slotId) => this.eraseSlot(slotId),
        onSettingsChanged: (next) => this.updateSettings(next),
      },
    });

    this.dialogueRunner = new DialogueRunner(this.state, {
      onStateChanged: (snap) => this.ui?.dialogue.render(snap),
      onSfx: (soundId) => void this.audio.playSfx(soundId),
      onVoice: (voiceId) => void this.audio.playVoice(voiceId),
      onBgm: ({ trackId, fadeSec }) => {
        if (trackId === null) {
          this.audio.stopBgm();
        } else {
          void this.audio.playBgm(trackId, fadeSec);
        }
      },
      onComplete: ({ transition }) => {
        const npcId = this.activeDialogueNpcId;
        const scriptId = this.activeDialogueScriptId;
        const vnFallback = this.activeVnFallback;
        this.activeDialogueNpcId = null;
        this.activeDialogueScriptId = null;
        this.activeVnFallback = null;
        this.audio.stopVoice();

        if (npcId) {
          this.sceneManager?.getActive()?.npcController.endInteraction(npcId);
        }
        if (scriptId) {
          this.bus.emit('dialogue:ended', { scriptId });
        }

        if (transition) {
          void this.transitionToEnvironment(transition.environmentId, {
            spawnId: transition.spawnId,
            facing: transition.facing,
          });
        } else if (vnFallback) {
          void this.transitionToEnvironment(vnFallback.environmentId, {
            spawnId: vnFallback.spawnId,
          });
        } else if (this.fsm.getMode() === 'DIALOGUE') {
          this.fsm.transition('EXPLORE');
          this.sceneManager?.getActive()?.mover.setEnabled(true, { interactCooldownSec: 0.25 });
        }
      },
    });

    // 4. Wire SceneManager
    this.sceneManager = new SceneManager({
      threeScene: this.threeScene,
      domElement: this.viewport.renderer.domElement,
      manifest: this.manifest,
      assets: this.assets,
      svgLoader: this.svgLoader,
      propLoader: this.propLoader,
      playerSprite: this.playerSprite,
      engineConfig: this.manifest.engineConfig,
      onSceneBuilt: this.onSceneBuilt,
      onNearestInteractableChanged: (target) => {
        this.lastNearestTarget = target;
        this.refreshInteractPrompt();
      },
      onTriggerFired: (evt, sourceNpcId) => this.handleTriggerFired(evt, sourceNpcId),
    });

    window.addEventListener('keydown', this.onGlobalKeyDown);

    // 5. Load initial environment & start main loop
    await this.transitionToEnvironment(this.manifest.initialEnvironmentId, {
      spawnId: this.manifest.initialSpawnId,
    });

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  async transitionToEnvironment(
    environmentId: string,
    spawnReq: SceneSpawnRequest = {},
    options: { skipAutosave?: boolean } = {},
  ): Promise<void> {
    if (!this.sceneManager || !this.ui || !this.dialogueRunner) return;

    const envCfg = this.manifest.environments[environmentId];
    if (!envCfg) {
      throw new Error(`Unknown environment "${environmentId}" in GameManifest.`);
    }

    const prevMode = this.fsm.getMode();
    if (prevMode === 'PAUSED') {
      this.ui.pauseMenu.close();
    }
    if (prevMode === 'DIALOGUE') {
      this.dialogueRunner.stop();
    }
    this.activeDialogueNpcId = null;
    this.activeDialogueScriptId = null;
    this.activeVnFallback = null;

    this.sceneManager.getActive()?.mover.setEnabled(false, { snapToIdle: true });
    this.fsm.transition('LOADING');
    this.ui.setInteractPrompt(null);
    this.lastNearestTarget = null;

    const roomTitle = this.i18n.getEnvironmentTitle(envCfg.titleKey);
    this.ui.loading.show(`${this.i18n.getUi('loading_prefix', 'Loading')} ${roomTitle}...`);

    if (envCfg.kind === 'vn') {
      if (!envCfg.entryScriptId) {
        throw new Error(`VN environment "${environmentId}" is missing required entryScriptId.`);
      }

      this.sceneManager.unloadCurrent();
      if (this.playerSprite) {
        this.playerSprite.root.visible = false;
      }

      this.state.environmentId = environmentId;
      this.state.environmentTitleKey = envCfg.titleKey;

      if (envCfg.bgmId) {
        void this.audio.playBgm(envCfg.bgmId);
      }

      const statements = await this.loadScript(envCfg.entryScriptId);
      if (statements) {
        await this.preloadScriptAssets(statements);
      }

      this.ui.loading.hide();
      this.fsm.transition('DIALOGUE');

      if (!options.skipAutosave && prevMode !== 'BOOT' && this.saves.enableAutosave) {
        await this.saveToSlot('autosave');
      }

      this.bus.emit('scene:loaded', { environmentId });

      if (statements) {
        this.activeDialogueScriptId = envCfg.entryScriptId;
        this.activeVnFallback = envCfg.nextEnvironmentId
          ? { environmentId: envCfg.nextEnvironmentId, spawnId: envCfg.nextSpawnId }
          : null;
        this.bus.emit('dialogue:started', { scriptId: envCfg.entryScriptId });
        this.dialogueRunner.start(statements);
      } else if (envCfg.nextEnvironmentId) {
        void this.transitionToEnvironment(envCfg.nextEnvironmentId, {
          spawnId: envCfg.nextSpawnId,
        });
      }
      return;
    }

    if (this.playerSprite) {
      this.playerSprite.root.visible = true;
    }

    const active = await this.sceneManager.loadEnvironment(environmentId, spawnReq);
    this.viewport.attachCamera(active.fixedCamera.camera);

    const pos = this.playerSprite!.getPosition();
    this.state.environmentId = environmentId;
    this.state.environmentTitleKey = active.envConfig.titleKey;
    this.state.setPlayerState(pos.x, pos.z, this.playerSprite!.getFacing());

    if (active.envConfig.bgmId) {
      void this.audio.playBgm(active.envConfig.bgmId);
    }

    // Render 1 warm-up frame to compile shaders before revealing the scene
    this.viewport.renderer.render(this.threeScene, active.fixedCamera.camera);

    const shouldPlayEntryScript =
      Boolean(envCfg.entryScriptId) &&
      (!envCfg.entryScriptOnceFlag || this.state.getFlag(envCfg.entryScriptOnceFlag) !== true);

    if (shouldPlayEntryScript && envCfg.entryScriptId) {
      const entryStatements = await this.loadScript(envCfg.entryScriptId);
      if (entryStatements) {
        await this.preloadScriptAssets(entryStatements);
        if (envCfg.entryScriptOnceFlag) {
          this.state.setFlag(envCfg.entryScriptOnceFlag, true);
        }

        this.ui.loading.hide();
        active.mover.setEnabled(false, { snapToIdle: true });
        this.fsm.transition('DIALOGUE');

        if (!options.skipAutosave && prevMode !== 'BOOT' && this.saves.enableAutosave) {
          await this.saveToSlot('autosave');
        }

        this.bus.emit('scene:loaded', { environmentId, spawnId: spawnReq.spawnId });
        this.activeDialogueScriptId = envCfg.entryScriptId;
        this.bus.emit('dialogue:started', { scriptId: envCfg.entryScriptId });
        this.dialogueRunner.start(entryStatements);
        return;
      }
    }

    this.ui.loading.hide();
    this.fsm.transition('EXPLORE');
    active.mover.setEnabled(true);

    if (!options.skipAutosave && prevMode !== 'BOOT' && this.saves.enableAutosave) {
      await this.saveToSlot('autosave');
    }

    this.bus.emit('scene:loaded', { environmentId, spawnId: spawnReq.spawnId });
  }

  async startDialogue(scriptId: string, npcId?: string): Promise<void> {
    if (!this.dialogueRunner || this.fsm.getMode() !== 'EXPLORE' || this.pendingAsyncAction) return;
    this.pendingAsyncAction = true;
    this.sceneManager?.getActive()?.mover.setEnabled(false, { snapToIdle: true });
    this.ui?.setInteractPrompt(null);
    let started = false;
    try {
      const statements = await this.loadScript(scriptId);
      if (!statements || this.fsm.getMode() !== 'EXPLORE') return;
      await this.preloadScriptAssets(statements);
      if (this.fsm.getMode() !== 'EXPLORE') return;

      this.activeDialogueNpcId = npcId ?? null;
      this.activeDialogueScriptId = scriptId;
      this.fsm.transition('DIALOGUE');
      this.bus.emit('dialogue:started', { scriptId });
      started = true;
      this.dialogueRunner.start(statements);
    } finally {
      this.pendingAsyncAction = false;
      if (!started && this.fsm.getMode() === 'EXPLORE') {
        this.sceneManager?.getActive()?.mover.setEnabled(true);
        this.refreshInteractPrompt();
      }
    }
  }

  async openPauseMenu(): Promise<void> {
    const mode = this.fsm.getMode();
    if (!this.ui || (mode !== 'EXPLORE' && mode !== 'DIALOGUE')) return;
    this.pauseReturnMode = mode;
    if (mode === 'EXPLORE') {
      this.sceneManager?.getActive()?.mover.setEnabled(false, { snapToIdle: false });
      this.ui.setInteractPrompt(null);
    }
    this.fsm.transition('PAUSED');
    const saves = await this.saves.listSaves();
    this.ui.pauseMenu.open(this.settings, saves);
  }

  resumeFromPause(): void {
    if (!this.ui || this.fsm.getMode() !== 'PAUSED') return;
    this.ui.pauseMenu.close();
    const targetMode = this.pauseReturnMode;
    this.fsm.transition(targetMode);
    if (targetMode === 'EXPLORE') {
      this.sceneManager?.getActive()?.mover.setEnabled(true);
      this.refreshInteractPrompt();
    }
  }

  async saveToSlot(slotId: number | 'autosave'): Promise<void> {
    if (this.sceneManager?.getActive() && this.playerSprite) {
      const pos = this.playerSprite.getPosition();
      this.state.setPlayerState(pos.x, pos.z, this.playerSprite.getFacing());
    }
    const payload = this.state.toSaveSlotData(slotId);
    await this.saves.save(slotId, payload);
    this.bus.emit('save:completed', { slotId });

    if (this.ui?.pauseMenu.isOpen()) {
      const saves = await this.saves.listSaves();
      this.ui.pauseMenu.updateSaves(saves);
    }
  }

  async loadFromSlot(slotId: number | 'autosave'): Promise<void> {
    const data = await this.saves.load(slotId);
    if (!data) return;

    this.state.applySaveSlotData(data);
    const position: Vec2 = { x: data.player.x, z: data.player.z };
    await this.transitionToEnvironment(
      data.environmentId,
      { position, facing: data.player.facing },
      { skipAutosave: true },
    );
  }

  async eraseSlot(slotId: number | 'autosave'): Promise<void> {
    await this.saves.erase(slotId);
    if (this.ui?.pauseMenu.isOpen()) {
      const saves = await this.saves.listSaves();
      this.ui.pauseMenu.updateSaves(saves);
    }
  }

  updateSettings(next: UserSettings): void {
    this.settings = { ...next };
    this.audio.applySettings(this.settings);
    this.i18n.setLocale(this.settings.language);
    this.ui?.dialogue.refreshLocale();
    this.refreshInteractPrompt();
    void this.saves.saveSettings(this.settings);
    this.bus.emit('settings:changed', { ...this.settings });
  }

  // Runtime dev/HUD helper toggles
  toggleDynamicLighting(): boolean {
    const active = this.sceneManager?.getActive();
    if (!active || !this.playerSprite) return true;
    const next = !active.lighting.isDynamicLightingEnabled();
    active.lighting.setDynamicLighting(next);
    this.playerSprite.setFlatLighting(!next);
    for (const s of active.npcSprites) s.setFlatLighting(!next);
    for (const s of active.decorSprites) s.setFlatLighting(!next);
    return next;
  }

  toggleCameraFollow(): boolean {
    const active = this.sceneManager?.getActive();
    if (!active) return true;
    const next = !active.fixedCamera.isFollowingPlayer();
    active.fixedCamera.setFollowPlayer(next);
    return next;
  }

  toggleCameraLight(): boolean {
    if (!this.sceneManager) return false;
    const next = !this.sceneManager.isCameraLightEnabled();
    this.sceneManager.setCameraLightEnabled(next);
    return next;
  }

  toggleDebugOverlay(): boolean {
    if (!this.sceneManager) return false;
    const next = !this.sceneManager.isDebugVisible();
    this.sceneManager.setDebugVisible(next);
    return next;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('keydown', this.onGlobalKeyDown);
    this.sceneManager?.unloadCurrent();
    this.ui?.dispose();
    this.audio.dispose();
    this.assets.disposeAll();
    this.viewport.dispose();
    this.bus.clear();
  }

  private handleTriggerFired(evt: TriggerFiredEvent, sourceNpcId?: string): void {
    if (this.fsm.getMode() !== 'EXPLORE' || this.pendingAsyncAction) return;
    this.bus.emit('trigger:fired', evt);

    const active = this.sceneManager?.getActive();
    const resolvedNpcId =
      sourceNpcId ?? (active?.npcController.getNpcPosition(evt.id) ? evt.id : undefined);

    if (evt.scriptId) {
      void this.startDialogue(evt.scriptId, resolvedNpcId);
      return;
    }

    if (evt.targetEnv) {
      void this.transitionToEnvironment(evt.targetEnv, {
        spawnId: evt.targetSpawnId,
        facing: evt.facing,
      });
    }
  }

  private async loadScript(scriptId: string): Promise<DialogueStatement[] | null> {
    const cached = this.scriptCache.get(scriptId);
    if (cached) return cached;

    const url = this.manifest.scripts?.[scriptId];
    if (!url) {
      console.warn(`[EngineApp] Script "${scriptId}" is not registered in manifest.scripts.`);
      return null;
    }
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[EngineApp] Failed to fetch script "${scriptId}" from "${url}" (${res.status}).`);
      return null;
    }
    const source = await res.text();
    const parsed = parseDialogueScript(source);
    this.scriptCache.set(scriptId, parsed);
    return parsed;
  }

  private async preloadScriptAssets(statements: readonly DialogueStatement[]): Promise<void> {
    if (typeof Image === 'undefined') return;
    const refs = extractScriptAssets(statements);
    const urls = new Set<string>();

    for (const { character, pose } of refs.portraits) {
      const url =
        this.manifest.portraits?.[character]?.[pose] ??
        this.manifest.portraits?.[character]?.default;
      if (url) urls.add(url);
    }

    for (const cgId of refs.cgIds) {
      const entry = this.manifest.cgs?.[cgId];
      const url = typeof entry === 'string' ? entry : entry?.url;
      if (url) urls.add(url);
    }

    await Promise.all(Array.from(urls).map((url) => this.preloadImage(url)));
  }

  private preloadImage(url: string): Promise<void> {
    if (this.preloadedImageUrls.has(url) || typeof Image === 'undefined') {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const img = new Image();
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) this.preloadedImageUrls.add(url);
        resolve();
      };
      const timer = setTimeout(() => done(false), 2500);
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = url;
    });
  }

  private refreshInteractPrompt(): void {
    if (!this.ui) return;
    if (this.fsm.getMode() !== 'EXPLORE' || !this.lastNearestTarget) {
      this.ui.setInteractPrompt(null);
      return;
    }
    const labelKey = this.lastNearestTarget.label ?? this.lastNearestTarget.id;
    const label = this.i18n.getUi(labelKey, labelKey);
    const actionPrefix = this.i18n.getUi('interact_prompt_prefix', 'Space / Click —');
    this.ui.setInteractPrompt(`${actionPrefix} ${label}`);
  }

  private readonly onGlobalKeyDown = (e: KeyboardEvent): void => {
    const mode = this.fsm.getMode();

    if (e.code === 'Escape' && !e.repeat) {
      if (mode === 'DIALOGUE' && this.ui?.dialogue.isUiHidden()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.ui.dialogue.setUiHidden(false);
        return;
      }
      if (mode === 'EXPLORE' || mode === 'DIALOGUE') {
        e.preventDefault();
        e.stopImmediatePropagation();
        void this.openPauseMenu();
      } else if (mode === 'PAUSED') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.resumeFromPause();
      }
      return;
    }

    if (mode === 'DIALOGUE' && e.code === 'KeyH' && !e.repeat) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.ui?.dialogue.toggleUiHidden();
      return;
    }

    if (mode === 'DIALOGUE' && (e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.ui?.dialogue.handleAdvanceInput();
    }
  };

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.tick);

    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = clampSimulationDt(rawDt);

    const mode = this.fsm.getMode();
    const active = this.sceneManager?.getActive();

    if (mode === 'EXPLORE' || mode === 'DIALOGUE') {
      this.state.addPlaytime(dt);
    }

    if (mode === 'DIALOGUE') {
      this.dialogueRunner?.update(dt);
      this.ui?.dialogue.update(dt);
    }

    this.fpsAccum += rawDt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.4) {
      this.fpsDisplay = Math.round(this.fpsFrames / Math.max(0.001, this.fpsAccum));
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (active && this.playerSprite) {
      if (mode === 'EXPLORE') {
        active.mover.update(dt);
      }

      if (mode !== 'PAUSED' && mode !== 'LOADING') {
        this.playerSprite.update(dt);
        const pos = this.playerSprite.getPosition();
        this.state.setPlayerState(pos.x, pos.z, this.playerSprite.getFacing());
        active.npcController.update(dt, { mode, playerPos: pos, playerRadius: 0.28 });
        active.fixedCamera.update(
          dt,
          pos.x,
          pos.z,
          active.builtMap.parsed.width * 0.5,
          active.builtMap.parsed.height * 0.5,
        );
      }

      this.viewport.renderer.render(this.threeScene, active.fixedCamera.camera);

      const pos = this.playerSprite.getPosition();
      this.onStatsTick?.({
        x: pos.x,
        z: pos.z,
        facing: this.playerSprite.getFacing(),
        fps: this.fpsDisplay,
        mode,
        environmentId: active.environmentId,
      });
    } else if (this.state.environmentId) {
      this.onStatsTick?.({
        x: this.state.playerX,
        z: this.state.playerZ,
        facing: this.state.playerFacing,
        fps: this.fpsDisplay,
        mode,
        environmentId: this.state.environmentId,
      });
    }
  };
}
