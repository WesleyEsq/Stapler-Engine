import type { UiThemeConfig } from '../types/contracts';
import type { I18nStore } from '../dialogue/I18nStore';
import { DialogueView } from './DialogueView';
import { LoadingView } from './LoadingView';
import { PauseMenuView, type PauseMenuCallbacks } from './PauseMenuView';

export interface UIOverlayOptions {
  container: HTMLElement;
  i18n: I18nStore;
  supportedLocales: readonly string[];
  slotIds: ReadonlyArray<number | 'autosave'>;
  portraits?: Record<string, Record<string, string>>;
  theme?: UiThemeConfig;
  onDialogueAdvance: () => void;
  pauseCallbacks: PauseMenuCallbacks;
}

const STYLE_TAG_ID = 'stapler-engine-ui-styles';

/**
 * Root HTML/CSS overlay manager mounted over the WebGL canvas, hosting
 * `DialogueView`, `PauseMenuView`, `LoadingView`, and the proximity prompt.
 */
export class UIOverlay {
  readonly root: HTMLDivElement;
  readonly dialogue: DialogueView;
  readonly pauseMenu: PauseMenuView;
  readonly loading: LoadingView;
  private readonly promptEl: HTMLDivElement;

  constructor(options: UIOverlayOptions) {
    ensureDefaultStyles();

    this.root = document.createElement('div');
    this.root.className = 'stapler-ui-root';
    if (options.theme) {
      this.applyTheme(options.theme);
    }
    options.container.appendChild(this.root);

    this.promptEl = document.createElement('div');
    this.promptEl.className = 'stapler-interact-prompt';
    this.promptEl.hidden = true;
    this.root.appendChild(this.promptEl);

    this.dialogue = new DialogueView({
      parent: this.root,
      i18n: options.i18n,
      portraits: options.portraits,
      portraitDefaultFacing: options.theme?.portraitDefaultFacing,
      onAdvanceRequested: options.onDialogueAdvance,
    });

    this.pauseMenu = new PauseMenuView({
      parent: this.root,
      i18n: options.i18n,
      supportedLocales: options.supportedLocales,
      slotIds: options.slotIds,
      callbacks: options.pauseCallbacks,
    });

    this.loading = new LoadingView(this.root);
  }

  applyTheme(theme: UiThemeConfig): void {
    if (theme.customCssClass) {
      for (const cls of theme.customCssClass.split(/\s+/).filter(Boolean)) {
        this.root.classList.add(cls);
      }
    }
    const setVar = (name: string, val: string | number | undefined): void => {
      if (val !== undefined) {
        this.root.style.setProperty(name, String(val));
      }
    };
    setVar('--stapler-font-family', theme.fontFamily);
    setVar('--stapler-speaker-font', theme.speakerFontFamily);
    setVar('--stapler-text-scale', theme.dialogueTextScale);
    setVar('--stapler-box-max-width', theme.dialogueMaxWidth);
    setVar('--stapler-box-min-height', theme.dialogueMinHeight);
    setVar('--stapler-box-bg', theme.boxBackground);
    setVar('--stapler-box-text', theme.boxTextColor);
    setVar('--stapler-box-border', theme.boxBorderColor);
    setVar('--stapler-box-border-width', theme.boxBorderWidth);
    setVar('--stapler-box-radius', theme.boxRadius);
    setVar('--stapler-box-shadow', theme.boxShadow);
    setVar('--stapler-speaker-bg', theme.speakerBackground);
    setVar('--stapler-speaker-text', theme.speakerTextColor);
    setVar('--stapler-speaker-border', theme.speakerBorderColor);
    setVar('--stapler-hint-color', theme.hintColor);
    setVar('--stapler-accent', theme.accentColor);
    setVar('--stapler-portrait-height', theme.portraitHeight);
    setVar('--stapler-portrait-overlap', theme.portraitOverlap);
    setVar('--stapler-portrait-inactive-brightness', theme.portraitInactiveBrightness);
  }

  setInteractPrompt(text: string | null): void {
    if (text) {
      this.promptEl.textContent = text;
      this.promptEl.hidden = false;
    } else {
      this.promptEl.hidden = true;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

function ensureDefaultStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_TAG_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_TAG_ID;
  style.textContent = `
.stapler-ui-root {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 20;
  font-family: var(--stapler-font-family, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  /* Uses rem + gentle vw so browser zoom (Ctrl + / -) scales UI naturally instead of fighting viewport width */
  font-size: clamp(1rem, 0.9rem + 0.3vw, 1.35rem);
}

.stapler-ui-root [hidden] {
  display: none !important;
}

.stapler-interact-prompt {
  position: absolute;
  left: 50%;
  bottom: calc(26px * var(--ui-scale, 1));
  transform: translateX(-50%);
  background: rgba(22, 25, 35, 0.92);
  border: 1px solid rgba(116, 208, 255, 0.55);
  color: #f3f7ff;
  padding: 0.45em 1.1em;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.92em;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.stapler-dialogue-layer {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: clamp(14px, 2.2vh, 28px) clamp(14px, 2.4vw, 32px);
  background: linear-gradient(to top, rgba(16, 18, 26, 0.52), transparent 48%);
}

.stapler-portrait-stage {
  position: relative;
  width: min(var(--stapler-box-max-width, 980px), 96%);
  height: var(--stapler-portrait-height, clamp(250px, 48vh, 480px));
  margin: 0 auto calc(-1 * var(--stapler-portrait-overlap, 48px));
  pointer-events: none;
  z-index: 1;
}

.stapler-portrait-slot {
  position: absolute;
  bottom: 0;
  height: 100%;
  max-width: 44%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  transform-origin: bottom center;
  transition: transform 0.2s ease, filter 0.2s ease, opacity 0.2s ease;
}

.stapler-portrait-slot-left {
  left: 2%;
}

.stapler-portrait-slot-center {
  left: 50%;
  transform: translateX(-50%);
}

.stapler-portrait-slot-right {
  right: 2%;
}

.stapler-portrait-slot.is-inactive {
  z-index: 1;
  opacity: 0.92;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.35))
    brightness(var(--stapler-portrait-inactive-brightness, 0.45))
    saturate(0.65);
  transform: scale(0.93) translateY(10px);
}

.stapler-portrait-slot-center.is-inactive {
  transform: translateX(-50%) scale(0.93) translateY(10px);
}

.stapler-portrait-slot.is-speaking {
  z-index: 2;
  opacity: 1;
  filter: drop-shadow(0 14px 28px rgba(0, 0, 0, 0.55)) brightness(1.02);
  transform: scale(1.03) translateY(-6px);
}

.stapler-portrait-slot-center.is-speaking {
  transform: translateX(-50%) scale(1.03) translateY(-6px);
}

.stapler-portrait-img {
  display: block;
  height: 100%;
  width: auto;
  max-width: 100%;
  object-fit: contain;
  object-position: bottom center;
  transition: transform 0.16s ease;
}

.stapler-portrait-img[data-flip='true'] {
  transform: scaleX(-1);
}

.stapler-dialogue-box {
  position: relative;
  z-index: 3;
  width: min(var(--stapler-box-max-width, 980px), 96%);
  margin: 0 auto;
  min-height: var(--stapler-box-min-height, 9.2em);
  font-size: calc(clamp(1.08rem, 0.95rem + 0.38vw, 1.48rem) * var(--stapler-text-scale, 1));
  background: var(--stapler-box-bg, rgba(250, 246, 238, 0.97));
  color: var(--stapler-box-text, #1d2028);
  border: var(--stapler-box-border-width, 3px) solid var(--stapler-box-border, #232630);
  border-radius: var(--stapler-box-radius, 14px);
  padding: 1.15em 1.5em 1.75em;
  box-shadow: var(--stapler-box-shadow, 0 14px 36px rgba(0, 0, 0, 0.45));
}

.stapler-dialogue-speaker {
  display: inline-block;
  font-family: var(--stapler-speaker-font, inherit);
  background: var(--stapler-speaker-bg, #232630);
  color: var(--stapler-speaker-text, #faf6ee);
  border: 2px solid var(--stapler-speaker-border, transparent);
  font-weight: 700;
  padding: 0.24em 0.9em;
  border-radius: 8px;
  margin-bottom: 0.55em;
  font-size: 0.9em;
  letter-spacing: 0.02em;
}

.stapler-dialogue-text {
  line-height: 1.52;
  font-size: 1em;
  min-height: 3.1em;
}

.stapler-dialogue-hint {
  position: absolute;
  right: 1.2em;
  bottom: 0.65em;
  font-size: 0.74em;
  font-weight: 600;
  color: var(--stapler-hint-color, #656a79);
  transition: opacity 0.15s ease;
}

.stapler-pause-backdrop {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  background: rgba(16, 18, 26, 0.72);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.stapler-pause-panel {
  width: min(640px, 94vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: #1f222d;
  color: #f4f1ea;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 14px;
  padding: 18px 20px;
  gap: 14px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
}

.stapler-pause-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.stapler-pause-tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  padding-bottom: 10px;
}

.stapler-tab {
  background: rgba(255, 255, 255, 0.08);
  color: #cfd3df;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 6px 14px;
  font-weight: 600;
  cursor: pointer;
}

.stapler-tab.is-active {
  background: rgba(255, 134, 79, 0.22);
  border-color: rgba(255, 134, 79, 0.65);
  color: #fff4ec;
}

.stapler-pause-body {
  overflow-y: auto;
  padding-right: 4px;
}

.stapler-save-list,
.stapler-settings-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stapler-save-row,
.stapler-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 9px;
  padding: 9px 12px;
}

.stapler-save-slot-name { font-weight: 700; font-size: 0.95em; }
.stapler-save-detail { font-size: 0.8em; color: #b7bdcc; }
.stapler-save-actions,
.stapler-audio-control { display: flex; align-items: center; gap: 6px; }

.stapler-btn {
  background: rgba(255, 255, 255, 0.11);
  color: #f7f5f0;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 7px;
  padding: 5px 11px;
  font-size: 0.85em;
  font-weight: 600;
  cursor: pointer;
}

.stapler-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.2); }
.stapler-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.stapler-btn-primary { background: #e87245; border-color: #f38c63; color: #fff; }
.stapler-btn-primary:hover:not(:disabled) { background: #f27e51; }
.stapler-btn-danger { border-color: rgba(255, 100, 100, 0.45); color: #ffb4b4; }

.stapler-select {
  background: #2b2f3d;
  color: #f5f5f5;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 7px;
  padding: 5px 10px;
}

.stapler-loading-overlay {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  background: #171922;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #f3efe6;
}

.stapler-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.stapler-loading-spinner {
  width: 34px;
  height: 34px;
  border: 3px solid rgba(255, 255, 255, 0.18);
  border-top-color: #f08354;
  border-radius: 50%;
  animation: stapler-spin 0.85s linear infinite;
}

@keyframes stapler-spin {
  to { transform: rotate(360deg); }
}
`;
  document.head.appendChild(style);
}
