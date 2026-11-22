import type { FacingDirection, PortraitSlot } from '../types/contracts';
import type { GameState } from '../core/GameState';
import type { DialogueStatement } from './ScriptParser';

export interface ActivePortrait {
  character: string;
  pose: string;
}

export interface ActiveDialogueLine {
  speaker: string;
  lineKey: string;
}

export interface DialogueTransitionRequest {
  environmentId: string;
  spawnId: string;
  facing?: FacingDirection;
}

export interface DialogueStateSnapshot {
  active: boolean;
  waiting: boolean;
  currentLine: ActiveDialogueLine | null;
  portraits: Partial<Record<PortraitSlot, ActivePortrait>>;
}

export interface DialogueRunnerCallbacks {
  onStateChanged?: (snapshot: DialogueStateSnapshot) => void;
  onSfx?: (soundId: string) => void;
  onVoice?: (voiceId: string) => void;
  onComplete?: (result: { transition?: DialogueTransitionRequest }) => void;
}

interface ExecutionFrame {
  statements: readonly DialogueStatement[];
  index: number;
}

/**
 * Pure state machine that executes a parsed `.dlg` AST against `GameState`.
 * Evaluates `@if`/`@else`, `@set`, `@portrait`, `@sfx`, `@voice`, pauses on
 * `say` lines and `@wait` timers, and reports `@transition` on completion.
 */
export class DialogueRunner {
  private readonly gameState: GameState;
  private readonly callbacks: DialogueRunnerCallbacks;

  private frames: ExecutionFrame[] = [];
  private active = false;
  private waitRemaining = 0;
  private currentLine: ActiveDialogueLine | null = null;
  private portraits: Partial<Record<PortraitSlot, ActivePortrait>> = {};
  private pendingTransition: DialogueTransitionRequest | undefined;

  constructor(gameState: GameState, callbacks: DialogueRunnerCallbacks = {}) {
    this.gameState = gameState;
    this.callbacks = callbacks;
  }

  isActive(): boolean {
    return this.active;
  }

  getSnapshot(): DialogueStateSnapshot {
    return {
      active: this.active,
      waiting: this.waitRemaining > 0,
      currentLine: this.currentLine ? { ...this.currentLine } : null,
      portraits: {
        ...(this.portraits.left ? { left: { ...this.portraits.left } } : {}),
        ...(this.portraits.center ? { center: { ...this.portraits.center } } : {}),
        ...(this.portraits.right ? { right: { ...this.portraits.right } } : {}),
      },
    };
  }

  start(statements: readonly DialogueStatement[]): void {
    this.frames = [{ statements, index: 0 }];
    this.active = true;
    this.waitRemaining = 0;
    this.currentLine = null;
    this.portraits = {};
    this.pendingTransition = undefined;
    this.stepUntilPause();
  }

  /** Advances past the currently displayed `say` line. Ignored during `@wait` or when inactive. */
  advance(): void {
    if (!this.active || this.waitRemaining > 0) return;
    this.currentLine = null;
    this.stepUntilPause();
  }

  /** Deterministically advances active `@wait` timers using explicit `dt`. */
  update(dt: number): void {
    if (!this.active || this.waitRemaining <= 0) return;
    this.waitRemaining = Math.max(0, this.waitRemaining - Math.max(0, dt));
    if (this.waitRemaining <= 1e-6) {
      this.waitRemaining = 0;
      this.stepUntilPause();
    }
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.frames = [];
    this.waitRemaining = 0;
    this.currentLine = null;
    this.portraits = {};
    this.pendingTransition = undefined;
    this.callbacks.onStateChanged?.(this.getSnapshot());
  }

  private stepUntilPause(): void {
    while (this.frames.length > 0) {
      const top = this.frames[this.frames.length - 1]!;
      if (top.index >= top.statements.length) {
        this.frames.pop();
        continue;
      }

      const stmt = top.statements[top.index]!;
      top.index += 1;

      switch (stmt.type) {
        case 'portrait': {
          if (stmt.character === null || stmt.pose === null) {
            delete this.portraits[stmt.slot];
          } else {
            this.portraits[stmt.slot] = { character: stmt.character, pose: stmt.pose };
          }
          break;
        }
        case 'sfx': {
          this.callbacks.onSfx?.(stmt.soundId);
          break;
        }
        case 'voice': {
          this.callbacks.onVoice?.(stmt.voiceId);
          break;
        }
        case 'set': {
          this.gameState.setFlag(stmt.flag, stmt.value);
          break;
        }
        case 'if': {
          const currentVal = this.gameState.getFlag(stmt.flag);
          const matches =
            stmt.operator === '==' ? currentVal === stmt.value : currentVal !== stmt.value;
          const branch = matches ? stmt.thenBranch : stmt.elseBranch;
          if (branch.length > 0) {
            this.frames.push({ statements: branch, index: 0 });
          }
          break;
        }
        case 'say': {
          this.currentLine = { speaker: stmt.speaker, lineKey: stmt.lineKey };
          this.callbacks.onStateChanged?.(this.getSnapshot());
          return;
        }
        case 'wait': {
          if (stmt.seconds > 0) {
            this.waitRemaining = stmt.seconds;
            this.callbacks.onStateChanged?.(this.getSnapshot());
            return;
          }
          break;
        }
        case 'transition': {
          this.pendingTransition = {
            environmentId: stmt.environmentId,
            spawnId: stmt.spawnId,
            facing: stmt.facing,
          };
          this.finish();
          return;
        }
        case 'end': {
          this.finish();
          return;
        }
      }
    }

    this.finish();
  }

  private finish(): void {
    const transition = this.pendingTransition;
    this.active = false;
    this.frames = [];
    this.waitRemaining = 0;
    this.currentLine = null;
    this.portraits = {};
    this.pendingTransition = undefined;
    this.callbacks.onStateChanged?.(this.getSnapshot());
    this.callbacks.onComplete?.({ transition });
  }
}
