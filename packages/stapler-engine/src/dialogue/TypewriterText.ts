export type InlineTextToken =
  | { type: 'text'; value: string }
  | { type: 'click_pause' }
  | { type: 'wait'; seconds: number };

export type TypewriterAdvanceResult = 'revealed_segment' | 'resumed_pause' | 'advance_line';

const TAG_REGEX = /\{(p|w(?:=\d+(?:\.\d+)?)?)\}/g;

/**
 * Parses localized dialogue text containing lightweight inline pacing tags:
 * - `{p}`: pauses typewriting mid-line until the player clicks or presses Space/Enter.
 * - `{w}` or `{w=0.5}`: timed beat pause (default `0.35s`) that resumes automatically.
 * Unknown brace patterns are preserved verbatim as text.
 */
export function parseInlineDialogueText(raw: string): InlineTextToken[] {
  const tokens: InlineTextToken[] = [];
  let lastIndex = 0;

  TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = TAG_REGEX.exec(raw);
  while (match !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: raw.slice(lastIndex, match.index) });
    }
    const tag = match[1]!;
    if (tag === 'p') {
      tokens.push({ type: 'click_pause' });
    } else if (tag === 'w') {
      tokens.push({ type: 'wait', seconds: 0.35 });
    } else if (tag.startsWith('w=')) {
      const sec = Number(tag.slice(2));
      if (Number.isFinite(sec) && sec > 0) {
        tokens.push({ type: 'wait', seconds: sec });
      }
    }
    lastIndex = match.index + match[0].length;
    match = TAG_REGEX.exec(raw);
  }

  if (lastIndex < raw.length) {
    tokens.push({ type: 'text', value: raw.slice(lastIndex) });
  }

  return tokens;
}

/** Strips inline `{p}` and `{w=...}` tags, returning the full plain text. */
export function stripInlineDialogueTags(raw: string): string {
  return parseInlineDialogueText(raw)
    .filter((t): t is Extract<InlineTextToken, { type: 'text' }> => t.type === 'text')
    .map((t) => t.value)
    .join('');
}

/**
 * Pure, deterministic typewriter state machine driven by explicit `dt`.
 * Supports `{p}` click-to-continue pauses mid-sentence, `{w=sec}` timed beats,
 * and `appendText()` for continuing in the same dialogue box.
 */
export class TypewriterController {
  private readonly charsPerSecond: number;

  private tokens: InlineTextToken[] = [];
  private tokenIndex = 0;
  private charProgress = 0;
  private visibleText = '';
  private waitRemaining = 0;
  private pausedForClick = false;
  private complete = true;

  constructor(charsPerSecond = 52) {
    this.charsPerSecond = Math.max(1, charsPerSecond);
  }

  setText(raw: string): void {
    this.tokens = parseInlineDialogueText(raw);
    this.tokenIndex = 0;
    this.charProgress = 0;
    this.visibleText = '';
    this.waitRemaining = 0;
    this.pausedForClick = false;
    this.complete = this.tokens.length === 0;
    this.processImmediateControlTokens();
  }

  /** Appends additional localized text to the existing box without clearing prior text. */
  appendText(raw: string, separator = ' '): void {
    // Ensure any previous unrevealed text is flushed first
    this.revealAll();
    const prefix = this.visibleText.length > 0 && raw.length > 0 ? separator : '';
    const extraTokens = parseInlineDialogueText(prefix + raw);
    if (extraTokens.length === 0) return;

    this.tokens = extraTokens;
    this.tokenIndex = 0;
    this.charProgress = 0;
    this.waitRemaining = 0;
    this.pausedForClick = false;
    this.complete = false;
    this.processImmediateControlTokens();
  }

  getVisibleText(): string {
    return this.visibleText;
  }

  isPausedForClick(): boolean {
    return this.pausedForClick;
  }

  isComplete(): boolean {
    return this.complete;
  }

  /** True when the player should see the continue prompt (at a `{p}` pause or end of line). */
  isWaitingForInput(): boolean {
    return this.pausedForClick || this.complete;
  }

  update(dt: number): void {
    if (this.complete || this.pausedForClick || dt <= 0) return;

    let remainingDt = dt;

    while (remainingDt > 1e-6 && !this.complete && !this.pausedForClick) {
      if (this.waitRemaining > 0) {
        if (this.waitRemaining - remainingDt > 1e-6) {
          this.waitRemaining -= remainingDt;
          return;
        }
        remainingDt -= this.waitRemaining;
        this.waitRemaining = 0;
        this.tokenIndex += 1;
        this.processImmediateControlTokens();
        continue;
      }

      const token = this.tokens[this.tokenIndex];
      if (!token) {
        this.complete = true;
        return;
      }

      if (token.type === 'text') {
        const prevCount = Math.floor(this.charProgress);
        const charsLeft = token.value.length - prevCount;
        const timeNeeded = charsLeft / this.charsPerSecond;

        if (remainingDt < timeNeeded) {
          this.charProgress += remainingDt * this.charsPerSecond;
          const nextCount = Math.min(token.value.length, Math.floor(this.charProgress));
          if (nextCount > prevCount) {
            this.visibleText += token.value.slice(prevCount, nextCount);
          }
          return;
        }

        // Finish this text token and carry remaining dt into the next token
        this.visibleText += token.value.slice(prevCount);
        remainingDt -= timeNeeded;
        this.tokenIndex += 1;
        this.charProgress = 0;
        this.processImmediateControlTokens();
      } else {
        this.processImmediateControlTokens();
      }
    }
  }

  /**
   * Handles Click / Space / Enter input:
   * - While typing or in a `{w}` beat: reveals cleanly up to the next `{p}` pause (or end).
   * - While stopped at `{p}`: resumes typing the next segment.
   * - Once the full line is complete: returns `'advance_line'` so the runner advances.
   */
  handleAdvance(): TypewriterAdvanceResult {
    if (this.complete) {
      return 'advance_line';
    }

    if (this.pausedForClick) {
      this.pausedForClick = false;
      this.tokenIndex += 1;
      this.processImmediateControlTokens();
      return 'resumed_pause';
    }

    // Fast-forward through text and timed waits until the next click pause or end
    this.waitRemaining = 0;
    while (this.tokenIndex < this.tokens.length) {
      const token = this.tokens[this.tokenIndex]!;
      if (token.type === 'click_pause') {
        this.pausedForClick = true;
        return 'revealed_segment';
      }
      if (token.type === 'text') {
        const revealed = Math.floor(this.charProgress);
        this.visibleText += token.value.slice(revealed);
        this.charProgress = 0;
      }
      this.tokenIndex += 1;
    }

    this.complete = true;
    return 'revealed_segment';
  }

  /** Reveals all remaining text immediately (stripping all pauses/waits), e.g. on locale switch. */
  revealAll(): void {
    this.waitRemaining = 0;
    this.pausedForClick = false;
    while (this.tokenIndex < this.tokens.length) {
      const token = this.tokens[this.tokenIndex]!;
      if (token.type === 'text') {
        const revealed = Math.floor(this.charProgress);
        this.visibleText += token.value.slice(revealed);
        this.charProgress = 0;
      }
      this.tokenIndex += 1;
    }
    this.complete = true;
  }

  private processImmediateControlTokens(): void {
    while (this.tokenIndex < this.tokens.length) {
      const token = this.tokens[this.tokenIndex]!;
      if (token.type === 'text') {
        if (token.value.length === 0) {
          this.tokenIndex += 1;
          continue;
        }
        return;
      }
      if (token.type === 'click_pause') {
        this.pausedForClick = true;
        return;
      }
      if (token.type === 'wait') {
        this.waitRemaining = token.seconds;
        return;
      }
    }
    this.complete = true;
  }
}
