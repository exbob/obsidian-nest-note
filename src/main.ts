import { Modal, Notice, Plugin, setIcon } from "obsidian";
import { t } from "./i18n";
import type {
  App,
  TAbstractFile,
  TFile,
  TFolder,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import { scanDocuments } from "./domain/document-scanner";
import {
  ChildrenLinksError,
  updateChildrenLinks,
} from "./domain/children-links";
import {
  FrontmatterParseError,
  ensureDocumentFrontmatter,
} from "./domain/frontmatter";
import { NestNoteAttachmentService } from "./services/attachment-service";
import type {
  AttachmentFileRef,
  AttachmentServiceApp,
} from "./services/attachment-service";
import { NestNoteDocumentService } from "./services/document-service";
import type {
  DocumentServiceApp,
  DocumentWorkspaceLeaf,
} from "./services/document-service";
import { isAlreadyNoticed, formatIso8601 } from "./services/document-service";
import { NestNoteVaultEventCoordinator } from "./services/vault-event-coordinator";
import type {
  CoordinatorApp,
  CoordinatorFileRef,
  EventRefLike,
} from "./services/vault-event-coordinator";
import {
  DEFAULT_NESTNOTE_SETTINGS,
  normalizeNestNoteSettings,
  type NestNoteSettings,
} from "./settings";
import type { DocumentNode, DocumentService, VaultEntry } from "./types";
import {
  DocumentTreeView,
  VIEW_TYPE_NESTNOTE,
} from "./ui/document-tree-view";
import {
  NestNoteSettingTab,
  type NestNoteSettingsHost,
} from "./ui/settings-tab";

const COMMAND_IDS = {
  openDocumentTree: "nestnote:open-document-tree",
  newDocument: "nestnote:new-document",
  newChildDocument: "nestnote:new-child-document",
  refresh: "nestnote:refresh",
  archiveCurrentAttachment: "nestnote:archive-current-attachment",
} as const;

export default class NestNotePlugin extends Plugin implements NestNoteSettingsHost {
  settings: NestNoteSettings = { ...DEFAULT_NESTNOTE_SETTINGS };
  private documents!: DocumentService;
  private attachments!: NestNoteAttachmentService;
  private coordinator!: NestNoteVaultEventCoordinator;
  private scanFlight!: SingleFlight;
  private nodes: DocumentNode[] = [];
  private attachmentActiveFile: AttachmentFileRef | null = null;
  private stopped = false;

  async onload(): Promise<void> {
    try {
      this.settings = normalizeNestNoteSettings(await this.loadData());
    } catch {
      this.settings = { ...DEFAULT_NESTNOTE_SETTINGS };
    }
    this.addSettingTab(new NestNoteSettingTab(this.app, this));

    const notify = (message: string): void => {
      new Notice(message);
    };

    this.coordinator = new NestNoteVaultEventCoordinator(
      createCoordinatorApp(this.app),
      {
        registerEvent: (ref) => {
          this.registerEvent(ref);
        },
      },
      {
        handleCreatedFile: (file) => this.handleCreatedFile(file),
        onRefresh: () => {
          void this.scanAndSync();
        },
        onError: notify,
      },
    );

    this.scanFlight = new SingleFlight(() => this.performScanAndSync());

    const innerDocuments = new NestNoteDocumentService(
      createDocumentServiceApp(this.app),
      {
        notice: notify,
        getMaxChildDepth: () => this.settings.maxChildDepth,
      },
    );
    this.documents = wrapWithInternal(innerDocuments, this.coordinator);
    this.attachments = new NestNoteAttachmentService(
      createAttachmentServiceApp(this.app, () => this.attachmentActiveFile),
      {
        notice: notify,
        runInternal: (fn) => this.coordinator.runInternal(fn),
        requestRefresh: (paths) => this.coordinator.requestRefresh(paths),
      },
    );

    this.registerView(
      VIEW_TYPE_NESTNOTE,
      (leaf) =>
        new DocumentTreeView(leaf, {
          documents: this.documents,
          getNodes: () => this.nodes,
          requestRefresh: () => this.scanAndSync(),
          notice: notify,
        }),
    );

    this.addRibbonIcon("folder-tree", "NestNote", () => {
      this.openDocumentTree();
    });

    this.addCommand({
      id: COMMAND_IDS.openDocumentTree,
      name: t("command.openDocumentTree"),
      callback: () => {
        this.openDocumentTree();
      },
    });
    this.addCommand({
      id: COMMAND_IDS.newDocument,
      name: t("command.newDocument"),
      callback: () => {
        this.promptAndCreate(null);
      },
    });
    this.addCommand({
      id: COMMAND_IDS.newChildDocument,
      name: t("command.newChildDocument"),
      callback: () => {
        const active = this.app.workspace.getActiveFile();
        const parent = resolveActiveIndexDocument(this.app, active?.path ?? null);
        if (parent === null) {
          notify(t("notice.openChildRequiresDocument"));
          return;
        }
        this.promptAndCreate(parent);
      },
    });
    this.addCommand({
      id: COMMAND_IDS.refresh,
      name: t("command.refresh"),
      callback: () => {
        void this.scanAndSync();
      },
    });
    this.addCommand({
      id: COMMAND_IDS.archiveCurrentAttachment,
      name: t("command.archiveCurrentAttachment"),
      callback: () => {
        void this.archiveCurrentAttachment();
      },
    });

    this.coordinator.start();
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.revealOpenedDocument(file);
      }),
    );
    this.register(() => {
      this.stopped = true;
      this.coordinator.stop();
    });

    this.app.workspace.onLayoutReady(() => {
      void this.initializeAfterLayout();
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onSettingsChanged(): void {
    void this.scanAndSync();
  }

  private async initializeAfterLayout(): Promise<void> {
    await this.scanAndSync();
    if (!this.stopped && this.settings.openPanelOnStartup) {
      try {
        await this.activateView();
      } catch (error) {
        new Notice(errorMessage(error));
      }
    }
    this.revealActiveDocument();
  }

  private openDocumentTree(): void {
    void this.activateView().catch((error) => {
      new Notice(errorMessage(error));
    });
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE);
    let leaf = existing[0];
    if (leaf === undefined) {
      leaf =
        this.app.workspace.getLeftLeaf(false) ??
        this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_NESTNOTE, active: true });
    }
    await revealLeaf(this.app.workspace, leaf);
    this.revealActiveDocument();
  }

  private async handleCreatedFile(file: CoordinatorFileRef): Promise<void> {
    await this.attachments.handleCreatedFile(toAttachmentRef(file));
  }

  private promptAndCreate(parentPath: string | null): void {
    const title =
      parentPath === null
        ? t("command.newDocument")
        : t("command.newChildDocument");
    new CommandNameModal(this.app, title, (name) => {
      void this.createOpenAndReveal(parentPath, name);
    }).open();
  }

  private async createOpenAndReveal(
    parentPath: string | null,
    name: string,
  ): Promise<void> {
    let created: DocumentNode;
    try {
      created = await this.documents.create(parentPath, name);
    } catch (error) {
      if (!isAlreadyNoticed(error)) {
        new Notice(errorMessage(error));
      }
      return;
    }
    try {
      await this.documents.open(created.path);
    } catch (error) {
      if (!isAlreadyNoticed(error)) {
        new Notice(errorMessage(error));
      }
    }
    await this.scanAndSync();
    this.revealInOpenViews(created.path);
  }

  private revealInOpenViews(path: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)) {
      const view = leaf.view;
      if (view instanceof DocumentTreeView) {
        view.reveal(path);
      }
    }
  }

  private revealOpenedDocument(file: { path: string } | null): void {
    const path = resolveActiveIndexDocument(this.app, file?.path ?? null);
    if (path === null) {
      return;
    }
    this.revealInOpenViews(path);
  }

  private revealActiveDocument(): void {
    this.revealOpenedDocument(this.app.workspace.getActiveFile());
  }

  private async archiveCurrentAttachment(): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    if (active === null) {
      new Notice(t("notice.attachmentNoActiveFile"));
      return;
    }
    const documentPath = resolveDocumentPath(this.app, active.path);
    if (documentPath === null) {
      new Notice(t("notice.attachmentKept", { path: active.path }));
      return;
    }
    const index = getFile(this.app, `${documentPath}/index.md`);
    if (index === null) {
      new Notice(t("notice.attachmentKept", { path: active.path }));
      return;
    }
    this.attachmentActiveFile = toAttachmentRef(index);
    try {
      await this.attachments.handleCreatedFile(toAttachmentRef(active), {
        notify: true,
      });
    } catch (error) {
      new Notice(errorMessage(error));
    } finally {
      this.attachmentActiveFile = null;
    }
  }

  private async runAction(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      await this.scanAndSync();
    } catch (error) {
      if (!isAlreadyNoticed(error)) {
        new Notice(errorMessage(error));
      }
    }
  }

  private scanAndSync(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve();
    }
    return this.scanFlight.request();
  }

  private async performScanAndSync(): Promise<void> {
    if (this.stopped) {
      return;
    }
    try {
      await this.coordinator.runInternal(async () => {
        const metadataNodes = scanFromApp(this.app, 9);
        this.nodes = scanFromApp(this.app, this.settings.maxChildDepth);
        if (this.settings.autoFixDocumentFormat) {
          await syncDocumentMetadata(this.app, metadataNodes);
        }
      });
      this.renderOpenViews();
    } catch (error) {
      if (!isAlreadyNoticed(error)) {
        new Notice(errorMessage(error));
      }
    }
  }

  private renderOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)) {
      const view = leaf.view;
      if (view instanceof DocumentTreeView) {
        view.render(this.nodes);
      }
    }
  }
}

function wrapWithInternal(
  inner: DocumentService,
  coordinator: NestNoteVaultEventCoordinator,
): DocumentService {
  return {
    create: (parentPath, name) =>
      coordinator.runInternal(() => inner.create(parentPath, name)),
    rename: (documentPath, newName) =>
      coordinator.runInternal(() => inner.rename(documentPath, newName)),
    trash: (documentPath) =>
      coordinator.runInternal(() => inner.trash(documentPath)),
    move: (documentPath, newParentPath) =>
      coordinator.runInternal(() => inner.move(documentPath, newParentPath)),
    open: (documentPath) => inner.open(documentPath),
  };
}

function createCoordinatorApp(app: App): CoordinatorApp {
  return {
    vault: {
      on: (name, callback) => listenVault(app, name, callback),
      offref: (ref) => {
        app.vault.offref(ref);
      },
    },
    workspace: {
      get layoutReady() {
        return app.workspace.layoutReady;
      },
    },
  };
}

function listenVault(
  app: App,
  name: string,
  callback: (...args: unknown[]) => unknown,
): EventRefLike {
  const handler = (...args: unknown[]): unknown => callback(...args);
  switch (name) {
    case "create":
      return app.vault.on("create", (file) => handler(file));
    case "modify":
      return app.vault.on("modify", (file) => handler(file));
    case "delete":
      return app.vault.on("delete", (file) => handler(file));
    case "rename":
      return app.vault.on("rename", (file, oldPath) => handler(file, oldPath));
    default:
      throw new Error(`Unsupported vault event: ${name}`);
  }
}

function createDocumentServiceApp(app: App): DocumentServiceApp {
  const vault: DocumentServiceApp["vault"] = {
    createFolder: (path) => app.vault.createFolder(path),
    create: (path, data) => app.vault.create(path, data),
    read: (file) => {
      const found = requireFile(app, file.path);
      return app.vault.read(found);
    },
    modify: async (file, data) => {
      const found = requireFile(app, file.path);
      await app.vault.modify(found, data);
    },
    rename: async (file, newPath) => {
      const found = requireAbstract(app, file.path);
      await renameKeepingLinks(app, found, newPath);
    },
    delete: async (file) => {
      await trashAbstract(app, file.path);
    },
    trash: async (file) => {
      await trashAbstract(app, file.path);
    },
    getAbstractFileByPath: (path) => app.vault.getAbstractFileByPath(path),
    getFolderByPath: (path) => app.vault.getFolderByPath(path),
    getFileByPath: (path) => app.vault.getFileByPath(path),
    getAllLoadedFiles: () =>
      app.vault.getAllLoadedFiles().map((entry) => ({
        path: entry.path,
        children: isFolder(entry) ? entry.children : undefined,
      })),
  };

  return {
    vault,
    fileManager: {
      trashFile: async (file) => {
        await trashAbstract(app, file.path);
      },
    },
    workspace: createDocumentWorkspace(app),
  };
}

function createDocumentWorkspace(
  app: App,
): DocumentServiceApp["workspace"] {
  return {
    getLeaf: (newLeaf) => wrapWorkspaceLeaf(app, app.workspace.getLeaf(newLeaf)),
    getMostRecentLeaf: () => {
      const leaf = app.workspace.getMostRecentLeaf();
      return leaf === null ? null : wrapWorkspaceLeaf(app, leaf);
    },
    iterateRootLeaves: (callback) => {
      app.workspace.iterateRootLeaves((leaf) => {
        callback(wrapWorkspaceLeaf(app, leaf));
      });
    },
  };
}

function wrapWorkspaceLeaf(app: App, leaf: WorkspaceLeaf): DocumentWorkspaceLeaf {
  return {
    openFile: async (file) => {
      const found = requireFile(app, file.path);
      await leaf.openFile(found);
    },
    getViewType: () => leaf.view.getViewType(),
  };
}

function createAttachmentServiceApp(
  app: App,
  getOverride: () => AttachmentFileRef | null,
): AttachmentServiceApp {
  return {
    vault: {
      rename: async (file, newPath) => {
        const found = requireAbstract(app, file.path);
        await renameKeepingLinks(app, found, newPath);
      },
      createFolder: (path) => app.vault.createFolder(path),
      getAbstractFileByPath: (path) =>
        toAttachmentLookup(app.vault.getAbstractFileByPath(path)),
      getFolderByPath: (path) => toAttachmentLookup(getFolder(app, path)),
      getFileByPath: (path) => {
        const file = getFile(app, path);
        return file === null ? null : toAttachmentRef(file);
      },
      ...probeVaultAttachmentConfig(app.vault),
    },
    fileManager: probeAttachmentFileManager(app),
    workspace: {
      getActiveFile: () => {
        const override = getOverride();
        if (override !== null) {
          return override;
        }
        const active = app.workspace.getActiveFile();
        return active === null ? null : toAttachmentRef(active);
      },
    },
  };
}

function probeAttachmentFileManager(
  app: App,
): AttachmentServiceApp["fileManager"] {
  const manager = app.fileManager;
  if (typeof manager.getNewFileParent !== "function") {
    return undefined;
  }
  return {
    getNewFileParent: (sourcePath, newFilePath) => {
      const folder = manager.getNewFileParent(sourcePath, newFilePath);
      return { path: folder.path };
    },
  };
}

function probeVaultAttachmentConfig(vault: object): {
  getConfig?: (name: string) => unknown;
  config?: unknown;
} {
  if (!isRecord(vault)) {
    return {};
  }
  const probed: {
    getConfig?: (name: string) => unknown;
    config?: unknown;
  } = {};
  if (typeof vault.getConfig === "function") {
    const getConfig = vault.getConfig.bind(vault) as (name: string) => unknown;
    probed.getConfig = (name) => getConfig(name);
  }
  if ("config" in vault) {
    probed.config = vault.config;
  }
  return probed;
}

async function renameKeepingLinks(
  app: App,
  file: TAbstractFile,
  newPath: string,
): Promise<void> {
  await app.fileManager.renameFile(file, newPath);
}

async function revealLeaf(
  workspace: Workspace,
  leaf: WorkspaceLeaf,
): Promise<void> {
  await workspace.revealLeaf(leaf);
}

function scanFromApp(app: App, maxChildDepth: number): DocumentNode[] {
  const entries: VaultEntry[] = [];
  for (const entry of app.vault.getAllLoadedFiles()) {
    const path = normalizePath(entry.path);
    if (path === "") {
      continue;
    }
    entries.push({
      kind: isFolder(entry) ? "folder" : "file",
      path,
    });
  }
  return scanDocuments(entries, { maxChildDepth });
}

async function syncDocumentMetadata(
  app: App,
  nodes: readonly DocumentNode[],
): Promise<void> {
  for (const node of nodes) {
    await syncDocumentNode(app, node);
    await syncDocumentMetadata(app, node.children);
  }
}

async function syncDocumentNode(app: App, node: DocumentNode): Promise<void> {
  const file = getFile(app, node.indexPath);
  if (file === null) {
    return;
  }
  try {
    const content = await app.vault.read(file);
    const next = transformDocumentIndex(content, node);
    if (next === content) {
      return;
    }
    const latest = await app.vault.read(file);
    const toWrite =
      latest === content ? next : transformDocumentIndex(latest, node);
    if (toWrite !== latest) {
      await app.vault.modify(file, toWrite);
    }
  } catch (error) {
    if (
      error instanceof FrontmatterParseError ||
      error instanceof ChildrenLinksError
    ) {
      new Notice(t("notice.metadataUnchanged", { detail: errorMessage(error) }));
      return;
    }
    throw error;
  }
}

function transformDocumentIndex(content: string, node: DocumentNode): string {
  const withFrontmatter = ensureDocumentFrontmatter(content, {
    name: node.name,
    created: formatIso8601(new Date()),
  });
  return updateChildrenLinks(withFrontmatter, node.path, node.children);
}

function resolveActiveIndexDocument(
  app: App,
  filePath: string | null,
): string | null {
  if (filePath === null) {
    return null;
  }
  const normalized = normalizePath(filePath);
  if (getName(normalized) !== "index.md") {
    return null;
  }
  const parent = getParentPath(normalized);
  return parent !== null && isCompleteDocument(app, parent) ? parent : null;
}

function resolveDocumentPath(app: App, filePath: string | null): string | null {
  if (filePath === null) {
    return null;
  }
  const normalized = normalizePath(filePath);
  if (getName(normalized) === "index.md") {
    const parent = getParentPath(normalized);
    return parent !== null && isCompleteDocument(app, parent) ? parent : null;
  }
  let current = getParentPath(normalized);
  while (current !== null) {
    if (getName(current) === "attachments") {
      current = getParentPath(current);
      continue;
    }
    if (isCompleteDocument(app, current)) {
      return current;
    }
    current = getParentPath(current);
  }
  return null;
}

function isCompleteDocument(app: App, path: string): boolean {
  const normalized = normalizePath(path);
  if (
    normalized === "" ||
    getName(normalized) === "attachments" ||
    hasAttachmentsAncestor(normalized)
  ) {
    return false;
  }
  return (
    getFile(app, `${normalized}/index.md`) !== null &&
    getFolder(app, `${normalized}/attachments`) !== null
  );
}

function getFile(app: App, path: string): TFile | null {
  return app.vault.getFileByPath(path);
}

function getFolder(app: App, path: string): TFolder | null {
  return app.vault.getFolderByPath(path);
}

async function trashAbstract(app: App, path: string): Promise<void> {
  await app.fileManager.trashFile(requireAbstract(app, path));
}

function requireFile(app: App, path: string): TFile {
  const file = getFile(app, path);
  if (file === null) {
    throw new Error(`File not found: ${path}`);
  }
  return file;
}

function requireAbstract(app: App, path: string): TAbstractFile {
  const file = app.vault.getAbstractFileByPath(path);
  if (file === null) {
    throw new Error(`File not found: ${path}`);
  }
  return file;
}

function isFolder(file: TAbstractFile): file is TFolder {
  return "children" in file && Array.isArray((file as { children?: unknown }).children);
}

function isFile(file: TAbstractFile): file is TFile {
  return !isFolder(file);
}

function toAttachmentRef(file: {
  path: string;
  name: string;
  basename?: string;
  extension?: string;
}): AttachmentFileRef {
  const name = file.name;
  const extension =
    file.extension ??
    (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "");
  const basename =
    file.basename ??
    (extension === "" ? name : name.slice(0, name.length - extension.length - 1));
  return {
    path: file.path,
    name,
    basename,
    extension,
  };
}

function toAttachmentLookup(
  file: TAbstractFile | null,
): AttachmentFileRef | null {
  if (file === null) {
    return null;
  }
  if (isFile(file)) {
    return toAttachmentRef(file);
  }
  return {
    path: file.path,
    name: file.name,
    basename: file.name,
    extension: "",
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class SingleFlight {
  private running = false;
  private pending = false;
  private current: Promise<void> = Promise.resolve();

  constructor(private readonly task: () => Promise<void>) {}

  request(): Promise<void> {
    this.pending = true;
    if (this.running) {
      return this.current;
    }
    this.running = true;
    this.current = this.drain().finally(() => {
      this.running = false;
    });
    return this.current;
  }

  private async drain(): Promise<void> {
    do {
      this.pending = false;
      await this.task();
    } while (this.pending);
  }
}

class CommandNameModal extends Modal {
  constructor(
    app: App,
    private readonly heading: string,
    private readonly onSubmit: (name: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.classList.add("nestnote-modal");
    this.setTitle(this.heading);

    const input = createEl("input", {
      type: "text",
      attr: { "aria-label": t("ui.documentName") },
    });

    let submitted = false;
    const submit = (): void => {
      if (submitted) {
        return;
      }
      const name = input.value.trim();
      if (name === "") {
        return;
      }
      submitted = true;
      this.onSubmit(name);
      this.close();
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });

    const actions = createEl("div", { cls: "nestnote-modal-actions" });
    actions.append(
      iconButton("check", t("ui.confirm"), (event) => {
        event.preventDefault();
        submit();
      }),
      iconButton("x", t("ui.cancel"), () => {
        this.close();
      }),
    );

    this.contentEl.append(input, actions);
    input.focus();
  }

  onClose(): void {
    this.contentEl.replaceChildren();
  }
}

function iconButton(
  icon: string,
  label: string,
  onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
  const button = createEl("button", {
    cls: "nestnote-icon-button",
    attr: { type: "button", "aria-label": label },
  });
  setIcon(button, icon);
  button.addEventListener("click", onClick);
  return button;
}
