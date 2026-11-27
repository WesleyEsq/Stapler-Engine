import { describe, expect, it, vi } from 'vitest';
import { GameState } from '../core/GameState';
import { DialogueRunner } from './DialogueRunner';
import { parseDialogueScript } from './ScriptParser';

describe('DialogueRunner', () => {
  it('evaluates @if/@else branches, mutates flags, tracks portraits, and emits @transition', () => {
    const state = new GameState();
    state.setFlag('has_key', true);

    const sfxSpy = vi.fn();
    const completeSpy = vi.fn();
    const runner = new DialogueRunner(state, {
      onSfx: sfxSpy,
      onComplete: completeSpy,
    });

    const script = parseDialogueScript(`
      @sfx chime
      @box system
      @portrait left unua neutral
      @portrait right assistant default
      @if has_key == true
        say unua door_unlocked
        @set entered_study true
        @transition study_closet entry right
      @else
        say unua door_locked
      @endif
    `);

    runner.start(script);

    expect(runner.isActive()).toBe(true);
    expect(sfxSpy).toHaveBeenCalledWith('chime');

    const snap = runner.getSnapshot();
    expect(snap.boxStyle).toBe('system');
    expect(snap.currentLine).toEqual({ speaker: 'unua', lineKey: 'door_unlocked' });
    expect(snap.portraits.left).toEqual({ character: 'unua', pose: 'neutral', facing: 'right' });
    expect(snap.portraits.right).toEqual({ character: 'assistant', pose: 'default', facing: 'left' });

    // Advancing executes @set and @transition, completing dialogue
    runner.advance();
    expect(runner.isActive()).toBe(false);
    expect(state.getFlag('entered_study')).toBe(true);
    expect(completeSpy).toHaveBeenCalledWith({
      transition: { environmentId: 'study_closet', spawnId: 'entry', facing: 'right' },
    });
  });

  it('pauses deterministically on @wait and resumes only after explicit dt elapses', () => {
    const state = new GameState();
    const runner = new DialogueRunner(state);

    const script = parseDialogueScript(`
      say unua before_wait
      @wait 0.5
      say unua after_wait
      @end
    `);

    runner.start(script);
    expect(runner.getSnapshot().currentLine?.lineKey).toBe('before_wait');

    runner.advance();
    expect(runner.getSnapshot().waiting).toBe(true);
    expect(runner.getSnapshot().currentLine).toBeNull();

    // Advance is ignored while waiting
    runner.advance();
    expect(runner.getSnapshot().waiting).toBe(true);

    runner.update(0.3);
    expect(runner.getSnapshot().waiting).toBe(true);

    runner.update(0.25);
    expect(runner.getSnapshot().waiting).toBe(false);
    expect(runner.getSnapshot().currentLine?.lineKey).toBe('after_wait');

    runner.advance();
    expect(runner.isActive()).toBe(false);
  });

  it('tracks @cg state, clears CGs, invokes onBgm, and emits VN-only @transition without spawnId', () => {
    const state = new GameState();
    const bgmSpy = vi.fn();
    const completeSpy = vi.fn();
    const runner = new DialogueRunner(state, {
      onBgm: bgmSpy,
      onComplete: completeSpy,
    });

    const script = parseDialogueScript(`
      @bgm chill_snow 0.6
      @cg bus_stop fade
      say _ opening_narration
      @cg unua_desk cut
      say chloe desk_line
      @cg clear cut
      @bgm stop
      say chloe after_cg
      @transition vn_epilogue
    `);

    runner.start(script);
    expect(bgmSpy).toHaveBeenCalledWith({ trackId: 'chill_snow', fadeSec: 0.6 });
    expect(runner.getSnapshot().cg).toEqual({ id: 'bus_stop', transition: 'fade' });

    runner.advance();
    expect(runner.getSnapshot().cg).toEqual({ id: 'unua_desk', transition: 'cut' });

    runner.advance();
    expect(runner.getSnapshot().cg).toBeNull();
    expect(runner.getSnapshot().cgClearTransition).toBe('cut');
    expect(bgmSpy).toHaveBeenCalledWith({ trackId: null, fadeSec: undefined });

    runner.advance();
    expect(runner.isActive()).toBe(false);
    expect(completeSpy).toHaveBeenCalledWith({
      transition: { environmentId: 'vn_epilogue', spawnId: undefined, facing: undefined },
    });
  });
});
