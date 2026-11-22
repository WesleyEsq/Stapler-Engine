import type { PortraitSlot } from '../types/contracts';
import type { DialogueStateSnapshot } from '../dialogue/DialogueRunner';
import type { I18nStore } from '../dialogue/I18nStore';

export interface DialogueViewOptions {
  parent: HTMLElement;
  i18n: I18nStore;
  portraits?: Record<string, Record<string, string>>;
  charsPerSecond?: number;
  onAdvanceRequested?: () => void;
}

/**
 * Responsive HTML/CSS visual novel dialogue overlay supporting Left/Center/Right
 * character portraits, localized speaker tags, and typewriter text reveal.
 */
export class DialogueView {
  readonly element: HTMLDivElement;

  private readonly i18n: I18nStore;
  private readonly portraitsMap: Record<string, Record<string, string>>;
  private readonly charsPerSecond: number;
  private readonly onAdvanceRequested?: () => void;

  private readonly portraitEls: Record<PortraitSlot, HTMLImageElement>;
  private readonly speakerEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly nextHintEl: HTMLDivElement;

  private lastSnapshot: DialogueStateSnapshot | null = null;
  private fullText = '';
  private revealedChars = 0;

  constructor(options: DialogueViewOptions) {
    this.i18n = options.i18n;
    this.portraitsMap = options.portraits ?? {};
    this.charsPerSecond = options.charsPerSecond ?? 52;
    this.onAdvanceRequested = options.onAdvanceRequested;

    this.element = document.createElement('div');
    this.element.className = 'stapler-dialogue-layer';
    this.element.hidden = true;

    const stage = document.createElement('div');
    stage.className = 'stapler-portrait-stage';

    const makePortrait = (slot: PortraitSlot): HTMLImageElement => {
      const img = document.createElement('img');
      img.className = `stapler-portrait stapler-portrait-${slot}`;
      img.alt = '';
      img.hidden = true;
      stage.appendChild(img);
      return img;
    };

    this.portraitEls = {
      left: makePortrait('left'),
      center: makePortrait('center'),
      right: makePortrait('right'),
    };

    const box = document.createElement('div');
    box.className = 'stapler-dialogue-box';

    this.speakerEl = document.createElement('div');
    this.speakerEl.className = 'stapler-dialogue-speaker';

    this.textEl = document.createElement('div');
    this.textEl.className = 'stapler-dialogue-text';

    this.nextHintEl = document.createElement('div');
    this.nextHintEl.className = 'stapler-dialogue-hint';

    box.append(this.speakerEl, this.textEl, this.nextHintEl);
    this.element.append(stage, box);
    options.parent.appendChild(this.element);

    this.element.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      this.handleAdvanceInput();
    });
  }

  render(snapshot: DialogueStateSnapshot): void {
    this.lastSnapshot = snapshot;
    if (!snapshot.active) {
      this.element.hidden = true;
      this.fullText = '';
      this.revealedChars = 0;
      return;
    }

    this.element.hidden = false;
    this.updatePortraits(snapshot);

    if (snapshot.currentLine) {
      this.speakerEl.textContent = this.i18n.getSpeaker(snapshot.currentLine.speaker);
      this.fullText = this.i18n.getLine(snapshot.currentLine.lineKey);
      this.revealedChars = 0;
      this.textEl.textContent = '';
      this.nextHintEl.textContent = this.i18n.getUi('dialogue_next', 'Click / Space ▸');
      this.nextHintEl.style.opacity = '0.35';
    } else if (snapshot.waiting) {
      this.nextHintEl.style.opacity = '0';
    }
  }

  /** Re-resolves speaker and text immediately when the user switches language. */
  refreshLocale(): void {
    if (!this.lastSnapshot || !this.lastSnapshot.active || !this.lastSnapshot.currentLine) return;
    this.speakerEl.textContent = this.i18n.getSpeaker(this.lastSnapshot.currentLine.speaker);
    this.fullText = this.i18n.getLine(this.lastSnapshot.currentLine.lineKey);
    this.revealedChars = this.fullText.length;
    this.textEl.textContent = this.fullText;
    this.nextHintEl.textContent = this.i18n.getUi('dialogue_next', 'Click / Space ▸');
    this.nextHintEl.style.opacity = '1';
  }

  update(dt: number): void {
    if (this.element.hidden || this.revealedChars >= this.fullText.length) return;
    this.revealedChars = Math.min(this.fullText.length, this.revealedChars + this.charsPerSecond * dt);
    this.textEl.textContent = this.fullText.slice(0, Math.floor(this.revealedChars));
    if (this.revealedChars >= this.fullText.length) {
      this.nextHintEl.style.opacity = '1';
    }
  }

  /** First press finishes the typewriter reveal; second press advances to the next line. */
  handleAdvanceInput(): void {
    if (this.element.hidden) return;
    if (this.revealedChars < this.fullText.length) {
      this.revealedChars = this.fullText.length;
      this.textEl.textContent = this.fullText;
      this.nextHintEl.style.opacity = '1';
      return;
    }
    this.onAdvanceRequested?.();
  }

  private updatePortraits(snapshot: DialogueStateSnapshot): void {
    const slots: PortraitSlot[] = ['left', 'center', 'right'];
    for (const slot of slots) {
      const img = this.portraitEls[slot];
      const active = snapshot.portraits[slot];
      if (!active) {
        img.hidden = true;
        continue;
      }
      const url =
        this.portraitsMap[active.character]?.[active.pose] ??
        this.portraitsMap[active.character]?.default;
      if (url) {
        img.src = url;
        img.alt = `${active.character} (${active.pose})`;
        img.hidden = false;
        const speaking = snapshot.currentLine?.speaker === active.character;
        img.classList.toggle('is-speaking', Boolean(speaking));
      } else {
        img.hidden = true;
      }
    }
  }
}
