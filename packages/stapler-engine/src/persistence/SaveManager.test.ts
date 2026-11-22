import { describe, expect, it } from 'vitest';
import type { SaveSlotData } from '../types/contracts';
import { MemoryStorageAdapter, SaveManager } from './SaveManager';

function makeSlot(slotId: number | 'autosave', env = 'main_studio'): SaveSlotData {
  return {
    schemaVersion: 1,
    slotId,
    savedAt: '2026-11-22T14:30:00.000Z',
    environmentId: env,
    environmentTitleKey: `env_${env}`,
    player: { x: 4.5, z: 6.2, facing: 'right' },
    flags: { met_assistant: true },
    playtimeSeconds: 42,
  };
}

describe('SaveManager', () => {
  it('saves, loads, lists, and erases slots within configurable bounds (default 10 + autosave)', async () => {
    const manager = new SaveManager({
      gameId: 'test_game',
      defaultLocale: 'en',
      adapter: new MemoryStorageAdapter(),
    });

    expect(manager.maxSaveSlots).toBe(10);
    expect(manager.getSlotIds()).toEqual(['autosave', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    await manager.save('autosave', makeSlot('autosave', 'main_studio'));
    await manager.save(3, makeSlot(3, 'study_closet'));

    const loaded = await manager.load(3);
    expect(loaded?.environmentId).toBe('study_closet');
    expect(loaded?.flags.met_assistant).toBe(true);

    const all = await manager.listSaves();
    expect(all.size).toBe(2);

    await manager.erase(3);
    expect(await manager.load(3)).toBeNull();
    expect((await manager.listSaves()).size).toBe(1);

    await expect(manager.save(11, makeSlot(11))).rejects.toThrow(/out of bounds/);
    await expect(manager.load(0)).rejects.toThrow(/out of bounds/);
  });

  it('rejects autosave access when enableAutosave is false and persists user settings', async () => {
    const manager = new SaveManager({
      gameId: 'test_game_no_auto',
      defaultLocale: 'en',
      maxSaveSlots: 4,
      enableAutosave: false,
      adapter: new MemoryStorageAdapter(),
    });

    expect(manager.getSlotIds()).toEqual([1, 2, 3, 4]);
    await expect(manager.save('autosave', makeSlot('autosave'))).rejects.toThrow(/disabled/);

    const defaults = await manager.loadSettings();
    expect(defaults.language).toBe('en');
    expect(defaults.bgmMuted).toBe(false);

    await manager.saveSettings({ ...defaults, language: 'es', bgmVolume: 0.35, sfxMuted: true });
    const reloaded = await manager.loadSettings();
    expect(reloaded.language).toBe('es');
    expect(reloaded.bgmVolume).toBe(0.35);
    expect(reloaded.sfxMuted).toBe(true);
  });
});
