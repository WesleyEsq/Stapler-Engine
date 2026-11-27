import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './EventBus';
import { GameState } from './GameState';
import { MAX_SIMULATION_DT, ModeFsm, clampSimulationDt } from './ModeFsm';

describe('ModeFsm, clampSimulationDt, EventBus & GameState', () => {
  it('enforces valid EngineMode transitions and rejects illegal shortcuts', () => {
    const bus = new EventBus();
    const seen: Array<{ from: string; to: string }> = [];
    bus.on('mode:changed', (e) => seen.push(e));

    const fsm = new ModeFsm(bus);
    expect(fsm.getMode()).toBe('BOOT');

    // Cannot jump directly from BOOT to EXPLORE, DIALOGUE, or PAUSED
    expect(fsm.canTransition('EXPLORE')).toBe(false);
    expect(fsm.canTransition('DIALOGUE')).toBe(false);
    expect(fsm.canTransition('PAUSED')).toBe(false);
    expect(() => fsm.transition('EXPLORE')).toThrow(/Invalid EngineMode transition/);

    // Boot directly into a VN scene (LOADING -> DIALOGUE) and pause/resume mid-dialogue
    fsm.transition('LOADING');
    fsm.transition('DIALOGUE');
    fsm.transition('PAUSED');
    fsm.transition('DIALOGUE');

    // Return to exploration, pause, and load a save
    fsm.transition('EXPLORE');
    fsm.transition('PAUSED');
    fsm.transition('LOADING');
    fsm.transition('EXPLORE');

    // Cannot jump directly from LOADING to PAUSED
    fsm.transition('LOADING');
    expect(() => fsm.transition('PAUSED')).toThrow(/Invalid EngineMode transition/);

    expect(seen).toHaveLength(9);
    expect(seen[0]).toEqual({ from: 'BOOT', to: 'LOADING' });
    expect(seen[1]).toEqual({ from: 'LOADING', to: 'DIALOGUE' });
    expect(seen[2]).toEqual({ from: 'DIALOGUE', to: 'PAUSED' });
    expect(seen[3]).toEqual({ from: 'PAUSED', to: 'DIALOGUE' });
  });

  it('clamps simulation delta time to <= 0.05s and handles negative/NaN values safely', () => {
    expect(clampSimulationDt(0.016)).toBeCloseTo(0.016, 5);
    expect(clampSimulationDt(10.0)).toBe(MAX_SIMULATION_DT);
    expect(clampSimulationDt(-0.5)).toBe(0);
    expect(clampSimulationDt(Number.NaN)).toBe(0);
  });

  it('roundtrips GameState flags, coordinates, and playtime through SaveSlotData', () => {
    const bus = new EventBus();
    const flagListener = vi.fn();
    bus.on('flag:changed', flagListener);

    const state = new GameState(bus);
    state.environmentId = 'study_closet';
    state.environmentTitleKey = 'env_study_closet';
    state.setPlayerState(4.25, 3.75, 'left');
    state.addPlaytime(123.5);
    state.setFlag('met_assistant', true);
    state.setFlag('coffee_count', 2);
    state.setFlag('day_phase', 'evening');

    expect(flagListener).toHaveBeenCalledTimes(3);

    const snapshot = state.toSaveSlotData(3, '2026-11-22T14:00:00.000Z');
    const restored = new GameState();
    restored.applySaveSlotData(snapshot);

    expect(restored.environmentId).toBe('study_closet');
    expect(restored.environmentTitleKey).toBe('env_study_closet');
    expect(restored.playerX).toBe(4.25);
    expect(restored.playerZ).toBe(3.75);
    expect(restored.playerFacing).toBe('left');
    expect(restored.playtimeSeconds).toBe(123.5);
    expect(restored.getFlag('met_assistant')).toBe(true);
    expect(restored.getFlag('coffee_count')).toBe(2);
    expect(restored.getFlag('day_phase')).toBe('evening');
  });
});
