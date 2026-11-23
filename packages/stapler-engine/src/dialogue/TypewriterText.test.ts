import { describe, expect, it } from 'vitest';
import {
  TypewriterController,
  parseInlineDialogueText,
  stripInlineDialogueTags,
} from './TypewriterText';

describe('TypewriterText & TypewriterController', () => {
  it('parses {p} click pauses, {w} timed beats, and preserves unknown braces verbatim', () => {
    const tokens = parseInlineDialogueText('Wait...{w=0.4} look!{p} Keep {unknown} intact.');
    expect(tokens).toEqual([
      { type: 'text', value: 'Wait...' },
      { type: 'wait', seconds: 0.4 },
      { type: 'text', value: ' look!' },
      { type: 'click_pause' },
      { type: 'text', value: ' Keep {unknown} intact.' },
    ]);
    expect(stripInlineDialogueTags('Wait...{w=0.4} look!{p} Done.')).toBe('Wait... look! Done.');
  });

  it('pauses at {p} until click/Space and never skips past {p} when fast-forwarding', () => {
    const tw = new TypewriterController(10); // 10 chars/sec
    tw.setText('Hello...{p} world!');

    // Advance 0.3s => 3 chars ("Hel")
    tw.update(0.3);
    expect(tw.getVisibleText()).toBe('Hel');
    expect(tw.isPausedForClick()).toBe(false);

    // First click while typing fast-forwards ONLY up to {p} ("Hello...") without spoiling " world!"
    expect(tw.handleAdvance()).toBe('revealed_segment');
    expect(tw.getVisibleText()).toBe('Hello...');
    expect(tw.isPausedForClick()).toBe(true);
    expect(tw.isComplete()).toBe(false);

    // Further dt while paused at {p} must not leak characters
    tw.update(2.0);
    expect(tw.getVisibleText()).toBe('Hello...');

    // Second click resumes typing the remainder in the same box
    expect(tw.handleAdvance()).toBe('resumed_pause');
    expect(tw.isPausedForClick()).toBe(false);

    tw.update(1.0); // 10 chars => finishes " world!"
    expect(tw.getVisibleText()).toBe('Hello... world!');
    expect(tw.isComplete()).toBe(true);

    // Final click after completion signals DialogueRunner to advance to next statement
    expect(tw.handleAdvance()).toBe('advance_line');
  });

  it('waits deterministically on {w=sec} beats and appends text without clearing the box', () => {
    const tw = new TypewriterController(20);
    tw.setText('Hmm.{w=0.5} Yes!');

    // 0.2s reveals "Hmm." (4 chars) and enters 0.5s wait
    tw.update(0.2);
    expect(tw.getVisibleText()).toBe('Hmm.');

    // 0.3s into wait => still "Hmm."
    tw.update(0.3);
    expect(tw.getVisibleText()).toBe('Hmm.');

    // 0.6s more => finishes wait and reveals " Yes!"
    tw.update(0.6);
    expect(tw.getVisibleText()).toBe('Hmm. Yes!');
    expect(tw.isComplete()).toBe(true);

    // Append continues in the same box with separator
    tw.appendText('Indeed.');
    tw.update(1.0);
    expect(tw.getVisibleText()).toBe('Hmm. Yes! Indeed.');
    expect(tw.isComplete()).toBe(true);
  });
});
