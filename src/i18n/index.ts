import * as obsidianApi from "obsidian";
import { en } from "./en";
import { zh } from "./zh";
import type { MessageKey, UiLocale } from "./types";

export type { MessageKey, UiLocale } from "./types";
export { MESSAGE_KEYS } from "./types";
export { en } from "./en";
export { zh } from "./zh";

type LanguageApi = { getLanguage?: () => string };
type LanguageStorage = { getItem(key: string): string | null } | null;

const catalogs: Record<UiLocale, Record<MessageKey, string>> = { zh, en };

let localeOverride: UiLocale | null = null;
let cachedLocale: UiLocale | null = null;

export function resolveLocale(code: string | null | undefined): UiLocale {
  if (typeof code === "string" && code.trim().toLowerCase().startsWith("zh")) {
    return "zh";
  }
  return "en";
}

export function detectLanguage(
  api: LanguageApi = obsidianApi as LanguageApi,
  storage: LanguageStorage = defaultStorage(),
): string {
  if (typeof api.getLanguage === "function") {
    try {
      const code = api.getLanguage();
      if (typeof code === "string" && code.trim() !== "") {
        return code;
      }
    } catch {
      // Fall through to localStorage / default.
    }
  }
  const stored = storage?.getItem("language") ?? null;
  if (stored !== null && stored.trim() !== "") {
    return stored;
  }
  return "en";
}

export function currentLocale(): UiLocale {
  if (localeOverride !== null) {
    return localeOverride;
  }
  if (cachedLocale === null) {
    cachedLocale = resolveLocale(detectLanguage());
  }
  return cachedLocale;
}

export function setLocaleForTests(locale: UiLocale): void {
  localeOverride = locale;
}

export function t(
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  return interpolate(catalogs[currentLocale()][key], vars);
}

function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (vars === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

function defaultStorage(): LanguageStorage {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}
