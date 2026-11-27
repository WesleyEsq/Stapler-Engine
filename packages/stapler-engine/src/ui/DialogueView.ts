import type { CgAssetSpec, CgFitMode, CgTransitionKind, PortraitSlot } from '../types/contracts';
import type { DialogueStateSnapshot } from '../dialogue/DialogueRunner';
import type { I18nStore } from '../dialogue/I18nStore';
import { TypewriterController, stripInlineDialogueTags } from '../dialogue/TypewriterText';

export interface DialogueViewOptions {
  parent: HTMLElement;
  i18n: I18nStore;
  portraits?: Record<string, Record<string, string>>;
  cgs?: Record<string, string | CgAssetSpec>;
  portraitDefaultFacing?: 'left' | 'right';
  cgDefaultFit?: CgFitMode;
  charsPerSecond?: number;
  onAdvanceRequested?: () => void;
}

interface PortraitSlotNodes {
  wrapper: HTMLDivElement;
  img: HTMLImageElement;
  lastSrc: string | null;
}

function isNamelessSpeaker(speaker: string): boolean {
  return speaker === '_' || speaker === 'none';
}

/**
 * Responsive HTML/CSS visual novel dialogue overlay supporting full-screen
 * crossfading CGs/backdrops, Left/Center/Right detailed SVG portraits tucked
 * into the dialogue card, directional portrait facing, active/inactive speaker
 * shading, nameless narration, UI-hide toggle for viewing CGs, localized speaker
 * tags, and inline `{p}`/`{w}` typewriter pacing.
 */
export class DialogueView {
  readonly element: HTMLDivElement;

  private readonly i18n: I18nStore;
  private readonly portraitsMap: Record<string, Record<string, string>>;
  private readonly cgsMap: Record<string, string | CgAssetSpec>;
  private readonly defaultArtFacing: 'left' | 'right';
  private readonly defaultCgFit: CgFitMode;
  private readonly typewriter: TypewriterController;
  private readonly onAdvanceRequested?: () => void;

  private readonly cgStageEl: HTMLDivElement;
  private readonly cgBuffers: [HTMLImageElement, HTMLImageElement];
  private activeCgBuffer = 0;
  private renderedCgId: string | null = null;

  private readonly portraitSlots: Record<PortraitSlot, PortraitSlotNodes>;
  private readonly boxEl: HTMLDivElement;
  private readonly speakerEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly nextHintEl: HTMLDivElement;

  private lastSnapshot: DialogueStateSnapshot | null = null;
  private renderedLineKeys: string[] = [];
  private uiHidden = false;

  constructor(options: DialogueViewOptions) {
    this.i18n = options.i18n;
    this.portraitsMap = options.portraits ?? {};
    this.cgsMap = options.cgs ?? {};
    this.defaultArtFacing = options.portraitDefaultFacing ?? 'right';
    this.defaultCgFit = options.cgDefaultFit ?? 'contain';
    this.typewriter = new TypewriterController(options.charsPerSecond ?? 52);
    this.onAdvanceRequested = options.onAdvanceRequested;

    this.element = document.createElement('div');
    this.element.className = 'stapler-dialogue-layer';
    this.element.hidden = true;

    this.cgStageEl = document.createElement('div');
    this.cgStageEl.className = 'stapler-cg-stage';

    const makeCgImg = (): HTMLImageElement => {
      const img = document.createElement('img');
      img.className = 'stapler-cg-img';
      img.alt = '';
      img.draggable = false;
      this.cgStageEl.appendChild(img);
      return img;
    };
    this.cgBuffers = [makeCgImg(), makeCgImg()];

    const stage = document.createElement('div');
    stage.className = 'stapler-portrait-stage';

    const makePortraitSlot = (slot: PortraitSlot): PortraitSlotNodes => {
      const wrapper = document.createElement('div');
      wrapper.className = `stapler-portrait-slot stapler-portrait-slot-${slot}`;
      wrapper.hidden = true;

      const img = document.createElement('img');
      img.className = 'stapler-portrait-img';
      img.alt = '';
      img.draggable = false;
      wrapper.appendChild(img);
      stage.appendChild(wrapper);
      return { wrapper, img, lastSrc: null };
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
    this.boxEl.dataset.hasSpeaker = 'true';

    this.speakerEl = document.createElement('div');
    this.speakerEl.className = 'stapler-dialogue-speaker';

    this.textEl = document.createElement('div');
    this.textEl.className = 'stapler-dialogue-text';

    this.nextHintEl = document.createElement('div');
    this.nextHintEl.className = 'stapler-dialogue-hint';

    this.boxEl.append(this.speakerEl, this.textEl, this.nextHintEl);
    this.element.append(this.cgStageEl, stage, this.boxEl);
    options.parent.appendChild(this.element);

    this.element.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (this.uiHidden) {
        this.setUiHidden(false);
        return;
      }
      this.handleAdvanceInput();
    });

    this.element.addEventListener('contextmenu', (e) => {
      if (this.element.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      this.toggleUiHidden();
    });
  }

  isUiHidden(): boolean {
    return this.uiHidden;
  }

  setUiHidden(hidden: boolean): void {
    this.uiHidden = hidden;
    this.element.classList.toggle('is-ui-hidden', hidden);
  }

  toggleUiHidden(): boolean {
    this.setUiHidden(!this.uiHidden);
    return this.uiHidden;
  }

  render(snapshot: DialogueStateSnapshot): void {
    this.lastSnapshot = snapshot;
    if (!snapshot.active) {
      this.element.hidden = true;
      this.setUiHidden(false);
      this.renderedLineKeys = [];
      this.typewriter.setText('');
      this.clearCg('cut');
      this.resetPortraits();
      return;
    }

    this.element.hidden = false;
    this.boxEl.dataset.boxStyle = snapshot.boxStyle || 'default';
    this.updateCg(snapshot);
    const speakingSlot = this.updatePortraits(snapshot);
    this.boxEl.dataset.speakerSlot = speakingSlot ?? 'left';

    if (snapshot.currentLine) {
      this.boxEl.dataset.speaker = snapshot.currentLine.speaker;
      this.updateSpeakerLabel(snapshot.currentLine.speaker);
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
    this.updateSpeakerLabel(this.lastSnapshot.currentLine.speaker);
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
   * - If UI is hidden for viewing a CG: restores UI without skipping the line.
   * - While typing: completes up to the next `{p}` pause (or end of line).
   * - At a `{p}` pause: resumes typing the remainder in the same box.
   * - Once complete: advances to the next script statement.
   */
  handleAdvanceInput(): void {
    if (this.element.hidden) return;
    if (this.uiHidden) {
      this.setUiHidden(false);
      return;
    }
    const outcome = this.typewriter.handleAdvance();
    this.textEl.textContent = this.typewriter.getVisibleText();
    this.nextHintEl.style.opacity = this.typewriter.isWaitingForInput() ? '1' : '0.3';
    if (outcome === 'advance_line') {
      this.onAdvanceRequested?.();
    }
  }

  private updateSpeakerLabel(speaker: string): void {
    if (isNamelessSpeaker(speaker)) {
      this.speakerEl.textContent = '';
      this.speakerEl.hidden = true;
      this.boxEl.dataset.hasSpeaker = 'false';
      return;
    }
    const resolved = this.i18n.getSpeaker(speaker).trim();
    if (!resolved) {
      this.speakerEl.textContent = '';
      this.speakerEl.hidden = true;
      this.boxEl.dataset.hasSpeaker = 'false';
      return;
    }
    this.speakerEl.textContent = resolved;
    this.speakerEl.hidden = false;
    this.boxEl.dataset.hasSpeaker = 'true';
  }

  private updateCg(snapshot: DialogueStateSnapshot): void {
    if (!snapshot.cg) {
      if (this.renderedCgId !== null) {
        this.clearCg(snapshot.cgClearTransition);
      }
      return;
    }

    if (this.renderedCgId === snapshot.cg.id) {
      return;
    }

    const entry = this.cgsMap[snapshot.cg.id];
    if (!entry) {
      console.warn(`[DialogueView] CG "${snapshot.cg.id}" is not registered in manifest.cgs.`);
      this.clearCg(snapshot.cg.transition);
      return;
    }

    const spec: CgAssetSpec = typeof entry === 'string' ? { url: entry } : entry;
    const isCut = snapshot.cg.transition === 'cut';
    this.cgStageEl.classList.toggle('is-cut', isCut);
    this.cgStageEl.style.backgroundColor = spec.background ?? '';

    const prevImg = this.cgBuffers[this.activeCgBuffer]!;
    const nextIdx = this.activeCgBuffer === 0 ? 1 : 0;
    const nextImg = this.cgBuffers[nextIdx]!;

    nextImg.dataset.fit = spec.fit ?? this.defaultCgFit;
    nextImg.alt = snapshot.cg.id;
    nextImg.src = spec.url;

    if (isCut) {
      // Flush layout so transition: none applies before swapping opacity
      void this.cgStageEl.offsetWidth;
    }

    nextImg.classList.add('is-visible');
    prevImg.classList.remove('is-visible');
    this.cgStageEl.classList.add('is-active');
    this.element.classList.add('has-cg');

    this.activeCgBuffer = nextIdx;
    this.renderedCgId = snapshot.cg.id;
  }

  private clearCg(transition: CgTransitionKind): void {
    this.cgStageEl.classList.toggle('is-cut', transition === 'cut');
    if (transition === 'cut') {
      void this.cgStageEl.offsetWidth;
    }
    this.cgStageEl.classList.remove('is-active');
    this.cgBuffers[0].classList.remove('is-visible');
    this.cgBuffers[1].classList.remove('is-visible');
    this.element.classList.remove('has-cg');
    this.renderedCgId = null;
  }

  private resetPortraits(): void {
    const slots: PortraitSlot[] = ['left', 'center', 'right'];
    for (const slot of slots) {
      const nodes = this.portraitSlots[slot];
      nodes.wrapper.hidden = true;
      nodes.lastSrc = null;
      nodes.img.classList.remove('is-pose-swapped');
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
        nodes.lastSrc = null;
        continue;
      }
      const url =
        this.portraitsMap[active.character]?.[active.pose] ??
        this.portraitsMap[active.character]?.default;
      if (url) {
        if (nodes.lastSrc !== url) {
          const wasVisible = nodes.lastSrc !== null && !nodes.wrapper.hidden;
          nodes.img.src = url;
          nodes.lastSrc = url;
          if (wasVisible) {
            nodes.img.classList.remove('is-pose-swapped');
            void nodes.img.offsetWidth;
            nodes.img.classList.add('is-pose-swapped');
          }
        }
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
        nodes.lastSrc = null;
      }
    }

    return speakingSlot;
  }
}
