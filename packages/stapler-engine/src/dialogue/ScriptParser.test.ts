import { describe, expect, it } from 'vitest';
import { ScriptParseError, extractScriptAssets, parseDialogueScript } from './ScriptParser';

describe('ScriptParser', () => {
  it('parses portraits, @cg, @bgm, sfx, say, nested @if/@else, @set, @wait, and @transition cleanly', () => {
    const src = `
      # Intro conversation
      @bgm morning_chill 0.8
      @cg bus_stop fade
      @sfx ui_open
      @box system
      @portrait left chloe sleepy
      @portrait right ada inquiry left
      say _ narrator_line_01
      say ada line_01
      append ada line_01_b

      @if fell_downstairs == true
        @cg desk_reveal cut
        say chloe line_secret
        @set confessed true
      @else
        say chloe line_normal
      @endif

      @cg clear fade
      @bgm stop
      @portrait right clear
      @wait 0.4
      @transition classroom spawn_door left
      @end
    `;

    const ast = parseDialogueScript(src);
    expect(ast).toHaveLength(16);
    expect(ast[0]).toMatchObject({ type: 'bgm', trackId: 'morning_chill', fadeSec: 0.8 });
    expect(ast[1]).toMatchObject({ type: 'cg', cgId: 'bus_stop', transition: 'fade' });
    expect(ast[2]).toMatchObject({ type: 'sfx', soundId: 'ui_open' });
    expect(ast[3]).toMatchObject({ type: 'box', style: 'system' });
    expect(ast[4]).toMatchObject({ type: 'portrait', slot: 'left', character: 'chloe', pose: 'sleepy' });
    expect(ast[6]).toMatchObject({ type: 'say', speaker: '_', lineKey: 'narrator_line_01' });
    expect(ast[7]).toMatchObject({ type: 'say', speaker: 'ada', lineKey: 'line_01' });
    expect(ast[8]).toMatchObject({ type: 'say', speaker: 'ada', lineKey: 'line_01_b', append: true });

    const ifNode = ast[9];
    expect(ifNode?.type).toBe('if');
    if (ifNode?.type === 'if') {
      expect(ifNode.flag).toBe('fell_downstairs');
      expect(ifNode.operator).toBe('==');
      expect(ifNode.value).toBe(true);
      expect(ifNode.thenBranch).toHaveLength(3);
      expect(ifNode.thenBranch[0]).toMatchObject({ type: 'cg', cgId: 'desk_reveal', transition: 'cut' });
      expect(ifNode.elseBranch).toHaveLength(1);
    }

    expect(ast[10]).toMatchObject({ type: 'cg', cgId: null, transition: 'fade' });
    expect(ast[11]).toMatchObject({ type: 'bgm', trackId: null });
    expect(ast[12]).toMatchObject({ type: 'portrait', slot: 'right', character: null, pose: null });
    expect(ast[13]).toMatchObject({ type: 'wait', seconds: 0.4 });
    expect(ast[14]).toMatchObject({
      type: 'transition',
      environmentId: 'classroom',
      spawnId: 'spawn_door',
      facing: 'left',
    });

    const extracted = extractScriptAssets(ast);
    expect(extracted.cgIds).toEqual(['bus_stop', 'desk_reveal']);
    expect(extracted.bgmIds).toEqual(['morning_chill']);
    expect(extracted.portraits).toEqual([
      { character: 'chloe', pose: 'sleepy' },
      { character: 'ada', pose: 'inquiry' },
    ]);
    expect(extracted.transitions).toEqual([{ environmentId: 'classroom', spawnId: 'spawn_door' }]);
  });

  it('supports VN-scene @transition without a spawnId', () => {
    const ast = parseDialogueScript('@transition vn_bus_stop_intro\n@end');
    expect(ast[0]).toMatchObject({ type: 'transition', environmentId: 'vn_bus_stop_intro', spawnId: undefined });
  });

  it('throws line-numbered ScriptParseError on unclosed @if, stray @else, or invalid directives', () => {
    expect(() => parseDialogueScript('@if a == true\nsay chloe x')).toThrow(ScriptParseError);
    expect(() => parseDialogueScript('@else\nsay chloe x')).toThrow(/Line 1/);
    expect(() => parseDialogueScript('@unknown_cmd foo')).toThrow(/Unknown dialogue directive/);
    expect(() => parseDialogueScript('@portrait top chloe idle')).toThrow(/Invalid portrait slot/);
    expect(() => parseDialogueScript('@cg bus_stop wipe')).toThrow(/Invalid @cg transition/);
    expect(() => parseDialogueScript('@bgm theme -1')).toThrow(/Invalid @bgm fade duration/);
  });
});
