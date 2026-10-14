export const AUDIO_VIDEO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "flac",
  "aac",
  "mp4",
  "webm",
  "mov",
  "mkv",
  "avi",
]);

export function isAudioVideoFileName(name: string): boolean {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return false;
  return AUDIO_VIDEO_EXTENSIONS.has(name.slice(i + 1).toLowerCase());
}

export function buildFileWikiLink(
  relativePath: string,
  displayName: string,
): string {
  const inner = `[[${relativePath}|${displayName}]]`;
  return isAudioVideoFileName(displayName) ? `!${inner}` : inner;
}

export function markdownReferencesPath(
  markdown: string,
  relativeToIndex: string,
): boolean {
  const target = relativeToIndex.replace(/\\/g, "/");
  const re = /!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  for (const match of markdown.matchAll(re)) {
    const path = match[1].trim().replace(/\\/g, "/");
    if (path === target || path.startsWith(`${target}/`)) return true;
  }
  return false;
}

export type ExplorerEntryKind = "folder" | "file";

export interface ExplorerEntry {
  name: string;
  kind: ExplorerEntryKind;
}

export function sortExplorerEntries(
  entries: readonly ExplorerEntry[],
): ExplorerEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function displayExplorerPath(
  rootName: string,
  relativeWithinRoot: string,
): string {
  const rel = relativeWithinRoot.replace(/^\/+|\/+$/g, "");
  return rel === "" ? rootName : `${rootName}/${rel}`;
}

export function linkPathFromRoot(
  rootName: string,
  relativeWithinRoot: string,
  entryName: string,
): string {
  const rel = relativeWithinRoot.replace(/^\/+|\/+$/g, "");
  return rel === ""
    ? `${rootName}/${entryName}`
    : `${rootName}/${rel}/${entryName}`;
}
