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
    options.container.appendChild(this.root);

    this.promptEl = document.createElement('div');
    this.promptEl.className = 'stapler-interact-prompt';
    this.promptEl.hidden = true;
    this.root.appendChild(this.promptEl);

    this.dialogue = new DialogueView({
      parent: this.root,
      i18n: options.i18n,
      portraits: options.portraits,
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
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: calc(15px * var(--ui-scale, 1));
}

.stapler-ui-root [hidden] {
  display: none !important;
}

.stapler-interact-prompt {
  position: absolute;
  left: 50%;
  bottom: calc(26px * var(--ui-scale, 1));
  transform: translateX(-50%);
  background: rgba(22, 25, 35, 0.9);
  border: 1px solid rgba(116, 208, 255, 0.55);
  color: #f3f7ff;
  padding: 0.45em 1.05em;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.9em;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.stapler-dialogue-layer {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: calc(22px * var(--ui-scale, 1));
  background: linear-gradient(to top, rgba(16, 18, 26, 0.55), transparent 45%);
}

.stapler-portrait-stage {
  position: relative;
  height: calc(280px * var(--ui-scale, 1));
  pointer-events: none;
  margin-bottom: calc(-14px * var(--ui-scale, 1));
}

.stapler-portrait {
  position: absolute;
  bottom: 0;
  max-height: 100%;
  max-width: 30%;
  object-fit: contain;
  filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.45)) brightness(0.84);
  transition: transform 0.16s ease, filter 0.16s ease;
}

.stapler-portrait.is-speaking {
  filter: drop-shadow(0 10px 22px rgba(0, 0, 0, 0.55)) brightness(1);
  transform: translateY(-6px);
}

.stapler-portrait-left { left: 4%; }
.stapler-portrait-center { left: 50%; transform: translateX(-50%); }
.stapler-portrait-center.is-speaking { transform: translateX(-50%) translateY(-6px); }
.stapler-portrait-right { right: 4%; }

.stapler-dialogue-box {
  position: relative;
  width: min(920px, 96%);
  margin: 0 auto;
  min-height: calc(140px * var(--ui-scale, 1));
  background: rgba(250, 246, 238, 0.96);
  color: #24262e;
  border: 3px solid #2b2e3a;
  border-radius: 14px;
  padding: 1.05em 1.35em 1.6em;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.45);
}

.stapler-dialogue-speaker {
  display: inline-block;
  background: #2b2e3a;
  color: #faf6ee;
  font-weight: 700;
  padding: 0.25em 0.85em;
  border-radius: 8px;
  margin-bottom: 0.55em;
  font-size: 0.95em;
}

.stapler-dialogue-text {
  line-height: 1.5;
  font-size: 1.05em;
  min-height: 3.1em;
}

.stapler-dialogue-hint {
  position: absolute;
  right: 1.1em;
  bottom: 0.65em;
  font-size: 0.8em;
  font-weight: 600;
  color: #6b6f7e;
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
