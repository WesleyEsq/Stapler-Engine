import type { LocaleBundle } from '../types/contracts';

/**
 * Stores loaded per-language JSON bundles and resolves speaker names, dialogue
 * lines, environment titles, and UI strings with automatic fallback to `defaultLocale`.
 */
export class I18nStore {
  private readonly bundles = new Map<string, LocaleBundle>();
  private readonly defaultLocale: string;
  private activeLocale: string;
  private readonly listeners = new Set<(locale: string) => void>();

  constructor(defaultLocale: string) {
    this.defaultLocale = defaultLocale;
    this.activeLocale = defaultLocale;
  }

  registerLocale(locale: string, bundle: LocaleBundle): void {
    this.bundles.set(locale, bundle);
  }

  async loadLocale(locale: string, url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch locale "${locale}" from "${url}" (${res.status}).`);
    }
    const bundle = (await res.json()) as LocaleBundle;
    this.registerLocale(locale, bundle);
  }

  getActiveLocale(): string {
    return this.activeLocale;
  }

  getDefaultLocale(): string {
    return this.defaultLocale;
  }

  getLoadedLocales(): string[] {
    return Array.from(this.bundles.keys());
  }

  setLocale(locale: string): boolean {
    if (!this.bundles.has(locale)) return false;
    if (this.activeLocale === locale) return true;
    this.activeLocale = locale;
    for (const listener of this.listeners) {
      listener(locale);
    }
    return true;
  }

  onLocaleChanged(listener: (locale: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getLine(key: string): string {
    return (
      this.bundles.get(this.activeLocale)?.lines[key] ??
      this.bundles.get(this.defaultLocale)?.lines[key] ??
      `[${key}]`
    );
  }

  getSpeaker(speakerId: string): string {
    return (
      this.bundles.get(this.activeLocale)?.speakers[speakerId] ??
      this.bundles.get(this.defaultLocale)?.speakers[speakerId] ??
      speakerId
    );
  }

  getEnvironmentTitle(titleKey: string): string {
    return (
      this.bundles.get(this.activeLocale)?.environments?.[titleKey] ??
      this.bundles.get(this.defaultLocale)?.environments?.[titleKey] ??
      titleKey
    );
  }

  getUi(key: string, fallback?: string): string {
    return (
      this.bundles.get(this.activeLocale)?.ui?.[key] ??
      this.bundles.get(this.defaultLocale)?.ui?.[key] ??
      fallback ??
      key
    );
  }
}
