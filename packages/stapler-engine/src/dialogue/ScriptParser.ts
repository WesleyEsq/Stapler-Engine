import type { CgTransitionKind, FacingDirection, FlagValue, PortraitSlot } from '../types/contracts';

export type DialogueStatement =
  | {
      type: 'portrait';
      slot: PortraitSlot;
      character: string | null;
      pose: string | null;
      facing?: 'left' | 'right';
      line: number;
    }
  | {
      type: 'cg';
      cgId: string | null;
      transition: CgTransitionKind;
      line: number;
    }
  | {
      type: 'bgm';
      trackId: string | null;
      fadeSec?: number;
      line: number;
    }
  | { type: 'box'; style: string; line: number }
  | { type: 'sfx'; soundId: string; line: number }
  | { type: 'voice'; voiceId: string; line: number }
  | { type: 'say'; speaker: string; lineKey: string; append?: boolean; line: number }
  | { type: 'set'; flag: string; value: FlagValue; line: number }
  | {
      type: 'if';
      flag: string;
      operator: '==' | '!=';
      value: FlagValue;
      thenBranch: DialogueStatement[];
      elseBranch: DialogueStatement[];
      line: number;
    }
  | {
      type: 'transition';
      environmentId: string;
      spawnId?: string;
      facing?: FacingDirection;
      line: number;
    }
  | { type: 'wait'; seconds: number; line: number }
  | { type: 'end'; line: number };

export interface ExtractedScriptAssets {
  portraits: Array<{ character: string; pose: string }>;
  cgIds: string[];
  bgmIds: string[];
  transitions: Array<{ environmentId: string; spawnId?: string }>;
}

export class ScriptParseError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(`Line ${line}: ${message}`);
    this.name = 'ScriptParseError';
    this.line = line;
  }
}

interface IfFrame {
  statement: Extract<DialogueStatement, { type: 'if' }>;
  inElse: boolean;
}

/**
 * Pure parser for Stapler `.dlg` visual novel scripts.
 * Supported syntax:
 *   # comment
 *   @portrait <left|center|right> <character> <pose>
 *   @portrait <left|center|right> clear
 *   @sfx <soundId>
 *   @voice <voiceId>
 *   say <speaker> <lineKey>
 *   @set <flag> <value>
 *   @if <flag> == <value> / @if <flag> != <value> ... [@else ...] @endif
 *   @transition <environmentId> <spawnId> [facing]
 *   @wait <seconds>
 *   @end
 */
export function parseDialogueScript(source: string): DialogueStatement[] {
  const root: DialogueStatement[] = [];
  const stack: IfFrame[] = [];

  const append = (stmt: DialogueStatement): void => {
    const top = stack[stack.length - 1];
    if (!top) {
      root.push(stmt);
    } else if (top.inElse) {
      top.statement.elseBranch.push(stmt);
    } else {
      top.statement.thenBranch.push(stmt);
    }
  };

  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const lineNum = i + 1;
    const trimmed = stripInlineComment(lines[i] ?? '').trim();
    if (!trimmed) continue;

    const tokens = tokenizeLine(trimmed);
    const head = tokens[0];
    if (!head) continue;

    if (head === 'say' || head === 'append') {
      const speaker = tokens[1];
      const lineKey = tokens[2];
      if (!speaker || !lineKey || tokens.length !== 3) {
        throw new ScriptParseError(
          lineNum,
          `Expected "${head} <speaker> <lineKey>" (got "${trimmed}").`,
        );
      }
      append({
        type: 'say',
        speaker,
        lineKey,
        ...(head === 'append' ? { append: true } : {}),
        line: lineNum,
      });
      continue;
    }

    switch (head) {
      case '@portrait': {
        const slotRaw = tokens[1];
        if (slotRaw !== 'left' && slotRaw !== 'center' && slotRaw !== 'right') {
          throw new ScriptParseError(
            lineNum,
            `Invalid portrait slot "${slotRaw ?? ''}"; expected left, center, or right.`,
          );
        }
        const arg2 = tokens[2];
        if (!arg2) {
          throw new ScriptParseError(lineNum, 'Missing character or "clear" in @portrait.');
        }
        if ((arg2 === 'clear' || arg2 === 'none') && tokens.length === 3) {
          append({ type: 'portrait', slot: slotRaw, character: null, pose: null, line: lineNum });
        } else {
          const pose = tokens[3];
          const facingRaw = tokens[4];
          if (!pose || tokens.length < 4 || tokens.length > 5) {
            throw new ScriptParseError(
              lineNum,
              'Expected "@portrait <slot> <character> <pose> [left|right]" or "@portrait <slot> clear".',
            );
          }
          let facing: 'left' | 'right' | undefined;
          if (facingRaw !== undefined) {
            if (facingRaw !== 'left' && facingRaw !== 'right') {
              throw new ScriptParseError(
                lineNum,
                `Invalid portrait facing "${facingRaw}"; expected left or right.`,
              );
            }
            facing = facingRaw;
          }
          append({ type: 'portrait', slot: slotRaw, character: arg2, pose, facing, line: lineNum });
        }
        break;
      }

      case '@cg': {
        const arg1 = tokens[1];
        const transitionRaw = tokens[2];
        if (!arg1 || tokens.length > 3) {
          throw new ScriptParseError(
            lineNum,
            'Expected "@cg <cgId> [fade|cut]" or "@cg clear [fade|cut]".',
          );
        }
        let transition: CgTransitionKind = 'fade';
        if (transitionRaw !== undefined) {
          if (transitionRaw !== 'fade' && transitionRaw !== 'cut') {
            throw new ScriptParseError(
              lineNum,
              `Invalid @cg transition "${transitionRaw}"; expected fade or cut.`,
            );
          }
          transition = transitionRaw;
        }
        const cgId = arg1 === 'clear' || arg1 === 'none' ? null : arg1;
        append({ type: 'cg', cgId, transition, line: lineNum });
        break;
      }

      case '@bgm': {
        const arg1 = tokens[1];
        const fadeRaw = tokens[2];
        if (!arg1 || tokens.length > 3) {
          throw new ScriptParseError(
            lineNum,
            'Expected "@bgm <trackId> [fadeSec]" or "@bgm stop".',
          );
        }
        if (arg1 === 'stop' || arg1 === 'clear' || arg1 === 'none') {
          if (tokens.length !== 2) {
            throw new ScriptParseError(lineNum, 'Expected "@bgm stop".');
          }
          append({ type: 'bgm', trackId: null, line: lineNum });
          break;
        }
        let fadeSec: number | undefined;
        if (fadeRaw !== undefined) {
          const parsed = Number(fadeRaw);
          if (!Number.isFinite(parsed) || parsed < 0) {
            throw new ScriptParseError(lineNum, `Invalid @bgm fade duration "${fadeRaw}".`);
          }
          fadeSec = parsed;
        }
        append({ type: 'bgm', trackId: arg1, fadeSec, line: lineNum });
        break;
      }

      case '@box': {
        const style = tokens[1];
        if (!style || tokens.length !== 2) {
          throw new ScriptParseError(lineNum, 'Expected "@box <styleName>" (e.g. default, thought, system).');
        }
        append({ type: 'box', style, line: lineNum });
        break;
      }

      case '@sfx': {
        const soundId = tokens[1];
        if (!soundId || tokens.length !== 2) {
          throw new ScriptParseError(lineNum, 'Expected "@sfx <soundId>".');
        }
        append({ type: 'sfx', soundId, line: lineNum });
        break;
      }

      case '@voice': {
        const voiceId = tokens[1];
        if (!voiceId || tokens.length !== 2) {
          throw new ScriptParseError(lineNum, 'Expected "@voice <voiceId>".');
        }
        append({ type: 'voice', voiceId, line: lineNum });
        break;
      }

      case '@set': {
        const flag = tokens[1];
        const rawVal = tokens[2];
        if (!flag || rawVal === undefined || tokens.length !== 3) {
          throw new ScriptParseError(lineNum, 'Expected "@set <flag> <value>".');
        }
        append({ type: 'set', flag, value: parseLiteral(rawVal), line: lineNum });
        break;
      }

      case '@if': {
        const flag = tokens[1];
        const op = tokens[2];
        const rawVal = tokens[3];
        if (!flag || (op !== '==' && op !== '!=') || rawVal === undefined || tokens.length !== 4) {
          throw new ScriptParseError(lineNum, 'Expected "@if <flag> == <value>" or "@if <flag> != <value>".');
        }
        const stmt: Extract<DialogueStatement, { type: 'if' }> = {
          type: 'if',
          flag,
          operator: op,
          value: parseLiteral(rawVal),
          thenBranch: [],
          elseBranch: [],
          line: lineNum,
        };
        append(stmt);
        stack.push({ statement: stmt, inElse: false });
        break;
      }

      case '@else': {
        const top = stack[stack.length - 1];
        if (!top) {
          throw new ScriptParseError(lineNum, 'Unexpected @else without matching @if.');
        }
        if (top.inElse) {
          throw new ScriptParseError(lineNum, 'Duplicate @else inside the same @if block.');
        }
        top.inElse = true;
        break;
      }

      case '@endif': {
        if (stack.length === 0) {
          throw new ScriptParseError(lineNum, 'Unexpected @endif without matching @if.');
        }
        stack.pop();
        break;
      }

      case '@transition': {
        const environmentId = tokens[1];
        const spawnId = tokens[2];
        const facingRaw = tokens[3];
        if (!environmentId || tokens.length > 4) {
          throw new ScriptParseError(
            lineNum,
            'Expected "@transition <environmentId> [spawnId] [facing]".',
          );
        }
        let facing: FacingDirection | undefined;
        if (facingRaw !== undefined) {
          if (
            facingRaw !== 'front' &&
            facingRaw !== 'back' &&
            facingRaw !== 'left' &&
            facingRaw !== 'right'
          ) {
            throw new ScriptParseError(lineNum, `Invalid transition facing "${facingRaw}".`);
          }
          facing = facingRaw;
        }
        append({ type: 'transition', environmentId, spawnId, facing, line: lineNum });
        break;
      }

      case '@wait': {
        const rawSec = tokens[1];
        const sec = rawSec !== undefined ? Number(rawSec) : NaN;
        if (!Number.isFinite(sec) || sec < 0 || tokens.length !== 2) {
          throw new ScriptParseError(lineNum, 'Expected "@wait <non-negative seconds>".');
        }
        append({ type: 'wait', seconds: sec, line: lineNum });
        break;
      }

      case '@end': {
        append({ type: 'end', line: lineNum });
        break;
      }

      default:
        throw new ScriptParseError(lineNum, `Unknown dialogue directive "${head}".`);
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1]!;
    throw new ScriptParseError(unclosed.statement.line, 'Unclosed @if block (missing @endif).');
  }

  return root;
}

/**
 * Recursively collects unique portraits, CG IDs, BGM track IDs, and transition
 * targets referenced anywhere in a parsed `.dlg` AST (including inside `@if`/`@else`
 * branches) for runtime preloading and automated content-integrity validation.
 */
export function extractScriptAssets(statements: readonly DialogueStatement[]): ExtractedScriptAssets {
  const portraitSeen = new Set<string>();
  const portraits: Array<{ character: string; pose: string }> = [];
  const cgSet = new Set<string>();
  const bgmSet = new Set<string>();
  const transitions: Array<{ environmentId: string; spawnId?: string }> = [];

  const visit = (list: readonly DialogueStatement[]): void => {
    for (const stmt of list) {
      switch (stmt.type) {
        case 'portrait': {
          if (stmt.character !== null && stmt.pose !== null) {
            const key = `${stmt.character}::${stmt.pose}`;
            if (!portraitSeen.has(key)) {
              portraitSeen.add(key);
              portraits.push({ character: stmt.character, pose: stmt.pose });
            }
          }
          break;
        }
        case 'cg': {
          if (stmt.cgId !== null) {
            cgSet.add(stmt.cgId);
          }
          break;
        }
        case 'bgm': {
          if (stmt.trackId !== null) {
            bgmSet.add(stmt.trackId);
          }
          break;
        }
        case 'transition': {
          transitions.push({ environmentId: stmt.environmentId, spawnId: stmt.spawnId });
          break;
        }
        case 'if': {
          visit(stmt.thenBranch);
          visit(stmt.elseBranch);
          break;
        }
      }
    }
  };

  visit(statements);
  return {
    portraits,
    cgIds: Array.from(cgSet),
    bgmIds: Array.from(bgmSet),
    transitions,
  };
}

function stripInlineComment(line: string): string {
  let inQuotes = false;
  let quoteChar = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === quoteChar) inQuotes = false;
    } else if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function tokenizeLine(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function parseLiteral(raw: string): FlagValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}
