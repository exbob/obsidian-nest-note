export type FileExplorerSide = "left" | "right";

export interface NestNoteSettings {
  maxChildDepth: number;
  openPanelOnStartup: boolean;
  autoFixDocumentFormat: boolean;
  openFileExplorerOnStartup: boolean;
  fileExplorerSide: FileExplorerSide;
  fileExplorerRoot: string;
}

export const DEFAULT_NESTNOTE_SETTINGS: NestNoteSettings = {
  maxChildDepth: 5,
  openPanelOnStartup: true,
  autoFixDocumentFormat: true,
  openFileExplorerOnStartup: true,
  fileExplorerSide: "right",
  fileExplorerRoot: "files",
};

export function isValidFileExplorerRoot(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes(":")
  );
}

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
  const autoFixDocumentFormat =
    typeof record.autoFixDocumentFormat === "boolean"
      ? record.autoFixDocumentFormat
      : DEFAULT_NESTNOTE_SETTINGS.autoFixDocumentFormat;
  const openFileExplorerOnStartup =
    typeof record.openFileExplorerOnStartup === "boolean"
      ? record.openFileExplorerOnStartup
      : DEFAULT_NESTNOTE_SETTINGS.openFileExplorerOnStartup;
  const fileExplorerSide =
    record.fileExplorerSide === "left" || record.fileExplorerSide === "right"
      ? record.fileExplorerSide
      : DEFAULT_NESTNOTE_SETTINGS.fileExplorerSide;
  const fileExplorerRoot =
    typeof record.fileExplorerRoot === "string" &&
    isValidFileExplorerRoot(record.fileExplorerRoot)
      ? record.fileExplorerRoot
      : DEFAULT_NESTNOTE_SETTINGS.fileExplorerRoot;
  return {
    maxChildDepth,
    openPanelOnStartup,
    autoFixDocumentFormat,
    openFileExplorerOnStartup,
    fileExplorerSide,
    fileExplorerRoot,
  };
}
