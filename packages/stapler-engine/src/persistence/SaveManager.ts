import type { SaveSlotData, UserSettings } from '../types/contracts';

export type SaveStoreName = 'saves' | 'settings';

export interface SaveStorageAdapter {
  get<T>(store: SaveStoreName, key: string): Promise<T | null>;
  put<T>(store: SaveStoreName, key: string, value: T): Promise<void>;
  delete(store: SaveStoreName, key: string): Promise<void>;
  getAll<T>(store: SaveStoreName): Promise<T[]>;
}

/** In-memory Map-backed storage adapter for zero-flake Node unit tests and fallback. */
export class MemoryStorageAdapter implements SaveStorageAdapter {
  private readonly stores: Record<SaveStoreName, Map<string, unknown>> = {
    saves: new Map(),
    settings: new Map(),
  };

  async get<T>(store: SaveStoreName, key: string): Promise<T | null> {
    const val = this.stores[store].get(key);
    return val === undefined ? null : structuredClone(val as T);
  }

  async put<T>(store: SaveStoreName, key: string, value: T): Promise<void> {
    this.stores[store].set(key, structuredClone(value));
  }

  async delete(store: SaveStoreName, key: string): Promise<void> {
    this.stores[store].delete(key);
  }

  async getAll<T>(store: SaveStoreName): Promise<T[]> {
    return Array.from(this.stores[store].values()).map((v) => structuredClone(v as T));
  }
}

/** Browser IndexedDB adapter (`stapler_db_<gameId>`, version 1). */
export class IndexedDbStorageAdapter implements SaveStorageAdapter {
  private readonly dbName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(gameId: string) {
    this.dbName = `stapler_db_${gameId}`;
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('saves')) {
          db.createObjectStore('saves');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed.'));
    });
    return this.dbPromise;
  }

  async get<T>(store: SaveStoreName, key: string): Promise<T | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result === undefined ? null : (req.result as T));
      req.onerror = () => reject(req.error);
    });
  }

  async put<T>(store: SaveStoreName, key: string, value: T): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async delete(store: SaveStoreName, key: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAll<T>(store: SaveStoreName): Promise<T[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  }
}

export interface SaveManagerOptions {
  gameId: string;
  defaultLocale: string;
  maxSaveSlots?: number;
  enableAutosave?: boolean;
  adapter?: SaveStorageAdapter;
}

export function createDefaultSettings(defaultLocale: string): UserSettings {
  return {
    language: defaultLocale,
    bgmVolume: 0.7,
    sfxVolume: 0.85,
    voiceVolume: 0.9,
    bgmMuted: false,
    sfxMuted: false,
    voiceMuted: false,
  };
}

/**
 * Persists configurable save slots (`1..maxSaveSlots` + optional `autosave`)
 * and user settings using IndexedDB in browsers or an injectable adapter in tests.
 */
export class SaveManager {
  readonly maxSaveSlots: number;
  readonly enableAutosave: boolean;
  private readonly defaultLocale: string;
  private readonly adapter: SaveStorageAdapter;

  constructor(options: SaveManagerOptions) {
    this.maxSaveSlots = Math.max(1, Math.floor(options.maxSaveSlots ?? 10));
    this.enableAutosave = options.enableAutosave ?? true;
    this.defaultLocale = options.defaultLocale;
    this.adapter =
      options.adapter ??
      (typeof indexedDB !== 'undefined'
        ? new IndexedDbStorageAdapter(options.gameId)
        : new MemoryStorageAdapter());
  }

  getSlotIds(): Array<number | 'autosave'> {
    const ids: Array<number | 'autosave'> = [];
    if (this.enableAutosave) {
      ids.push('autosave');
    }
    for (let i = 1; i <= this.maxSaveSlots; i += 1) {
      ids.push(i);
    }
    return ids;
  }

  async save(slotId: number | 'autosave', data: SaveSlotData): Promise<void> {
    const key = this.toSlotKey(slotId);
    if (data.schemaVersion !== 1) {
      throw new Error(`Unsupported save schemaVersion: ${String(data.schemaVersion)}`);
    }
    await this.adapter.put<SaveSlotData>('saves', key, { ...data, slotId });
  }

  async load(slotId: number | 'autosave'): Promise<SaveSlotData | null> {
    const key = this.toSlotKey(slotId);
    const data = await this.adapter.get<SaveSlotData>('saves', key);
    if (!data || data.schemaVersion !== 1) return null;
    return data;
  }

  async erase(slotId: number | 'autosave'): Promise<void> {
    const key = this.toSlotKey(slotId);
    await this.adapter.delete('saves', key);
  }

  async listSaves(): Promise<Map<number | 'autosave', SaveSlotData>> {
    const all = await this.adapter.getAll<SaveSlotData>('saves');
    const result = new Map<number | 'autosave', SaveSlotData>();
    for (const item of all) {
      if (item && item.schemaVersion === 1) {
        result.set(item.slotId, item);
      }
    }
    return result;
  }

  async saveSettings(settings: UserSettings): Promise<void> {
    await this.adapter.put<UserSettings>('settings', 'user_settings', settings);
  }

  async loadSettings(): Promise<UserSettings> {
    const stored = await this.adapter.get<Partial<UserSettings>>('settings', 'user_settings');
    return {
      ...createDefaultSettings(this.defaultLocale),
      ...(stored ?? {}),
    };
  }

  private toSlotKey(slotId: number | 'autosave'): string {
    if (slotId === 'autosave') {
      if (!this.enableAutosave) {
        throw new Error('Autosave slot is disabled in GameManifest.');
      }
      return 'autosave';
    }
    if (!Number.isInteger(slotId) || slotId < 1 || slotId > this.maxSaveSlots) {
      throw new Error(`Save slot ${slotId} out of bounds (1..${this.maxSaveSlots}).`);
    }
    return `slot_${slotId}`;
  }
}
