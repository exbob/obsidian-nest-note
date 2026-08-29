import {
  ChildrenLinksError,
  updateChildrenLinks,
} from "../domain/children-links";
import { scanDocuments } from "../domain/document-scanner";
import {
  FrontmatterParseError,
  ensureDocumentFrontmatter,
} from "../domain/frontmatter";
import { t } from "../i18n";
import { DEFAULT_NESTNOTE_SETTINGS } from "../settings";
import type { DocumentNode, DocumentService, VaultEntry } from "../types";

export class DocumentServiceError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    readonly noticed: boolean = false,
  ) {
    super(message);
    this.name = "DocumentServiceError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAlreadyNoticed(error: unknown): boolean {
  return error instanceof DocumentServiceError && error.noticed;
}

export interface DocumentFileRef {
  path: string;
}

export interface LoadedVaultEntry {
  path: string;
  children?: unknown;
}

export interface DocumentWorkspaceLeaf {
  openFile(file: DocumentFileRef): Promise<void>;
  getViewType(): string;
}

export interface DocumentServiceApp {
  vault: {
    createFolder(path: string): Promise<unknown>;
    create(path: string, data: string): Promise<unknown>;
    read(file: DocumentFileRef): Promise<string>;
    modify(file: DocumentFileRef, data: string): Promise<void>;
    rename(file: DocumentFileRef, newPath: string): Promise<void>;
    delete(file: DocumentFileRef, force?: boolean): Promise<void>;
    trash(file: DocumentFileRef, system: boolean): Promise<void>;
    getAbstractFileByPath(path: string): DocumentFileRef | null;
    getFolderByPath(path: string): DocumentFileRef | null;
    getFileByPath(path: string): DocumentFileRef | null;
    getAllLoadedFiles(): LoadedVaultEntry[];
  };
  fileManager: {
    trashFile(file: DocumentFileRef): Promise<void>;
  };
  workspace: {
    getLeaf(newLeaf?: boolean): DocumentWorkspaceLeaf;
    getMostRecentLeaf?: () => DocumentWorkspaceLeaf | null;
    iterateRootLeaves?: (
      callback: (leaf: DocumentWorkspaceLeaf) => void,
    ) => void;
  };
}

export interface DocumentServiceOptions {
  createdAt?: string;
  now?: () => Date;
  notice?: (message: string) => void;
  getMaxChildDepth?: () => number;
}

const SIDEBAR_VIEW_TYPE = "nestnote-document-tree";

interface PendingWrite {
  path: string;
  content: string;
}

export class NestNoteDocumentService implements DocumentService {
  constructor(
    private readonly app: DocumentServiceApp,
    private readonly options: DocumentServiceOptions = {},
  ) {}

  async create(parentPath: string | null, name: string): Promise<DocumentNode> {
    const documentName = this.validateName(name);
    const parent = this.resolveParent(parentPath);
    const path =
      parent === null ? documentName : `${parent}/${documentName}`;

    if (this.app.vault.getAbstractFileByPath(path) !== null) {
      throw new DocumentServiceError(t("error.targetExists", { path }));
    }

    const maxChildDepth =
      this.options.getMaxChildDepth?.() ??
      DEFAULT_NESTNOTE_SETTINGS.maxChildDepth;
    const childDepth = parent === null ? 0 : this.documentDepth(parent) + 1;
    if (parent !== null && childDepth > maxChildDepth) {
      throw new DocumentServiceError(
        t("error.maxDepthReached", { max: maxChildDepth }),
      );
    }

    const node: DocumentNode = {
      name: documentName,
      path,
      indexPath: `${path}/index.md`,
      attachmentsPath: `${path}/attachments`,
      children: [],
    };

    const pendingWrites: PendingWrite[] = [];
    if (parent !== null) {
      const parentNode = this.requireScannedNode(parent);
      await this.assertParentWritable(parent, [...parentNode.children, node]);
    }

    const createdPaths: string[] = [];
    try {
      await this.app.vault.createFolder(path);
      createdPaths.push(path);
      await this.app.vault.createFolder(node.attachmentsPath);
      createdPaths.push(node.attachmentsPath);
      await this.app.vault.create(
        node.indexPath,
        ensureDocumentFrontmatter("", {
          name: documentName,
          created: this.createdTimestamp(),
        }),
      );
      createdPaths.push(node.indexPath);
      if (parent !== null) {
        pendingWrites.push(await this.freshParentWrite(parent));
      }
      await this.flushWrites(pendingWrites);
    } catch (error) {
      await this.cleanup(createdPaths);
      if (error instanceof DocumentServiceError) {
        throw error;
      }
      this.failWithNotice(errorMessage(error), error);
    }

    return this.requireScannedNode(path);
  }

  async rename(documentPath: string, newName: string): Promise<DocumentNode> {
    const from = this.requireDocument(documentPath);
    const documentName = this.validateName(newName);
    const parent = getParentPath(from);
    const to = parent === null ? documentName : `${parent}/${documentName}`;

    if (to !== from && this.app.vault.getAbstractFileByPath(to) !== null) {
      throw new DocumentServiceError(t("error.targetExists", { path: to }));
    }

    const folder = this.app.vault.getFolderByPath(from);
    if (folder === null) {
      throw new DocumentServiceError(t("error.documentNotFound", { path: from }));
    }

    const indexFile = this.requireIndex(from);
    const indexContent = await this.app.vault.read(indexFile);
    this.runMetadata(() =>
      ensureDocumentFrontmatter(indexContent, {
        name: documentName,
        created: this.createdTimestamp(),
      }),
    );

    if (parent !== null && this.isCompleteDocument(parent)) {
      const renamed: DocumentNode = {
        name: documentName,
        path: to,
        indexPath: `${to}/index.md`,
        attachmentsPath: `${to}/attachments`,
        children: [],
      };
      const currentParent = this.requireScannedNode(parent);
      const previewChildren = currentParent.children.map((child) =>
        child.path === from ? renamed : child,
      );
      await this.assertParentWritable(parent, previewChildren);
    }

    if (to !== from) {
      await this.app.vault.rename(folder, to);
    }

    const movedIndex = this.requireIndex(to);
    const latestIndex = await this.app.vault.read(movedIndex);
    const nextIndex = this.runMetadata(() =>
      ensureDocumentFrontmatter(latestIndex, {
        name: documentName,
        created: this.createdTimestamp(),
      }),
    );
    const pendingWrites: PendingWrite[] = [];
    if (nextIndex !== latestIndex) {
      pendingWrites.push({ path: `${to}/index.md`, content: nextIndex });
    }
    if (parent !== null && this.isCompleteDocument(parent)) {
      pendingWrites.push(await this.freshParentWrite(parent));
    }

    await this.flushWrites(pendingWrites);
    return this.requireScannedNode(to);
  }

  async trash(documentPath: string): Promise<void> {
    const path = this.requireDocument(documentPath);
    const folder = this.app.vault.getFolderByPath(path);
    if (folder === null) {
      throw new DocumentServiceError(t("error.documentNotFound", { path }));
    }

    const parent = getParentPath(path);
    if (parent !== null && this.isCompleteDocument(parent)) {
      const currentParent = this.requireScannedNode(parent);
      const remaining = currentParent.children.filter(
        (child) => child.path !== path,
      );
      await this.assertParentWritable(parent, remaining);
    }

    await this.trashFolder(folder);
    if (parent !== null && this.isCompleteDocument(parent)) {
      await this.flushWrites([await this.freshParentWrite(parent)]);
    }
  }

  async open(documentPath: string): Promise<void> {
    const path = this.requireDocument(documentPath);
    const indexFile = this.requireIndex(path);
    await pickOpenLeaf(this.app.workspace).openFile(indexFile);
  }

  private validateName(name: string): string {
    const trimmed = name.trim();
    if (trimmed === "") {
      throw new DocumentServiceError(t("error.nameEmpty"));
    }
    if (
      trimmed === "." ||
      trimmed === ".." ||
      trimmed === "attachments" ||
      /[/\\:*?"<>|]/.test(trimmed) ||
      isReservedDeviceName(trimmed) ||
      trimmed.endsWith(".") ||
      name.trimStart() !== trimmed
    ) {
      throw new DocumentServiceError(t("error.nameInvalid", { name }));
    }
    return trimmed;
  }

  private resolveParent(parentPath: string | null): string | null {
    if (parentPath === null) {
      return null;
    }
    const parent = normalizePath(parentPath);
    if (!this.isCompleteDocument(parent)) {
      throw new DocumentServiceError(
        t("error.parentMissing", { path: parentPath }),
      );
    }
    return parent;
  }

  private requireDocument(documentPath: string): string {
    const path = normalizePath(documentPath);
    if (!this.isCompleteDocument(path)) {
      throw new DocumentServiceError(
        t("error.notCompleteDocument", { path: documentPath }),
      );
    }
    return path;
  }

  private documentDepth(path: string): number {
    let depth = 0;
    let current = getParentPath(normalizePath(path));
    while (current !== null) {
      if (this.isCompleteDocument(current)) {
        depth += 1;
      }
      current = getParentPath(current);
    }
    return depth;
  }

  private isCompleteDocument(path: string): boolean {
    const normalized = normalizePath(path);
    if (
      normalized === "" ||
      getName(normalized) === "attachments" ||
      hasAttachmentsAncestor(normalized)
    ) {
      return false;
    }
    return (
      this.app.vault.getFileByPath(`${normalized}/index.md`) !== null &&
      this.app.vault.getFolderByPath(`${normalized}/attachments`) !== null
    );
  }

  private requireIndex(documentPath: string): DocumentFileRef {
    const indexFile = this.app.vault.getFileByPath(`${documentPath}/index.md`);
    if (indexFile === null) {
      throw new DocumentServiceError(
        t("error.documentNotFound", { path: documentPath }),
      );
    }
    return indexFile;
  }

  private async assertParentWritable(
    parentPath: string,
    children: readonly DocumentNode[],
  ): Promise<void> {
    await this.computeParentWrite(parentPath, children);
  }

  private async freshParentWrite(parentPath: string): Promise<PendingWrite> {
    const parent = this.requireScannedNode(parentPath);
    return this.computeParentWrite(parentPath, parent.children);
  }

  private async computeParentWrite(
    parentPath: string,
    children: readonly DocumentNode[],
  ): Promise<PendingWrite> {
    const indexFile = this.requireIndex(parentPath);
    const content = await this.app.vault.read(indexFile);
    return {
      path: indexFile.path,
      content: this.runMetadata(() => {
        const withFrontmatter = ensureDocumentFrontmatter(content, {
          name: getName(parentPath),
          created: this.createdTimestamp(),
        });
        return updateChildrenLinks(withFrontmatter, parentPath, children);
      }),
    };
  }

  private async flushWrites(writes: readonly PendingWrite[]): Promise<void> {
    for (const write of writes) {
      const file = this.app.vault.getFileByPath(write.path);
      if (file === null) {
        throw new DocumentServiceError(
          t("error.documentNotFound", { path: write.path }),
        );
      }
      await this.app.vault.modify(file, write.content);
    }
  }

  private async cleanup(paths: readonly string[]): Promise<void> {
    for (const path of [...paths].reverse()) {
      const entry = this.app.vault.getAbstractFileByPath(path);
      if (entry === null) {
        continue;
      }
      try {
        await this.app.vault.delete(entry);
      } catch {
        // Keep the original create error; cleanup is best-effort.
      }
    }
  }

  private async trashFolder(folder: DocumentFileRef): Promise<void> {
    await this.app.fileManager.trashFile(folder);
  }

  private requireScannedNode(path: string): DocumentNode {
    const node = findNode(this.scan(), path);
    if (node === null) {
      throw new DocumentServiceError(t("error.documentNotFound", { path }));
    }
    return node;
  }

  private scan(): DocumentNode[] {
    const entries: VaultEntry[] = this.app.vault.getAllLoadedFiles().flatMap(
      (entry) => {
        const path = normalizePath(entry.path);
        if (path === "") {
          return [];
        }
        return [
          {
            kind: Array.isArray(entry.children) ? "folder" : "file",
            path,
          } satisfies VaultEntry,
        ];
      },
    );
    return scanDocuments(entries, {
      maxChildDepth:
        this.options.getMaxChildDepth?.() ??
        DEFAULT_NESTNOTE_SETTINGS.maxChildDepth,
    });
  }

  private runMetadata<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      const message = isMetadataError(error)
        ? t("notice.metadataUnchanged", { detail: errorMessage(error) })
        : errorMessage(error);
      this.failWithNotice(message, error);
    }
  }

  private failWithNotice(message: string, cause?: unknown): never {
    this.options.notice?.(message);
    throw new DocumentServiceError(message, cause, true);
  }

  private createdTimestamp(): string {
    if (this.options.createdAt !== undefined) {
      return this.options.createdAt;
    }
    const now = this.options.now ?? (() => new Date());
    return formatIso8601(now());
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function getName(path: string): string {
  const normalized = normalizePath(path);
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

function getParentPath(path: string): string | null {
  const normalized = normalizePath(path);
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? null : normalized.slice(0, idx);
}

function hasAttachmentsAncestor(path: string): boolean {
  let current = getParentPath(path);
  while (current !== null) {
    if (getName(current) === "attachments") {
      return true;
    }
    current = getParentPath(current);
  }
  return false;
}

function isReservedDeviceName(name: string): boolean {
  const stem = name.split(".")[0].toUpperCase();
  if (stem === "CON" || stem === "PRN" || stem === "AUX" || stem === "NUL") {
    return true;
  }
  return /^COM[1-9]$/.test(stem) || /^LPT[1-9]$/.test(stem);
}

function pickOpenLeaf(
  workspace: DocumentServiceApp["workspace"],
): DocumentWorkspaceLeaf {
  const recent = workspace.getMostRecentLeaf?.();
  if (recent !== undefined && recent !== null && recent.getViewType() !== SIDEBAR_VIEW_TYPE) {
    return recent;
  }
  let rootLeaf: DocumentWorkspaceLeaf | undefined;
  workspace.iterateRootLeaves?.((leaf) => {
    if (rootLeaf === undefined && leaf.getViewType() !== SIDEBAR_VIEW_TYPE) {
      rootLeaf = leaf;
    }
  });
  if (rootLeaf !== undefined) {
    return rootLeaf;
  }
  const current = workspace.getLeaf(false);
  if (current.getViewType() !== SIDEBAR_VIEW_TYPE) {
    return current;
  }
  return workspace.getLeaf(true);
}

function findNode(
  nodes: readonly DocumentNode[],
  path: string,
): DocumentNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    const child = findNode(node.children, path);
    if (child !== null) {
      return child;
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMetadataError(error: unknown): boolean {
  return (
    error instanceof FrontmatterParseError || error instanceof ChildrenLinksError
  );
}

export function formatIso8601(date: Date): string {
  const pad = (n: number, width = 2): string =>
    String(Math.trunc(Math.abs(n))).padStart(width, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
