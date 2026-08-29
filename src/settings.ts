export interface NestNoteSettings {
  maxChildDepth: number;
  openPanelOnStartup: boolean;
}

export const DEFAULT_NESTNOTE_SETTINGS: NestNoteSettings = {
  maxChildDepth: 5,
  openPanelOnStartup: true,
};

export function normalizeNestNoteSettings(value: unknown): NestNoteSettings {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const maxChildDepth =
    typeof record.maxChildDepth === "number" &&
    Number.isInteger(record.maxChildDepth) &&
    record.maxChildDepth >= 0 &&
    record.maxChildDepth <= 9
      ? record.maxChildDepth
      : DEFAULT_NESTNOTE_SETTINGS.maxChildDepth;
  const openPanelOnStartup =
    typeof record.openPanelOnStartup === "boolean"
      ? record.openPanelOnStartup
      : DEFAULT_NESTNOTE_SETTINGS.openPanelOnStartup;
  return { maxChildDepth, openPanelOnStartup };
}
