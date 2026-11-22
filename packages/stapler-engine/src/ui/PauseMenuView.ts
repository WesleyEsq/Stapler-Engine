import type { SaveSlotData, UserSettings } from '../types/contracts';
import type { I18nStore } from '../dialogue/I18nStore';

export interface PauseMenuCallbacks {
  onResume: () => void;
  onSaveSlot: (slotId: number | 'autosave') => Promise<void>;
  onLoadSlot: (slotId: number | 'autosave') => Promise<void>;
  onEraseSlot: (slotId: number | 'autosave') => Promise<void>;
  onSettingsChanged: (settings: UserSettings) => void;
}

export interface PauseMenuViewOptions {
  parent: HTMLElement;
  i18n: I18nStore;
  supportedLocales: readonly string[];
  slotIds: ReadonlyArray<number | 'autosave'>;
  callbacks: PauseMenuCallbacks;
}

/**
 * HTML/CSS Pause Menu overlay with Resume, localized Settings (language + BGM/SFX/Voice
 * volume & mute), and Save / Load / Erase slot management.
 */
export class PauseMenuView {
  readonly element: HTMLDivElement;

  private readonly i18n: I18nStore;
  private readonly supportedLocales: readonly string[];
  private readonly slotIds: ReadonlyArray<number | 'autosave'>;
  private readonly callbacks: PauseMenuCallbacks;

  private readonly panelEl: HTMLDivElement;
  private currentSettings: UserSettings | null = null;
  private currentSaves = new Map<number | 'autosave', SaveSlotData>();
  private activeTab: 'saves' | 'settings' = 'saves';

  constructor(options: PauseMenuViewOptions) {
    this.i18n = options.i18n;
    this.supportedLocales = options.supportedLocales;
    this.slotIds = options.slotIds;
    this.callbacks = options.callbacks;

    this.element = document.createElement('div');
    this.element.className = 'stapler-pause-backdrop';
    this.element.hidden = true;

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'stapler-pause-panel';
    this.element.appendChild(this.panelEl);
    options.parent.appendChild(this.element);

    this.element.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
  }

  open(settings: UserSettings, saves: Map<number | 'autosave', SaveSlotData>): void {
    this.currentSettings = { ...settings };
    this.currentSaves = new Map(saves);
    this.element.hidden = false;
    this.render();
  }

  updateSaves(saves: Map<number | 'autosave', SaveSlotData>): void {
    this.currentSaves = new Map(saves);
    if (!this.element.hidden) {
      this.render();
    }
  }

  close(): void {
    this.element.hidden = true;
  }

  isOpen(): boolean {
    return !this.element.hidden;
  }

  render(): void {
    if (!this.currentSettings) return;
    const t = (key: string, fallback: string): string => this.i18n.getUi(key, fallback);

    this.panelEl.innerHTML = '';

    // Header + Resume
    const header = document.createElement('div');
    header.className = 'stapler-pause-header';

    const title = document.createElement('h2');
    title.textContent = t('pause_title', 'Paused');

    const resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.className = 'stapler-btn stapler-btn-primary';
    resumeBtn.textContent = t('pause_resume', 'Resume');
    resumeBtn.onclick = () => this.callbacks.onResume();

    header.append(title, resumeBtn);
    this.panelEl.appendChild(header);

    // Tabs (Save / Load vs Settings)
    const tabs = document.createElement('div');
    tabs.className = 'stapler-pause-tabs';

    const savesTabBtn = document.createElement('button');
    savesTabBtn.type = 'button';
    savesTabBtn.className = `stapler-tab ${this.activeTab === 'saves' ? 'is-active' : ''}`;
    savesTabBtn.textContent = t('pause_tab_saves', 'Save / Load');
    savesTabBtn.onclick = () => {
      this.activeTab = 'saves';
      this.render();
    };

    const settingsTabBtn = document.createElement('button');
    settingsTabBtn.type = 'button';
    settingsTabBtn.className = `stapler-tab ${this.activeTab === 'settings' ? 'is-active' : ''}`;
    settingsTabBtn.textContent = t('pause_tab_settings', 'Settings');
    settingsTabBtn.onclick = () => {
      this.activeTab = 'settings';
      this.render();
    };

    tabs.append(savesTabBtn, settingsTabBtn);
    this.panelEl.appendChild(tabs);

    // Tab Content
    const body = document.createElement('div');
    body.className = 'stapler-pause-body';

    if (this.activeTab === 'saves') {
      this.renderSaveSlots(body, t);
    } else {
      this.renderSettings(body, t);
    }

    this.panelEl.appendChild(body);
  }

  private renderSaveSlots(body: HTMLElement, t: (k: string, f: string) => string): void {
    const list = document.createElement('div');
    list.className = 'stapler-save-list';

    for (const slotId of this.slotIds) {
      const data = this.currentSaves.get(slotId);
      const row = document.createElement('div');
      row.className = 'stapler-save-row';

      const meta = document.createElement('div');
      meta.className = 'stapler-save-meta';

      const slotTitle = document.createElement('div');
      slotTitle.className = 'stapler-save-slot-name';
      slotTitle.textContent =
        slotId === 'autosave'
          ? t('save_autosave', 'Autosave')
          : `${t('save_slot', 'Slot')} ${slotId}`;

      const detail = document.createElement('div');
      detail.className = 'stapler-save-detail';
      if (data) {
        const roomName = this.i18n.getEnvironmentTitle(data.environmentTitleKey);
        const mins = Math.floor(data.playtimeSeconds / 60);
        const secs = Math.floor(data.playtimeSeconds % 60)
          .toString()
          .padStart(2, '0');
        const dateStr = new Date(data.savedAt).toLocaleString();
        detail.textContent = `${roomName} · ${mins}:${secs} · ${dateStr}`;
      } else {
        detail.textContent = t('save_empty', 'Empty');
      }

      meta.append(slotTitle, detail);

      const actions = document.createElement('div');
      actions.className = 'stapler-save-actions';

      if (slotId !== 'autosave') {
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'stapler-btn';
        saveBtn.textContent = t('save_btn', 'Save');
        saveBtn.onclick = () => void this.callbacks.onSaveSlot(slotId);
        actions.appendChild(saveBtn);
      }

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'stapler-btn';
      loadBtn.textContent = t('load_btn', 'Load');
      loadBtn.disabled = !data;
      loadBtn.onclick = () => void this.callbacks.onLoadSlot(slotId);

      const eraseBtn = document.createElement('button');
      eraseBtn.type = 'button';
      eraseBtn.className = 'stapler-btn stapler-btn-danger';
      eraseBtn.textContent = t('erase_btn', 'Erase');
      eraseBtn.disabled = !data;
      eraseBtn.onclick = () => void this.callbacks.onEraseSlot(slotId);

      actions.append(loadBtn, eraseBtn);
      row.append(meta, actions);
      list.appendChild(row);
    }

    body.appendChild(list);
  }

  private renderSettings(body: HTMLElement, t: (k: string, f: string) => string): void {
    const settings = this.currentSettings!;
    const grid = document.createElement('div');
    grid.className = 'stapler-settings-list';

    // Language selector
    const langRow = document.createElement('div');
    langRow.className = 'stapler-setting-row';
    const langLabel = document.createElement('label');
    langLabel.textContent = t('settings_language', 'Language');
    const langSelect = document.createElement('select');
    langSelect.className = 'stapler-select';
    for (const loc of this.supportedLocales) {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc.toUpperCase();
      opt.selected = settings.language === loc;
      langSelect.appendChild(opt);
    }
    langSelect.onchange = () => {
      settings.language = langSelect.value;
      this.callbacks.onSettingsChanged({ ...settings });
      this.render();
    };
    langRow.append(langLabel, langSelect);
    grid.appendChild(langRow);

    // Volume + mute sliders
    const addAudioRow = (
      labelKey: string,
      fallback: string,
      volKey: 'bgmVolume' | 'sfxVolume' | 'voiceVolume',
      muteKey: 'bgmMuted' | 'sfxMuted' | 'voiceMuted',
    ): void => {
      const row = document.createElement('div');
      row.className = 'stapler-setting-row';

      const label = document.createElement('label');
      label.textContent = t(labelKey, fallback);

      const controls = document.createElement('div');
      controls.className = 'stapler-audio-control';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(Math.round(settings[volKey] * 100));
      slider.disabled = settings[muteKey];
      slider.oninput = () => {
        settings[volKey] = Number(slider.value) / 100;
        this.callbacks.onSettingsChanged({ ...settings });
      };

      const muteBtn = document.createElement('button');
      muteBtn.type = 'button';
      muteBtn.className = 'stapler-btn';
      muteBtn.textContent = settings[muteKey]
        ? t('settings_unmute', 'Unmute')
        : t('settings_mute', 'Mute');
      muteBtn.onclick = () => {
        settings[muteKey] = !settings[muteKey];
        this.callbacks.onSettingsChanged({ ...settings });
        this.render();
      };

      controls.append(slider, muteBtn);
      row.append(label, controls);
      grid.appendChild(row);
    };

    addAudioRow('settings_bgm', 'Music (BGM)', 'bgmVolume', 'bgmMuted');
    addAudioRow('settings_sfx', 'Sound Effects (SFX)', 'sfxVolume', 'sfxMuted');
    addAudioRow('settings_voice', 'Voice', 'voiceVolume', 'voiceMuted');

    body.appendChild(grid);
  }
}
