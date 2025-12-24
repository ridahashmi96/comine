import { writable, derived, get } from 'svelte/store';

// Import all locale files
import en from './locales/en.json';
import ru from './locales/ru.json';

// Type definitions
export type Locale = 'en' | 'ru';

export interface LocaleConfig {
  code: Locale;
  name: string;
  nativeName: string;
}

// Available locales configuration (for UI dropdowns, etc.)
export const locales: LocaleConfig[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' }
];

// All translations
const translations: Record<Locale, typeof en> = {
  en,
  ru
};

// Default locale
const DEFAULT_LOCALE: Locale = 'en';
const STORAGE_KEY = 'comine-locale';

// Get initial locale from storage or browser
function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  
  // Try to get from localStorage
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored in translations) {
    return stored as Locale;
  }
  
  // Try to detect from browser
  const browserLang = navigator.language.split('-')[0];
  if (browserLang in translations) {
    return browserLang as Locale;
  }
  
  return DEFAULT_LOCALE;
}

// Current locale store
export const locale = writable<Locale>(DEFAULT_LOCALE);

// Initialize locale on client side
if (typeof window !== 'undefined') {
  locale.set(getInitialLocale());
  
  // Persist locale changes
  locale.subscribe((value) => {
    localStorage.setItem(STORAGE_KEY, value);
    document.documentElement.lang = value;
  });

  // Expose to window for debugging (can be removed in production)
  (window as any).i18n = {
    setLocale: (code: Locale) => locale.set(code),
    getLocale: () => get(locale),
    locales: Object.keys(translations)
  };
}

// Helper to get nested object value by dot-notation path
function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const keys = path.split('.');
  let current: unknown = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  
  return typeof current === 'string' ? current : undefined;
}

// Interpolate variables in translation string
// Supports {variable} syntax
function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  
  return str.replace(/\{(\w+)\}/g, (_, key) => {
    return vars[key]?.toString() ?? `{${key}}`;
  });
}

// Translation function type
export type TranslationFunction = (key: string, vars?: Record<string, string | number>) => string;

// Derived store that provides the translation function
export const t = derived<typeof locale, TranslationFunction>(
  locale,
  ($locale) => {
    return (key: string, vars?: Record<string, string | number>): string => {
      const translation = getNestedValue(translations[$locale], key);
      
      if (translation === undefined) {
        // Fallback to English
        const fallback = getNestedValue(translations[DEFAULT_LOCALE], key);
        if (fallback === undefined) {
          console.warn(`[i18n] Missing translation: ${key}`);
          return key;
        }
        return interpolate(fallback, vars);
      }
      
      return interpolate(translation, vars);
    };
  }
);

// Utility function to change locale
export function setLocale(newLocale: Locale): void {
  if (newLocale in translations) {
    locale.set(newLocale);
  } else {
    console.warn(`[i18n] Unknown locale: ${newLocale}`);
  }
}

// Get current locale value (non-reactive)
export function getLocale(): Locale {
  return get(locale);
}

// Get a translation value directly (for use outside Svelte components)
export function translate(key: string, vars?: Record<string, string | number>): string {
  const currentLocale = get(locale);
  const translation = getNestedValue(translations[currentLocale], key);
  
  if (translation === undefined) {
    const fallback = getNestedValue(translations[DEFAULT_LOCALE], key);
    if (fallback === undefined) {
      console.warn(`[i18n] Missing translation: ${key}`);
      return key;
    }
    return interpolate(fallback, vars);
  }
  
  return interpolate(translation, vars);
}

// Check if a locale is available
export function isLocaleAvailable(code: string): code is Locale {
  return code in translations;
}

// Export translation type for TypeScript
export type Translations = typeof en;
