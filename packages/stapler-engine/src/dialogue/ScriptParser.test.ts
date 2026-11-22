import { describe, expect, it } from 'vitest';
import { ScriptParseError, parseDialogueScript } from './ScriptParser';

describe('ScriptParser', () => {
  it('parses portraits, sfx, say, nested @if/@else, @set, @wait, and @transition cleanly', () => {
    const src = `
      # Intro conversation
      @sfx ui_open
      @portrait left chloe sleepy
      @portrait right ada inquiry
      say ada line_01

      @if fell_downstairs == true
        say chloe line_secret
        @set confessed true
      @else
        say chloe line_normal
      @endif

      @portrait right clear
      @wait 0.4
      @transition classroom spawn_door left
      @end
    `;

    const ast = parseDialogueScript(src);
    expect(ast).toHaveLength(9);
    expect(ast[0]).toMatchObject({ type: 'sfx', soundId: 'ui_open' });
    expect(ast[1]).toMatchObject({ type: 'portrait', slot: 'left', character: 'chloe', pose: 'sleepy' });
    expect(ast[3]).toMatchObject({ type: 'say', speaker: 'ada', lineKey: 'line_01' });

    const ifNode = ast[4];
    expect(ifNode?.type).toBe('if');
    if (ifNode?.type === 'if') {
      expect(ifNode.flag).toBe('fell_downstairs');
      expect(ifNode.operator).toBe('==');
      expect(ifNode.value).toBe(true);
      expect(ifNode.thenBranch).toHaveLength(2);
      expect(ifNode.elseBranch).toHaveLength(1);
    }

    expect(ast[5]).toMatchObject({ type: 'portrait', slot: 'right', character: null, pose: null });
    expect(ast[6]).toMatchObject({ type: 'wait', seconds: 0.4 });
    expect(ast[7]).toMatchObject({
      type: 'transition',
      environmentId: 'classroom',
      spawnId: 'spawn_door',
      facing: 'left',
    });
  });

  it('throws line-numbered ScriptParseError on unclosed @if, stray @else, or unknown directives', () => {
    expect(() => parseDialogueScript('@if a == true\nsay chloe x')).toThrow(ScriptParseError);
    expect(() => parseDialogueScript('@else\nsay chloe x')).toThrow(/Line 1/);
    expect(() => parseDialogueScript('@unknown_cmd foo')).toThrow(/Unknown dialogue directive/);
    expect(() => parseDialogueScript('@portrait top chloe idle')).toThrow(/Invalid portrait slot/);
  });
});
