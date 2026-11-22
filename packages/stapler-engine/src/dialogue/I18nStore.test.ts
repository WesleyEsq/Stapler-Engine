import { describe, expect, it, vi } from 'vitest';
import { I18nStore } from './I18nStore';

describe('I18nStore', () => {
  it('resolves active locale keys, falls back to defaultLocale, and notifies listeners on switch', () => {
    const store = new I18nStore('en');
    store.registerLocale('en', {
      ui: { pause_title: 'Paused', resume: 'Resume' },
      environments: { env_studio: 'Main Studio' },
      speakers: { unua: 'Prof. Unua' },
      lines: { greeting: 'Good morning.', only_en: 'Fallback line.' },
    });
    store.registerLocale('es', {
      ui: { pause_title: 'Pausa' },
      environments: { env_studio: 'Estudio Principal' },
      speakers: { unua: 'Prof. Unua (ES)' },
      lines: { greeting: 'Buenos días.' },
    });

    const listener = vi.fn();
    store.onLocaleChanged(listener);

    expect(store.getLine('greeting')).toBe('Good morning.');
    expect(store.getEnvironmentTitle('env_studio')).toBe('Main Studio');

    expect(store.setLocale('es')).toBe(true);
    expect(listener).toHaveBeenCalledWith('es');
    expect(store.getLine('greeting')).toBe('Buenos días.');
    expect(store.getSpeaker('unua')).toBe('Prof. Unua (ES)');
    expect(store.getUi('pause_title')).toBe('Pausa');

    // Missing in 'es' falls back cleanly to defaultLocale 'en'
    expect(store.getLine('only_en')).toBe('Fallback line.');
    expect(store.getUi('resume')).toBe('Resume');

    // Missing in all locales returns visible placeholder key
    expect(store.getLine('nonexistent_key')).toBe('[nonexistent_key]');
    expect(store.setLocale('fr')).toBe(false);
  });
});
