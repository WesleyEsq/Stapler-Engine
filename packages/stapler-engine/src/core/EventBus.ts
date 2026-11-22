import type { EngineMode, FlagValue, UserSettings } from '../types/contracts';
import type { TriggerFiredEvent } from '../navigation/InteractionSystem';

export interface EngineEvents {
  'mode:changed': { from: EngineMode; to: EngineMode };
  'scene:loaded': { environmentId: string; spawnId?: string };
  'dialogue:started': { scriptId: string };
  'dialogue:ended': { scriptId: string };
  'flag:changed': { key: string; value: FlagValue };
  'trigger:fired': TriggerFiredEvent;
  'settings:changed': UserSettings;
  'save:completed': { slotId: number | 'autosave' };
}

type Listener<T> = (payload: T) => void;

/**
 * Typed publish/subscribe event bus decoupling core engine subsystems.
 */
export class EventBus<TEvents extends object = EngineEvents> {
  private readonly listeners = new Map<keyof TEvents, Set<Listener<unknown>>>();

  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<unknown>);
    return () => this.off(event, listener);
  }

  once<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    const wrapped: Listener<TEvents[K]> = (payload) => {
      this.off(event, wrapped);
      listener(payload);
    };
    return this.on(event, wrapped);
  }

  off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener as Listener<unknown>);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of Array.from(set)) {
      (listener as Listener<TEvents[K]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
