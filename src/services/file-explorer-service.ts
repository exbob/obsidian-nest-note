import {
  buildFileWikiLink,
  linkPathFromRoot,
  markdownReferencesPath,
  sortExplorerEntries,
  type ExplorerEntry,
} from "../domain/file-explorer-path";
import { t } from "../i18n";

export interface FileExplorerVault {
  getFolderByPath(path: string): { path: string } | null;
  getAbstractFileByPath(
    path: string,
  ): { path: string; children?: unknown } | null;
  createFolder(path: string): Promise<unknown>;
  read(file: { path: string }): Promise<string>;
  getFileByPath(path: string): { path: string } | null;
  trashFile(file: { path: string }): Promise<void>;
  adapter: {
    exists(path: string): Promise<boolean> | boolean;
    list?(path: string): Promise<{ files: string[]; folders: string[] }>;
    copy?(src: string, dst: string): Promise<void>;
  };
}

export interface FileExplorerServiceDeps {
  vault: FileExplorerVault;
  fileManager: { trashFile(file: { path: string }): Promise<void> };
  resolveDocumentPath(filePath: string | null): string | null;
  getRootName(): string;
  notice: (message: string) => void;
  /** 将绝对路径文件/文件夹复制进 vault 相对路径（桌面实现） */
  importAbsolutePath(
    absoluteSource: string,
    vaultDestPath: string,
  ): Promise<void>;
}

interface ChildRef {
  path: string;
  name?: string;
  children?: unknown;
}

export class NestNoteFileExplorerService {
  constructor(private readonly deps: FileExplorerServiceDeps) {}

  /** 活动文件 → 文档路径；非 NestNote 返回 null */
  resolveActiveDocument(activeFilePath: string | null): string | null {
    return this.deps.resolveDocumentPath(activeFilePath);
  }

  /** 确保 documentPath/root 存在；失败 notice 并返回 null */
  async ensureRoot(documentPath: string): Promise<string | null> {
    const root = this.vaultPath(documentPath, "");
    if (this.deps.vault.getFolderByPath(root) !== null) {
      return root;
    }
    try {
      if (this.deps.vault.getAbstractFileByPath(root) !== null) {
        throw new Error(`${root} exists and is not a folder`);
      }
      await this.deps.vault.createFolder(root);
    } catch {
      this.deps.notice(t("notice.fileExplorerRootCreateFailed"));
      return null;
    }
    return root;
  }

  async listEntries(
    documentPath: string,
    relativeWithinRoot: string,
  ): Promise<ExplorerEntry[]> {
    const folder = this.deps.vault.getAbstractFileByPath(
      this.vaultPath(documentPath, relativeWithinRoot),
    );
    if (folder === null || !Array.isArray(folder.children)) {
      return [];
    }
    const entries = (folder.children as ChildRef[]).map(
      (child): ExplorerEntry => ({
        name: child.name ?? baseName(child.path),
        kind: Array.isArray(child.children) ? "folder" : "file",
      }),
    );
    return sortExplorerEntries(entries);
  }

  vaultPath(
    documentPath: string,
    relativeWithinRoot: string,
    entryName?: string,
  ): string {
    const rel = trimSlashes(relativeWithinRoot);
    const parts = [trimSlashes(documentPath), this.deps.getRootName()];
    if (rel !== "") parts.push(rel);
    if (entryName !== undefined && entryName !== "") parts.push(entryName);
    return parts.join("/");
  }

  buildInsertText(
    documentPath: string,
    relativeWithinRoot: string,
    entry: ExplorerEntry,
  ): string {
    void documentPath;
    return buildFileWikiLink(this.linkPath(relativeWithinRoot, entry), entry.name);
  }

  async indexReferencesEntry(
    documentPath: string,
    relativeWithinRoot: string,
    entry: ExplorerEntry,
  ): Promise<boolean> {
    const indexFile = this.deps.vault.getFileByPath(
      `${trimSlashes(documentPath)}/index.md`,
    );
    if (indexFile === null) {
      return false;
    }
    const content = await this.deps.vault.read(indexFile);
    return markdownReferencesPath(
      content,
      this.linkPath(relativeWithinRoot, entry),
    );
  }

  async trashEntry(
    documentPath: string,
    relativeWithinRoot: string,
    entry: ExplorerEntry,
  ): Promise<void> {
    const target = this.deps.vault.getAbstractFileByPath(
      this.vaultPath(documentPath, relativeWithinRoot, entry.name),
    );
    if (target === null) {
      return;
    }
    await this.deps.fileManager.trashFile(target);
  }

  async pasteAbsolutePaths(
    documentPath: string,
    relativeWithinRoot: string,
    absoluteSources: string[],
  ): Promise<void> {
    if (absoluteSources.length === 0) {
      return;
    }
    const root = await this.ensureRoot(documentPath);
    if (root === null) {
      return;
    }

    const existingNames = await this.existingNamesLower(
      documentPath,
      relativeWithinRoot,
    );
    const plan: Array<{ source: string; dest: string }> = [];
    const seen = new Set<string>();
    for (const source of absoluteSources) {
      const name = baseName(source);
      const dest = this.vaultPath(documentPath, relativeWithinRoot, name);
      const key = name.toLowerCase();
      if (
        name === "" ||
        seen.has(key) ||
        existingNames.has(key) ||
        this.deps.vault.getAbstractFileByPath(dest) !== null
      ) {
        this.deps.notice(t("notice.pasteConflict"));
        return;
      }
      seen.add(key);
      plan.push({ source, dest });
    }

    for (const { source, dest } of plan) {
      await this.deps.importAbsolutePath(source, dest);
    }
  }

  /** 目标目录下已有条目名（小写），含 vault 未索引的隐藏文件（若 adapter 支持 list）。 */
  private async existingNamesLower(
    documentPath: string,
    relativeWithinRoot: string,
  ): Promise<Set<string>> {
    const names = new Set<string>();
    const folderPath = this.vaultPath(documentPath, relativeWithinRoot);
    const folder = this.deps.vault.getAbstractFileByPath(folderPath);
    if (folder !== null && Array.isArray(folder.children)) {
      for (const child of folder.children as ChildRef[]) {
        names.add((child.name ?? baseName(child.path)).toLowerCase());
      }
    }
    const list = this.deps.vault.adapter.list;
    if (typeof list === "function") {
      try {
        const listed = await list.call(this.deps.vault.adapter, folderPath);
        for (const path of [...listed.files, ...listed.folders]) {
          names.add(baseName(path).toLowerCase());
        }
      } catch {
        // adapter 列表失败时，依赖 vault children 与桌面层 force:false 兜底
      }
    }
    return names;
  }

  private linkPath(relativeWithinRoot: string, entry: ExplorerEntry): string {
    return linkPathFromRoot(
      this.deps.getRootName(),
      relativeWithinRoot,
      entry.name,
    );
  }
}

function trimSlashes(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
