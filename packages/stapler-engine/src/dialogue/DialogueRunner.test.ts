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
      @portrait left unua neutral
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
    expect(snap.currentLine).toEqual({ speaker: 'unua', lineKey: 'door_unlocked' });
    expect(snap.portraits.left).toEqual({ character: 'unua', pose: 'neutral' });

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
});
