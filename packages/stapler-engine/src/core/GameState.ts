import type { FacingDirection, FlagValue, SaveSlotData } from '../types/contracts';
import type { EventBus } from './EventBus';

/**
 * Holds runtime story flags, active environment metadata, player transform,
 * and playtime, with deterministic serialization to/from `SaveSlotData`.
 */
export class GameState {
  private readonly flags = new Map<string, FlagValue>();
  private readonly bus?: EventBus;

  environmentId = '';
  environmentTitleKey = '';
  playerX = 0;
  playerZ = 0;
  playerFacing: FacingDirection = 'front';
  playtimeSeconds = 0;

  constructor(bus?: EventBus) {
    this.bus = bus;
  }

  getFlag(key: string): FlagValue | undefined {
    return this.flags.get(key);
  }

  hasFlag(key: string): boolean {
    return this.flags.has(key);
  }

  setFlag(key: string, value: FlagValue): void {
    this.flags.set(key, value);
    this.bus?.emit('flag:changed', { key, value });
  }

  getAllFlags(): Record<string, FlagValue> {
    const out: Record<string, FlagValue> = {};
    for (const [k, v] of this.flags.entries()) {
      out[k] = v;
    }
    return out;
  }

  loadFlags(flags: Record<string, FlagValue>): void {
    this.flags.clear();
    for (const [k, v] of Object.entries(flags)) {
      this.flags.set(k, v);
    }
  }

  setPlayerState(x: number, z: number, facing?: FacingDirection): void {
    this.playerX = x;
    this.playerZ = z;
    if (facing) {
      this.playerFacing = facing;
    }
  }

  addPlaytime(dt: number): void {
    if (dt > 0) {
      this.playtimeSeconds += dt;
    }
  }

  toSaveSlotData(slotId: number | 'autosave', nowIso = new Date().toISOString()): SaveSlotData {
    return {
      schemaVersion: 1,
      slotId,
      savedAt: nowIso,
      environmentId: this.environmentId,
      environmentTitleKey: this.environmentTitleKey,
      player: {
        x: this.playerX,
        z: this.playerZ,
        facing: this.playerFacing,
      },
      flags: this.getAllFlags(),
      playtimeSeconds: this.playtimeSeconds,
    };
  }

  applySaveSlotData(data: SaveSlotData): void {
    this.environmentId = data.environmentId;
    this.environmentTitleKey = data.environmentTitleKey;
    this.playerX = data.player.x;
    this.playerZ = data.player.z;
    this.playerFacing = data.player.facing;
    this.playtimeSeconds = data.playtimeSeconds;
    this.loadFlags(data.flags);
  }

  reset(): void {
    this.flags.clear();
    this.environmentId = '';
    this.environmentTitleKey = '';
    this.playerX = 0;
    this.playerZ = 0;
    this.playerFacing = 'front';
    this.playtimeSeconds = 0;
  }
}
