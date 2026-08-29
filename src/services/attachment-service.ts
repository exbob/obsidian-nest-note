import { t } from "../i18n";

export interface AttachmentFileRef {
  path: string;
  name: string;
  basename: string;
  extension: string;
}

export interface AttachmentHandleOptions {
  notify?: boolean;
}

export interface AttachmentService {
  handleCreatedFile(
    file: AttachmentFileRef,
    options?: AttachmentHandleOptions,
  ): Promise<void>;
}

export interface AttachmentFolderRef {
  path: string;
}

export interface AttachmentServiceApp {
  vault: {
    rename(file: AttachmentFileRef, newPath: string): Promise<void>;
    createFolder(path: string): Promise<unknown>;
    getAbstractFileByPath(path: string): AttachmentFileRef | null;
    getFolderByPath(path: string): AttachmentFileRef | null;
    getFileByPath(path: string): AttachmentFileRef | null;
    getConfig?: (name: string) => unknown;
    config?: unknown;
  };
  workspace: {
    getActiveFile(): AttachmentFileRef | null;
  };
  fileManager?: {
    getNewFileParent(
      sourcePath: string,
      newFilePath?: string,
    ): AttachmentFolderRef;
  };
}

export interface AttachmentServiceOptions {
  notice?: (message: string) => void;
  runInternal?: <T>(fn: () => Promise<T>) => Promise<T>;
  requestRefresh?: (paths: readonly string[]) => void;
}

const ATTACHMENT_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "svg",
  "webp",
  "avif",
  "pdf",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "3gp",
  "flac",
  "mp4",
  "webm",
  "ogv",
  "mov",
  "mkv",
]);

export class NestNoteAttachmentService implements AttachmentService {
  constructor(
    private readonly app: AttachmentServiceApp,
    private readonly options: AttachmentServiceOptions = {},
  ) {}

  async handleCreatedFile(
    file: AttachmentFileRef,
    options: AttachmentHandleOptions = {},
  ): Promise<void> {
    if (!isAttachmentFile(file)) {
      return;
    }

    const sourcePath = normalizePath(file.path);
    const documentPath = this.resolveActiveDocumentPath();
    if (documentPath === null) {
      this.maybeNotify(
        options,
        t("notice.attachmentKept", { path: sourcePath }),
      );
      return;
    }

    const attachmentsPath = `${documentPath}/attachments`;
    if (isUnder(sourcePath, attachmentsPath)) {
      return;
    }

    const foreignOwner = this.owningAttachmentsDocument(sourcePath);
    if (foreignOwner !== null && foreignOwner !== documentPath) {
      return;
    }

    if (this.belongsToOtherDocument(sourcePath, documentPath)) {
      return;
    }

    if (!this.isAllowedSource(sourcePath, documentPath)) {
      this.maybeNotify(
        options,
        t("notice.attachmentKept", { path: sourcePath }),
      );
      return;
    }

    const targetPath = uniqueAvailablePath(
      attachmentsPath,
      file.basename,
      file.extension.toLowerCase(),
      sourcePath,
      (path) => this.app.vault.getAbstractFileByPath(path) !== null,
    );
    if (targetPath === sourcePath) {
      return;
    }

    await this.runInternal(async () => {
      if (this.app.vault.getFolderByPath(attachmentsPath) === null) {
        await this.app.vault.createFolder(attachmentsPath);
      }
      await this.app.vault.rename(file, targetPath);
    });
    this.options.requestRefresh?.([sourcePath, targetPath]);
  }

  private maybeNotify(
    options: AttachmentHandleOptions,
    message: string,
  ): void {
    if (options.notify === true) {
      this.options.notice?.(message);
    }
  }

  private resolveActiveDocumentPath(): string | null {
    const active = this.app.workspace.getActiveFile();
    if (active === null) {
      return null;
    }
    const activePath = normalizePath(active.path);
    if (getName(activePath) !== "index.md") {
      return null;
    }
    const documentPath = getParentPath(activePath);
    if (documentPath === null || !this.isCompleteDocument(documentPath)) {
      return null;
    }
    return documentPath;
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

  private owningAttachmentsDocument(path: string): string | null {
    let current = getParentPath(path);
    while (current !== null) {
      if (getName(current) === "attachments") {
        const documentPath = getParentPath(current);
        if (documentPath !== null && this.isCompleteDocument(documentPath)) {
          return documentPath;
        }
      }
      current = getParentPath(current);
    }
    return null;
  }

  private belongsToOtherDocument(
    sourcePath: string,
    currentDocument: string,
  ): boolean {
    const nearest = this.nearestCompleteDocument(sourcePath);
    return nearest !== null && nearest !== currentDocument;
  }

  private nearestCompleteDocument(sourcePath: string): string | null {
    let cursor = getParentPath(sourcePath);
    while (cursor !== null) {
      if (this.isCompleteDocument(cursor)) {
        return cursor;
      }
      cursor = getParentPath(cursor);
    }
    return null;
  }

  private isAllowedSource(sourcePath: string, documentPath: string): boolean {
    const parent = getParentPath(sourcePath);
    if (parent === documentPath || parent === null) {
      return true;
    }
    const configured = this.probeAttachmentFolder(documentPath, sourcePath);
    if (configured === null) {
      return false;
    }
    const configuredParent = configured === "" ? null : configured;
    return parent === configuredParent;
  }

  private probeAttachmentFolder(
    documentPath: string,
    sourcePath: string,
  ): string | null {
    const fromSetting = resolveAttachmentFolderSetting(
      readAttachmentFolderPath(this.app.vault),
      documentPath,
    );
    if (fromSetting !== null) {
      return fromSetting;
    }
    return this.probeAttachmentFolderSupplement(documentPath, sourcePath);
  }

  private probeAttachmentFolderSupplement(
    documentPath: string,
    sourcePath: string,
  ): string | null {
    const manager = this.app.fileManager;
    if (manager === undefined || typeof manager.getNewFileParent !== "function") {
      return null;
    }
    try {
      const folder = manager.getNewFileParent(
        `${documentPath}/index.md`,
        sourcePath,
      );
      if (isRecord(folder) && typeof folder.path === "string") {
        return normalizePath(folder.path);
      }
    } catch {
      return null;
    }
    return null;
  }

  private async runInternal<T>(fn: () => Promise<T>): Promise<T> {
    if (this.options.runInternal !== undefined) {
      return this.options.runInternal(fn);
    }
    return fn();
  }
}

function isAttachmentFile(file: AttachmentFileRef): boolean {
  if (Array.isArray((file as { children?: unknown }).children)) {
    return false;
  }
  return ATTACHMENT_EXTENSIONS.has(file.extension.toLowerCase());
}

function uniqueAvailablePath(
  folder: string,
  basename: string,
  extension: string,
  sourcePath: string,
  exists: (path: string) => boolean,
): string {
  const suffix = extension === "" ? "" : `.${extension}`;
  let increment = 0;
  while (true) {
    const name =
      increment === 0
        ? `${basename}${suffix}`
        : `${basename} ${increment}${suffix}`;
    const candidate = `${folder}/${name}`;
    if (candidate === sourcePath || !exists(candidate)) {
      return candidate;
    }
    increment += 1;
  }
}

function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
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

function readAttachmentFolderPath(
  vault: AttachmentServiceApp["vault"],
): string | null {
  if (typeof vault.getConfig === "function") {
    const value = vault.getConfig("attachmentFolderPath");
    if (typeof value === "string") {
      return value;
    }
  }
  if (
    isRecord(vault.config) &&
    typeof vault.config.attachmentFolderPath === "string"
  ) {
    return vault.config.attachmentFolderPath;
  }
  return null;
}

function resolveAttachmentFolderSetting(
  setting: string | null,
  documentPath: string,
): string | null {
  if (setting === null) {
    return null;
  }
  const posix = setting.replace(/\\/g, "/");
  if (posix === "/" || posix === "") {
    return "";
  }
  if (posix === "./") {
    return documentPath;
  }
  if (posix.startsWith("./")) {
    const relative = posix.slice(2).replace(/^\/+|\/+$/g, "");
    return relative === "" ? documentPath : `${documentPath}/${relative}`;
  }
  return posix.replace(/^\/+|\/+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
