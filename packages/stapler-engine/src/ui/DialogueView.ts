import type { PortraitSlot } from '../types/contracts';
import type { DialogueStateSnapshot } from '../dialogue/DialogueRunner';
import type { I18nStore } from '../dialogue/I18nStore';
import { TypewriterController, stripInlineDialogueTags } from '../dialogue/TypewriterText';

export interface DialogueViewOptions {
  parent: HTMLElement;
  i18n: I18nStore;
  portraits?: Record<string, Record<string, string>>;
  portraitDefaultFacing?: 'left' | 'right';
  charsPerSecond?: number;
  onAdvanceRequested?: () => void;
}

interface PortraitSlotNodes {
  wrapper: HTMLDivElement;
  img: HTMLImageElement;
}

/**
 * Responsive HTML/CSS visual novel dialogue overlay supporting Left/Center/Right
 * character portraits tucked into the dialogue card, directional portrait facing,
 * active/inactive speaker shading, localized speaker tags, and inline `{p}`/`{w}`
 * typewriter pacing.
 */
export class DialogueView {
  readonly element: HTMLDivElement;

  private readonly i18n: I18nStore;
  private readonly portraitsMap: Record<string, Record<string, string>>;
  private readonly defaultArtFacing: 'left' | 'right';
  private readonly typewriter: TypewriterController;
  private readonly onAdvanceRequested?: () => void;

  private readonly portraitSlots: Record<PortraitSlot, PortraitSlotNodes>;
  private readonly boxEl: HTMLDivElement;
  private readonly speakerEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly nextHintEl: HTMLDivElement;

  private lastSnapshot: DialogueStateSnapshot | null = null;
  private renderedLineKeys: string[] = [];

  constructor(options: DialogueViewOptions) {
    this.i18n = options.i18n;
    this.portraitsMap = options.portraits ?? {};
    this.defaultArtFacing = options.portraitDefaultFacing ?? 'right';
    this.typewriter = new TypewriterController(options.charsPerSecond ?? 52);
    this.onAdvanceRequested = options.onAdvanceRequested;

    this.element = document.createElement('div');
    this.element.className = 'stapler-dialogue-layer';
    this.element.hidden = true;

    const stage = document.createElement('div');
    stage.className = 'stapler-portrait-stage';

    const makePortraitSlot = (slot: PortraitSlot): PortraitSlotNodes => {
      const wrapper = document.createElement('div');
      wrapper.className = `stapler-portrait-slot stapler-portrait-slot-${slot}`;
      wrapper.hidden = true;

      const img = document.createElement('img');
      img.className = 'stapler-portrait-img';
      img.alt = '';
      wrapper.appendChild(img);
      stage.appendChild(wrapper);
      return { wrapper, img };
    };

    this.portraitSlots = {
      left: makePortraitSlot('left'),
      center: makePortraitSlot('center'),
      right: makePortraitSlot('right'),
    };

    this.boxEl = document.createElement('div');
    this.boxEl.className = 'stapler-dialogue-box';
    this.boxEl.dataset.boxStyle = 'default';
    this.boxEl.dataset.speakerSlot = 'left';

    this.speakerEl = document.createElement('div');
    this.speakerEl.className = 'stapler-dialogue-speaker';

    this.textEl = document.createElement('div');
    this.textEl.className = 'stapler-dialogue-text';

    this.nextHintEl = document.createElement('div');
    this.nextHintEl.className = 'stapler-dialogue-hint';

    this.boxEl.append(this.speakerEl, this.textEl, this.nextHintEl);
    this.element.append(stage, this.boxEl);
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
      this.renderedLineKeys = [];
      this.typewriter.setText('');
      return;
    }

    this.element.hidden = false;
    this.boxEl.dataset.boxStyle = snapshot.boxStyle || 'default';
    const speakingSlot = this.updatePortraits(snapshot);
    this.boxEl.dataset.speakerSlot = speakingSlot ?? 'left';

    if (snapshot.currentLine) {
      this.boxEl.dataset.speaker = snapshot.currentLine.speaker;
      this.speakerEl.textContent = this.i18n.getSpeaker(snapshot.currentLine.speaker);
      const rawLine = this.i18n.getLine(snapshot.currentLine.lineKey);

      if (snapshot.currentLine.append && this.renderedLineKeys.length > 0) {
        this.renderedLineKeys.push(snapshot.currentLine.lineKey);
        this.typewriter.appendText(rawLine, ' ');
      } else {
        this.renderedLineKeys = [snapshot.currentLine.lineKey];
        this.typewriter.setText(rawLine);
      }

      this.textEl.textContent = this.typewriter.getVisibleText();
      this.nextHintEl.textContent = this.i18n.getUi('dialogue_next', 'Click / Space ▸');
      this.nextHintEl.style.opacity = this.typewriter.isWaitingForInput() ? '1' : '0.3';
    } else if (snapshot.waiting) {
      this.nextHintEl.style.opacity = '0';
    }
  }

  /** Re-resolves speaker and text immediately when the user switches language. */
  refreshLocale(): void {
    if (!this.lastSnapshot || !this.lastSnapshot.active || !this.lastSnapshot.currentLine) return;
    this.speakerEl.textContent = this.i18n.getSpeaker(this.lastSnapshot.currentLine.speaker);
    const combined = this.renderedLineKeys
      .map((key) => stripInlineDialogueTags(this.i18n.getLine(key)))
      .join(' ');
    this.typewriter.setText(combined);
    this.typewriter.revealAll();
    this.textEl.textContent = this.typewriter.getVisibleText();
    this.nextHintEl.textContent = this.i18n.getUi('dialogue_next', 'Click / Space ▸');
    this.nextHintEl.style.opacity = '1';
  }

  update(dt: number): void {
    if (this.element.hidden || this.typewriter.isComplete()) return;
    this.typewriter.update(dt);
    this.textEl.textContent = this.typewriter.getVisibleText();
    this.nextHintEl.style.opacity = this.typewriter.isWaitingForInput() ? '1' : '0.3';
  }

  /**
   * Handles Click / Space / Enter:
   * - While typing: completes up to the next `{p}` pause (or end of line).
   * - At a `{p}` pause: resumes typing the remainder in the same box.
   * - Once complete: advances to the next script statement.
   */
  handleAdvanceInput(): void {
    if (this.element.hidden) return;
    const outcome = this.typewriter.handleAdvance();
    this.textEl.textContent = this.typewriter.getVisibleText();
    this.nextHintEl.style.opacity = this.typewriter.isWaitingForInput() ? '1' : '0.3';
    if (outcome === 'advance_line') {
      this.onAdvanceRequested?.();
    }
  }

  private updatePortraits(snapshot: DialogueStateSnapshot): PortraitSlot | null {
    const slots: PortraitSlot[] = ['left', 'center', 'right'];
    let speakingSlot: PortraitSlot | null = null;

    for (const slot of slots) {
      const nodes = this.portraitSlots[slot];
      const active = snapshot.portraits[slot];
      if (!active) {
        nodes.wrapper.hidden = true;
        continue;
      }
      const url =
        this.portraitsMap[active.character]?.[active.pose] ??
        this.portraitsMap[active.character]?.default;
      if (url) {
        nodes.img.src = url;
        nodes.img.alt = `${active.character} (${active.pose})`;
        nodes.img.dataset.facing = active.facing;
        nodes.img.dataset.flip = active.facing !== this.defaultArtFacing ? 'true' : 'false';
        nodes.wrapper.hidden = false;

        const speaking = snapshot.currentLine?.speaker === active.character;
        if (speaking) {
          speakingSlot = slot;
        }
        nodes.wrapper.classList.toggle('is-speaking', Boolean(speaking));
        nodes.wrapper.classList.toggle('is-inactive', !speaking);
      } else {
        nodes.wrapper.hidden = true;
      }
    }

    return speakingSlot;
  }
}
