import type { EngineMode } from '../types/contracts';
import type { EventBus } from './EventBus';

export const MAX_SIMULATION_DT = 0.05;

const ALLOWED_TRANSITIONS: Record<EngineMode, readonly EngineMode[]> = {
  BOOT: ['LOADING'],
  LOADING: ['EXPLORE'],
  EXPLORE: ['DIALOGUE', 'PAUSED', 'LOADING'],
  DIALOGUE: ['EXPLORE', 'LOADING'],
  PAUSED: ['EXPLORE', 'LOADING'],
};

/** Clamps raw frame delta time to `<= 0.05s` so tab-switches never tunnel collisions. */
export function clampSimulationDt(rawDtSeconds: number): number {
  if (!Number.isFinite(rawDtSeconds) || rawDtSeconds < 0) return 0;
  return Math.min(rawDtSeconds, MAX_SIMULATION_DT);
}

/**
 * Strict finite state machine governing engine modes (`BOOT`, `LOADING`,
 * `EXPLORE`, `DIALOGUE`, `PAUSED`) so inputs never leak across modes.
 */
export class ModeFsm {
  private current: EngineMode = 'BOOT';
  private readonly bus?: EventBus;

  constructor(bus?: EventBus, initialMode: EngineMode = 'BOOT') {
    this.bus = bus;
    this.current = initialMode;
  }

  getMode(): EngineMode {
    return this.current;
  }

  canTransition(to: EngineMode): boolean {
    if (to === this.current) return true;
    return ALLOWED_TRANSITIONS[this.current].includes(to);
  }

  transition(to: EngineMode): EngineMode {
    if (to === this.current) return this.current;
    if (!this.canTransition(to)) {
      throw new Error(`Invalid EngineMode transition: ${this.current} -> ${to}`);
    }
    const from = this.current;
    this.current = to;
    this.bus?.emit('mode:changed', { from, to });
    return this.current;
  }
}
